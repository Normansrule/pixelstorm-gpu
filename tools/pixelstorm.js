#!/usr/bin/env node
/* =============================================================================
 * tools/pixelstorm.js — Pixelstorm command-line toolchain
 *
 *   ./pixelstorm help        (the wrapper script at the repo root calls this file)
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const W = require('../web/js/pixelstorm.js');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
const color = process.stdout.isTTY ? C : Object.fromEntries(Object.keys(C).map(k => [k, '']));

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt !== undefined && !nxt.startsWith('--') && !/\.psa$/.test(nxt)) { o[k] = nxt; i++; } else o[k] = true;
    } else o._.push(a);
  }
  return o;
}

function readKernel(file) {
  if (!file) throw new Error('which kernel? e.g. ./pixelstorm sim vector_add   (see ./pixelstorm list)');
  let p = fs.existsSync(file) ? file : path.join(ROOT, 'kernels', file);
  if (!fs.existsSync(p)) {
    // accept "03", "divergence", "03_divergence"
    const key = file.replace(/\.psa$/, '');
    const hit = fs.readdirSync(path.join(ROOT, 'kernels')).find(f => f.endsWith('.psa') && (f.startsWith(key + '_') || f.replace(/^\d+_/, '').replace('.psa', '') === key || f.replace('.psa', '') === key));
    if (!hit) throw new Error(`no kernel "${file}". Try ./pixelstorm list`);
    p = path.join(ROOT, 'kernels', hit);
  }
  if (!fs.existsSync(p)) throw new Error(`kernel not found: ${file}`);
  return { path: p, src: fs.readFileSync(p, 'utf8') };
}

function cfgFrom(asm, opts) {
  const cfg = Object.assign({}, W.DEFAULT_CFG);
  if (asm.config.sms !== null) cfg.numSms = asm.config.sms;
  if (asm.config.lat !== null) cfg.lat = asm.config.lat;
  if (asm.config.cache !== null) cfg.cacheLines = asm.config.cache;
  if (opts.sms) cfg.numSms = +opts.sms;
  if (opts.lat) cfg.lat = +opts.lat;
  if (opts.cache !== undefined) cfg.cacheLines = +opts.cache;
  if (cfg.cacheLines && (cfg.cacheLines & (cfg.cacheLines - 1))) throw new Error('--cache must be a power of two (for example 16)');
  return cfg;
}

// ---------------------------------------------------------------------------
function cmdAsm(opts) {
  const k = readKernel(opts._[1]);
  const asm = W.assemble(k.src);
  console.log(`${color.b}kernel ${asm.config.name}${color.x}  <<<grid=${asm.config.grid}, block=${asm.config.block}>>>  ${asm.words.length} instructions\n`);
  console.log(`${color.d} PC   word      line  disassembly${color.x}`);
  for (const l of asm.listing) console.log(`${String(l.pc).padStart(3)}   ${l.hex}  ${String(l.line).padStart(4)}  ${l.asm}`);
  if (opts.o) { fs.writeFileSync(opts.o, asm.words.map(W.hex8).join('\n') + '\n'); console.log(`\nwrote ${opts.o}`); }
}

function printDumps(asm, gmem, title) {
  for (const d of asm.config.dump) {
    const vals = Array.from(gmem.slice(d.addr, d.addr + d.count));
    console.log(`\n${color.g}${title} 0x${d.addr.toString(16)}[${d.count}]${color.x} ${color.d}${d.label}${color.x}`);
    for (let i = 0; i < vals.length; i += 8) console.log('  ' + vals.slice(i, i + 8).map(v => String(v | 0).padStart(10)).join(' '));
  }
}

function summarize(events, cfg) {
  const commits = events.filter(e => e.ev === 'commit');
  let lanes = 0, slots = 0, txns = 0, memc = 0;
  for (const e of commits) { lanes += W.popcount(e.exe); slots += cfg.warpSize; if (e.txn) txns += e.txn; memc += e.mcyc; }
  return { instructions: commits.length, simdEfficiency: slots ? lanes / slots : 0, txns, memCycles: memc };
}

function cmdSim(opts) {
  const k = readKernel(opts._[1]);
  const asm = W.assemble(k.src);
  const cfg = cfgFrom(asm, opts);
  const sim = new W.Simulator(cfg);
  sim.load(asm.words, asm.config.params, asm.config.data);
  const out = sim.run(asm.config.grid, asm.config.block, { trace: true });
  printDumps(asm, out.gmem, 'model');
  const s = summarize(out.events, cfg);
  console.log(`\n${color.b}model:${color.x} ${out.cycles} cycles, ${s.instructions} warp-instructions, SIMD efficiency ${(100 * s.simdEfficiency).toFixed(1)}%, ${s.txns} memory transactions/passes`);
  if (opts.trace) writeTrace(opts.trace, W.traceMeta(asm, cfg, k.src, 'sim', out.cycles), out.events);
  return out;
}

// ---------------------------------------------------------------------------
function which(bin) { return spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0; }

function compileTb(numSms, cacheLines = 0) {
  if (!which('iverilog')) throw new Error('iverilog not found. Run: sudo apt install -y iverilog   (or scripts/setup_ubuntu.sh)');
  fs.mkdirSync(BUILD, { recursive: true });
  const out = path.join(BUILD, `tb_sms${numSms}_c${cacheLines}.vvp`);
  const srcs = [path.join(ROOT, 'sim/tb_gpu.v'), ...fs.readdirSync(path.join(ROOT, 'rtl')).filter(f => f.endsWith('.v')).map(f => path.join(ROOT, 'rtl', f))];
  const deps = [...srcs, path.join(ROOT, 'rtl/ps_defines.vh')];
  const stale = !fs.existsSync(out) || deps.some(f => fs.statSync(f).mtimeMs > fs.statSync(out).mtimeMs);
  if (stale) execFileSync('iverilog', ['-g2012', '-I', path.join(ROOT, 'rtl'), `-Ptb_gpu.NUM_SMS=${numSms}`, `-Ptb_gpu.CACHE_LINES=${cacheLines}`, '-o', out, ...srcs], { stdio: 'inherit' });
  return out;
}

function runRtl(k, opts) {
  const asm = W.assemble(k.src);
  const cfg = cfgFrom(asm, opts);
  const vvp = compileTb(cfg.numSms, cfg.cacheLines || 0);
  const dir = path.join(BUILD, asm.config.name);
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  fs.writeFileSync(f('imem.hex'), asm.words.map(W.hex8).join('\n') + '\n');
  fs.writeFileSync(f('cmem.hex'), asm.config.params.map(W.hex8).join('\n') + '\n');
  let g = '';
  for (const b of asm.config.data) { g += `@${b.addr.toString(16)}\n` + b.values.map(W.hex8).join('\n') + '\n'; }
  fs.writeFileSync(f('gmem.hex'), g || '@0\n00000000\n');
  const args = [vvp, `+imem=${f('imem.hex')}`, `+cmem=${f('cmem.hex')}`, `+gmem=${f('gmem.hex')}`, `+out=${f('gmem_out.hex')}`,
    `+grid=${asm.config.grid}`, `+block=${asm.config.block}`, `+lat=${cfg.lat}`, '+trace'];
  if (opts.vcd) args.push(`+vcd=${typeof opts.vcd === 'string' ? opts.vcd : f('wave.vcd')}`);
  const r = spawnSync('vvp', ['-n', ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`vvp failed:\n${r.stderr}\n${r.stdout.slice(-2000)}`);
  const events = [];
  for (const line of r.stdout.split('\n')) if (line.startsWith('{')) events.push(JSON.parse(line));
  const gmem = new Uint32Array(cfg.gmemWords);
  let a = 0;
  for (const line of fs.readFileSync(f('gmem_out.hex'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    if (t.startsWith('@')) { a = parseInt(t.slice(1), 16); continue; }
    gmem[a++] = parseInt(t, 16) >>> 0;
  }
  const done = events.find(e => e.ev === 'done');
  return { asm, cfg, events, gmem, cycles: done ? done.t : -1, timeout: events.some(e => e.ev === 'timeout'), vcd: opts.vcd ? (typeof opts.vcd === 'string' ? opts.vcd : f('wave.vcd')) : null };
}

function cmdRtl(opts) {
  const k = readKernel(opts._[1]);
  const r = runRtl(k, opts);
  printDumps(r.asm, r.gmem, 'rtl');
  const s = summarize(r.events, r.cfg);
  console.log(`\n${color.b}rtl:${color.x} ${r.cycles} cycles, ${s.instructions} warp-instructions, SIMD efficiency ${(100 * s.simdEfficiency).toFixed(1)}%, ${s.txns} memory transactions/passes`);
  if (r.timeout) console.log(`${color.r}TIMEOUT — the kernel never finished (missing EXIT? deadlocked BAR?)${color.x}`);
  if (r.vcd) console.log(`waveform: ${r.vcd}   (open with: gtkwave ${r.vcd} sim/wave.gtkw)`);
  if (opts.trace) writeTrace(opts.trace, W.traceMeta(r.asm, r.cfg, k.src, 'rtl', r.cycles), r.events);
  return r;
}

const byTime = (a, b) => (a.t - b.t) || ((a.sm || 0) - (b.sm || 0));
function writeTrace(file, meta, events) {
  events = events.slice().sort(byTime);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ meta, events }));
  console.log(`trace: ${file} (${events.length} events) — open it in the visualizer (make serve, then Open trace file)`);
}

// ---------------------------------------------------------------------------
function kernelFiles() {
  return fs.readdirSync(path.join(ROOT, 'kernels')).filter(f => f.endsWith('.psa')).sort().map(f => path.join(ROOT, 'kernels', f));
}

const EXPECT = require('../tests/expected.js');

function cmdTest(opts) {
  let fail = 0;
  const smsList = opts.sms ? [+opts.sms] : [1, 2];
  for (const file of kernelFiles()) {
    const k = { path: file, src: fs.readFileSync(file, 'utf8') };
    const own = W.assemble(k.src).config.cache;
    // every kernel on its own configuration, plus the cached GPU (16 lines) on 2 SMs
    const runs = smsList.map(sms => ({ sms, cache: opts.cache !== undefined ? +opts.cache : (own || 0) }));
    if (opts.cache === undefined && !opts.sms && !own) runs.push({ sms: 2, cache: 16 });
    for (const { sms, cache } of runs) {
      const o = Object.assign({}, opts, { sms, cache });
      const r = runRtl(k, o);
      const sim = new W.Simulator(r.cfg);
      sim.load(r.asm.words, r.asm.config.params, r.asm.config.data);
      const m = sim.run(r.asm.config.grid, r.asm.config.block, { trace: true });
      const problems = [];
      if (r.timeout) problems.push('RTL timeout');
      let diffs = 0, first = -1;
      for (let i = 0; i < r.gmem.length; i++) if (r.gmem[i] !== m.gmem[i]) { if (first < 0) first = i; diffs++; }
      if (diffs) problems.push(`${diffs} memory words differ (first at 0x${first.toString(16)}: rtl=${r.gmem[first]} model=${m.gmem[first]})`);
      const ord = (a, b) => a.t - b.t || a.sm - b.sm;
      const rc = r.events.filter(e => e.ev === 'commit').sort(ord); const mc = m.events.filter(e => e.ev === 'commit').sort(ord);
      if (rc.length !== mc.length) problems.push(`commit count rtl=${rc.length} model=${mc.length}`);
      else {
        const key = (e) => `${e.t}|${e.sm}|${e.w}|${e.pc}|${e.act}|${e.exe}|${e.txn}`;
        const bad = rc.findIndex((e, i) => key(e) !== key(mc[i]));
        if (bad >= 0) problems.push(`cycle-exact mismatch at commit #${bad}: rtl ${key(rc[bad])} vs model ${key(mc[bad])}`);
      }
      const ck = (e) => `${e.t}|${e.hit}|${e.a}`;
      const rh = r.events.filter(e => e.ev === 'cache').map(ck).join(','), mh = m.events.filter(e => e.ev === 'cache').map(ck).join(',');
      if (rh !== mh) problems.push('cache hit/miss sequence differs between RTL and model');
      const name = r.asm.config.name;
      if (EXPECT[name]) {
        const err = EXPECT[name](r.gmem, r.asm);
        if (err) problems.push(`wrong answer: ${err}`);
      }
      const s = summarize(r.events, r.cfg);
      const hits = r.events.filter(e => e.ev === 'cache' && e.hit).length, look = r.events.filter(e => e.ev === 'cache').length;
      const cinfo = cache ? `  cache ${cache}: ${look ? Math.round(100 * hits / look) : 0}% hits` : '';
      const tag = problems.length ? `${color.r}FAIL${color.x}` : `${color.g}PASS${color.x}`;
      console.log(`${tag} ${name.padEnd(20)} sms=${sms}${cache ? ' c' + String(cache).padEnd(3) : '     '} ${String(r.cycles).padStart(6)} cycles  ${String(s.instructions).padStart(4)} warp-instr  SIMD eff ${(100 * s.simdEfficiency).toFixed(0).padStart(3)}%${cinfo}`);
      for (const p of problems) console.log(`     ${color.r}${p}${color.x}`);
      if (problems.length) fail++;
    }
  }
  console.log(fail ? `\n${color.r}${fail} failure(s)${color.x}` : `\n${color.g}all kernels match: RTL == golden model, cycle for cycle (with and without the cache)${color.x}`);
  process.exitCode = fail ? 1 : 0;
}

function cmdTraces(opts) {
  const outDir = path.join(ROOT, 'web', 'traces');
  fs.mkdirSync(outDir, { recursive: true });
  const index = [];
  for (const file of kernelFiles()) {
    const k = { path: file, src: fs.readFileSync(file, 'utf8') };
    const r = runRtl(k, opts);
    const name = r.asm.config.name;
    const meta = W.traceMeta(r.asm, r.cfg, k.src, 'rtl', r.cycles);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ meta, events: r.events.slice().sort(byTime) }));
    index.push({ name, file: `${name}.json`, cycles: r.cycles });
    console.log(`web/traces/${name}.json  ${r.events.length} events`);
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
}

function cmdBundle() {
  const ex = kernelFiles().map(f => ({ file: path.basename(f), src: fs.readFileSync(f, 'utf8') }));
  const out = path.join(ROOT, 'web', 'js', 'examples.js');
  fs.writeFileSync(out, '// generated by: node tools/pixelstorm.js bundle   (do not edit; edit kernels/*.psa)\nwindow.PS_EXAMPLES = ' + JSON.stringify(ex, null, 1) + ';\n');
  console.log(`wrote ${path.relative(ROOT, out)} (${ex.length} kernels)`);
}

function cmdIsaMd() {
  const rows = W.ISA.map(e => `| \`${e.name}\` | \`0x${e.code.toString(16).padStart(2, '0')}\` | ${e.group} | ${e.desc} | ${e.cuda} |`);
  console.log('| Mnemonic | Opcode | Group | What it does | CUDA / PTX / SASS analog |\n|---|---|---|---|---|\n' + rows.join('\n'));
}

// ---------------------------------------------------------------------------
const opts = parseArgs(process.argv.slice(2));
const cmds = { asm: cmdAsm, sim: cmdSim, rtl: cmdRtl, test: cmdTest, traces: cmdTraces, bundle: cmdBundle, 'isa-md': cmdIsaMd };
const HELP = `
${color.b}Pixelstorm${color.x} — a see-through GPU in Verilog

${color.y}Run a kernel${color.x}
  ./pixelstorm list                          the 12 example kernels and what each teaches
  ./pixelstorm sim  <kernel>                 run on the golden model (JavaScript, instant)
  ./pixelstorm rtl  <kernel> [--vcd [file]]  run on the Verilog in Icarus Verilog (+ waveform)
  ./pixelstorm asm  <kernel>                 assembler listing: PC, hex word, disassembly

${color.y}Learn the instruction set${color.x}
  ./pixelstorm explain <MNEMONIC>            e.g. ./pixelstorm explain SHFL
  ./pixelstorm explain                       every instruction, one line each

${color.y}Write your own${color.x}
  ./pixelstorm new <name>                    create kernels/<nn>_<name>.psa from a template

${color.y}Check and publish${color.x}
  ./pixelstorm test [--sms N]                RTL vs golden model, cycle for cycle, every kernel
  ./pixelstorm traces                        record RTL traces for the visualizer (web/traces/)
  ./pixelstorm bundle                        embed kernels for the browser (web/js/examples.js)
  ./pixelstorm isa-md                        ISA table as Markdown

${color.y}Options${color.x}
  --sms N     number of Streaming Multiprocessors (default 2)
  --lat N     DRAM latency in cycles (default 8)
  --cache N   add a shared N-line cache between the arbiter and DRAM (power of two, 0 = none)
  --trace F   write the trace JSON to F
  --quiet     less output

<kernel> can be a path or a name: 03_divergence.psa, 03, or divergence.
`;
function kernelNames() { return fs.readdirSync(path.join(ROOT, 'kernels')).filter(f => f.endsWith('.psa')).sort(); }
function cmdList() {
  console.log(`\n${color.b}Example kernels${color.x}  (run with ./pixelstorm sim <name> or ./pixelstorm rtl <name>)\n`);
  for (const f of kernelNames()) {
    const src = fs.readFileSync(path.join(ROOT, 'kernels', f), 'utf8');
    const first = (src.split('\n').find(l => /^;\s*\d\d\s/.test(l)) || '').replace(/^;\s*\d\d\s+\S+\s*[—-]*\s*/, '');
    console.log(`  ${color.g}${f.replace('.psa', '').padEnd(22)}${color.x} ${first.trim()}`);
  }
  console.log('');
}
function cmdExplain(opts) {
  const q = (opts._[1] || '').toUpperCase().split('.')[0];
  const list = q ? W.ISA.filter(e => e.name === q) : W.ISA;
  if (!list.length) throw new Error(`unknown instruction "${opts._[1]}". Try ./pixelstorm explain`);
  if (!q) { for (const e of W.ISA) console.log(`  ${color.g}${e.name.padEnd(6)}${color.x} ${color.d}${e.group.padEnd(9)}${color.x} ${e.desc}`); return; }
  const e = list[0];
  console.log(`\n${color.g}${e.name}${color.x}  opcode 0x${e.code.toString(16).padStart(2, '0')}  group ${e.group}\n\n  ${e.desc}\n\n  CUDA / PTX / SASS analog: ${e.cuda}`);
  const uses = kernelNames().filter(f => new RegExp(`\\b${e.name}\\b`).test(fs.readFileSync(path.join(ROOT, 'kernels', f), 'utf8').replace(/;.*$/gm, '')));
  if (uses.length) console.log(`\n  Used in: ${uses.join(', ')}`);
  console.log(`  Reference: docs/03-isa.md\n`);
}
function cmdNew(opts) {
  const name = (opts._[1] || '').replace(/[^a-zA-Z0-9_]/g, '_');
  if (!name) throw new Error('usage: ./pixelstorm new <name>');
  const nums = kernelNames().map(f => parseInt(f, 10)).filter(n => !isNaN(n));
  const file = path.join(ROOT, 'kernels', `${String(Math.max(0, ...nums) + 1).padStart(2, '0')}_${name}.psa`);
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  fs.writeFileSync(file, `; ${path.basename(file).slice(0, 2)} ${name} — describe what this kernel teaches
; -----------------------------------------------------------------------------
; CUDA version:
;   __global__ void ${name}(const int* in, int* out, int n) {
;       int i = blockIdx.x * blockDim.x + threadIdx.x;
;       if (i >= n) return;
;       out[i] = in[i] * 2;
;   }
; =============================================================================
.kernel ${name}
.grid 2
.block 16
.equ N, 32
.equ IN, 0x000
.equ OUT, 0x100
.param 0, IN
.param 1, OUT
.param 2, N
.seq IN, N, 0, 1               ; in[i] = i
.dump OUT, N, out[i] = 2 * in[i]

    S2R   R0, CTAID            ; blockIdx.x
    S2R   R1, NTID             ; blockDim.x
    S2R   R2, TID              ; threadIdx.x
    MAD   R3, R0, R1, R2       ; i
    LDC   R4, c[2]             ; n
    SETP.GE P0, R3, R4
@P0 EXIT
    LDC   R5, c[0]
    ADD   R5, R5, R3           ; &in[i]
    LDG   R6, [R5]
    SHLI  R6, R6, 1            ; * 2
    LDC   R7, c[1]
    ADD   R7, R7, R3           ; &out[i]
    STG   [R7], R6
    EXIT
`);
  console.log(`created ${path.relative(ROOT, file)}\nnext: ./pixelstorm sim ${name}   then ./pixelstorm rtl ${name}   then make traces (adds it to the visualizer)`);
}
cmds.list = cmdList; cmds.explain = cmdExplain; cmds.new = cmdNew;
const fn = cmds[opts._[0]];
if (!fn) {
  console.log(HELP);
  process.exit(opts._[0] && opts._[0] !== 'help' ? 1 : 0);
}
try { fn(opts); } catch (e) {
  console.error(`${color.r}error:${color.x} ${e.message}`);
  process.exit(1);
}
