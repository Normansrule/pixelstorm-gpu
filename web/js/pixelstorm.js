/* =============================================================================
 * pixelstorm.js — the Pixelstorm GPU software core (browser + Node.js)
 * -----------------------------------------------------------------------------
 *  1. ISA table        one entry per instruction, with the CUDA/PTX analog
 *  2. Assembler        .psa text  ->  32-bit words + launch configuration
 *  3. Disassembler     32-bit word ->  text
 *  4. Simulator        cycle-level model that mirrors rtl/ps_sm.v stage by
 *                      stage and emits the SAME trace events as the RTL
 *
 * The RTL (rtl/*.v) is the hardware. This file is the "golden model" the RTL
 * is checked against (tools/pixelstorm.js test) and the engine behind the browser
 * playground (web/visualizer.html). If you change the ISA, change both.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PIXELSTORM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. ISA table
  // ---------------------------------------------------------------------------
  // fmt describes operand syntax:
  //   none            NOP
  //   br              BRA label
  //   rr              MOV Rd, Rs1
  //   ri18            MOVI Rd, imm
  //   s2r             S2R Rd, TID
  //   ldc             LDC Rd, c[imm]
  //   rrr             ADD Rd, Rs1, Rs2
  //   rrrr            MAD Rd, Rs1, Rs2, Rs3
  //   sel             SEL Rd, Rs1, Rs2, Pp
  //   rri             ADDI Rd, Rs1, imm
  //   setp            SETP.LT Pd, Rs1, Rs2
  //   vote            VOTE.ANY Pd, Ps | VOTE.BALLOT Rd, Ps
  //   shfl            SHFL.DOWN Rd, Rs1, imm
  //   ld              LDG Rd, [Rs1+imm]
  //   st              STG [Rs1+imm], Rd
  //   atom            ATOM.ADD Rd, [Rs1], Rs2
  const ISA = [
    // mnemonic, opcode, fmt, group, what it does, CUDA / PTX / SASS analog
    ['NOP',  0x00, 'none', 'control', 'Do nothing for one instruction slot.', 'SASS NOP'],
    ['EXIT', 0x01, 'none', 'control', 'Guarded lanes finish; the warp retires when every lane has exited.', 'return from __global__; SASS EXIT; PTX exit/ret'],
    ['BRA',  0x02, 'br',   'control', 'Guarded lanes jump to the label. If only some jump, the warp diverges and reconverges by min-PC.', 'if/for/while; PTX bra; SASS BRA'],
    ['BAR',  0x03, 'none', 'control', 'Wait until every warp of the thread block reaches this barrier.', '__syncthreads(); PTX bar.sync 0; SASS BAR.SYNC'],
    ['MOV',  0x04, 'rr',   'data', 'Rd = Rs1.', 'PTX mov.b32; SASS MOV'],
    ['MOVI', 0x05, 'ri18', 'data', 'Rd = sign-extended 18-bit immediate.', 'PTX mov.b32 r, imm; SASS MOV32I'],
    ['S2R',  0x06, 's2r',  'data', 'Rd = special register (TID, CTAID, NTID, NCTAID, LANEID, WARPID, SMID, CLOCK).', 'threadIdx.x / blockIdx.x ...; SASS S2R'],
    ['LDC',  0x07, 'ldc',  'data', 'Rd = kernel parameter c[imm] from the constant bank.', 'kernel arguments live in constant bank 0; SASS LDC / c[0x0][...]'],
    ['ADD',  0x08, 'rrr',  'alu', 'Rd = Rs1 + Rs2.', 'PTX add.s32; SASS IADD3'],
    ['SUB',  0x09, 'rrr',  'alu', 'Rd = Rs1 - Rs2.', 'PTX sub.s32'],
    ['MUL',  0x0A, 'rrr',  'alu', 'Rd = low 32 bits of Rs1 * Rs2.', 'PTX mul.lo.s32; SASS IMAD'],
    ['AND',  0x0B, 'rrr',  'alu', 'Rd = Rs1 & Rs2.', 'PTX and.b32; SASS LOP3'],
    ['OR',   0x0C, 'rrr',  'alu', 'Rd = Rs1 | Rs2.', 'PTX or.b32; SASS LOP3'],
    ['XOR',  0x0D, 'rrr',  'alu', 'Rd = Rs1 ^ Rs2.', 'PTX xor.b32; SASS LOP3'],
    ['SHL',  0x0E, 'rrr',  'alu', 'Rd = Rs1 << Rs2[4:0].', 'PTX shl.b32; SASS SHF'],
    ['SHR',  0x0F, 'rrr',  'alu', 'Rd = Rs1 >> Rs2[4:0] (logical).', 'PTX shr.u32'],
    ['SRA',  0x10, 'rrr',  'alu', 'Rd = Rs1 >> Rs2[4:0] (arithmetic, keeps sign).', 'PTX shr.s32'],
    ['MIN',  0x11, 'rrr',  'alu', 'Rd = signed minimum.', 'PTX min.s32; SASS IMNMX'],
    ['MAX',  0x12, 'rrr',  'alu', 'Rd = signed maximum.', 'PTX max.s32; SASS IMNMX'],
    ['QMUL', 0x13, 'rrr',  'alu', 'Rd = (Rs1 * Rs2) >> 16 — Q16.16 fixed-point multiply (stand-in for FMUL).', 'fixed-point stand-in for PTX mul.f32 / SASS FMUL'],
    ['MAD',  0x14, 'rrrr', 'alu', 'Rd = Rs1 * Rs2 + Rs3 — the multiply-add that dominates GPU work.', 'PTX mad.lo.s32; SASS IMAD (float: FFMA)'],
    ['SEL',  0x15, 'sel',  'alu', 'Rd = Pp ? Rs1 : Rs2 — branch-free select.', 'PTX selp; SASS SEL'],
    ['POPC', 0x16, 'rr',   'alu', 'Rd = number of 1 bits in Rs1.', '__popc(); PTX popc.b32; SASS POPC'],
    ['ADDI', 0x18, 'rri',  'alu', 'Rd = Rs1 + imm14.', 'PTX add.s32 r, r, imm'],
    ['MULI', 0x19, 'rri',  'alu', 'Rd = Rs1 * imm14.', 'PTX mul.lo.s32 r, r, imm'],
    ['ANDI', 0x1A, 'rri',  'alu', 'Rd = Rs1 & imm14.', 'PTX and.b32 r, r, imm'],
    ['ORI',  0x1B, 'rri',  'alu', 'Rd = Rs1 | imm14.', 'PTX or.b32 r, r, imm'],
    ['XORI', 0x1C, 'rri',  'alu', 'Rd = Rs1 ^ imm14.', 'PTX xor.b32 r, r, imm'],
    ['SHLI', 0x1D, 'rri',  'alu', 'Rd = Rs1 << imm.', 'PTX shl.b32 r, r, imm'],
    ['SHRI', 0x1E, 'rri',  'alu', 'Rd = Rs1 >> imm (logical).', 'PTX shr.u32 r, r, imm'],
    ['SRAI', 0x1F, 'rri',  'alu', 'Rd = Rs1 >> imm (arithmetic).', 'PTX shr.s32 r, r, imm'],
    ['SETP', 0x20, 'setp', 'predicate', 'Pd = compare(Rs1, Rs2) with EQ NE LT LE GT GE LTU GEU.', 'PTX setp.lt.s32; SASS ISETP'],
    ['VOTE', 0x21, 'vote', 'warp', 'ANY/ALL: Pd = any/all active lanes have Ps. BALLOT: Rd = bitmask of lanes with Ps.', '__any_sync / __all_sync / __ballot_sync; SASS VOTE'],
    ['SHFL', 0x22, 'shfl', 'warp', 'Read Rs1 from another lane: IDX lane, UP by n, DOWN by n, XOR n.', '__shfl_sync / __shfl_down_sync / __shfl_xor_sync; SASS SHFL'],
    ['LDG',  0x28, 'ld',   'memory', 'Rd = global[Rs1 + imm]. Coalesced into cache-line transactions.', 'PTX ld.global; SASS LDG'],
    ['STG',  0x29, 'st',   'memory', 'global[Rs1 + imm] = Rd.', 'PTX st.global; SASS STG'],
    ['LDS',  0x2A, 'ld',   'memory', 'Rd = shared[Rs1 + imm]. One access per bank per cycle.', '__shared__ read; PTX ld.shared; SASS LDS'],
    ['STS',  0x2B, 'st',   'memory', 'shared[Rs1 + imm] = Rd.', '__shared__ write; PTX st.shared; SASS STS'],
    ['ATOM', 0x2C, 'atom', 'memory', 'Rd = global[Rs1]; global[Rs1] += Rs2, atomically, one lane at a time.', 'atomicAdd(); PTX atom.global.add; SASS ATOMG / RED'],
    ['ATOMS',0x2D, 'atom', 'memory', 'Rd = shared[Rs1]; shared[Rs1] += Rs2, atomically.', 'atomicAdd on __shared__; PTX atom.shared.add; SASS ATOMS'],
  ].map(([name, code, fmt, group, desc, cuda]) => ({ name, code, fmt, group, desc, cuda }));

  const BY_NAME = {}; const BY_CODE = {};
  for (const e of ISA) { BY_NAME[e.name] = e; BY_CODE[e.code] = e; }

  const CMP = ['EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'LTU', 'GEU'];
  const SR = ['TID', 'CTAID', 'NTID', 'NCTAID', 'LANEID', 'WARPID', 'SMID', 'CLOCK'];
  const SHFL = ['IDX', 'UP', 'DOWN', 'XOR'];
  const VOTE = ['ANY', 'ALL', 'BALLOT'];
  const STAGES = ['SCHED', 'FETCH', 'DECODE', 'EXEC', 'MEM', 'WB'];

  const DEFAULT_CFG = {
    numSms: 2, numWarps: 4, warpSize: 8, numRegs: 16, lineWords: 4,
    smemWords: 256, smemBanks: 8, imemWords: 1024, constWords: 16,
    gmemWords: 65536, lat: 8,
  };

  // ---------------------------------------------------------------------------
  // 2. Assembler
  // ---------------------------------------------------------------------------
  class AsmError extends Error {
    constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; }
  }

  // tiny expression evaluator: numbers, names, + - * / % << >> & | ^ ( ) unary -
  function evalExpr(text, symbols, line) {
    const toks = text.match(/0x[0-9a-fA-F]+|0b[01]+|\d+|[A-Za-z_.$][\w.$]*|<<|>>|[-+*/%&|^()~]/g);
    if (!toks || toks.join('') !== text.replace(/\s+/g, '')) throw new AsmError(line, `cannot parse expression "${text}"`);
    let i = 0;
    const peek = () => toks[i];
    const next = () => toks[i++];
    function primary() {
      const t = next();
      if (t === undefined) throw new AsmError(line, `unexpected end of "${text}"`);
      if (t === '(') { const v = bor(); if (next() !== ')') throw new AsmError(line, 'missing )'); return v; }
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (t === '~') return ~primary();
      if (/^0x/i.test(t)) return parseInt(t, 16);
      if (/^0b/i.test(t)) return parseInt(t.slice(2), 2);
      if (/^\d/.test(t)) return parseInt(t, 10);
      const key = t.toUpperCase();
      if (key in symbols) return symbols[key];
      throw new AsmError(line, `unknown symbol "${t}"`);
    }
    function mul() { let v = primary(); while (['*', '/', '%'].includes(peek())) { const o = next(); const r = primary(); v = o === '*' ? v * r : o === '/' ? Math.trunc(v / r) : v % r; } return v; }
    function add() { let v = mul(); while (['+', '-'].includes(peek())) { const o = next(); const r = mul(); v = o === '+' ? v + r : v - r; } return v; }
    function sh() { let v = add(); while (['<<', '>>'].includes(peek())) { const o = next(); const r = add(); v = o === '<<' ? v << r : v >> r; } return v; }
    function band() { let v = sh(); while (peek() === '&') { next(); v &= sh(); } return v; }
    function bxor() { let v = band(); while (peek() === '^') { next(); v ^= band(); } return v; }
    function bor() { let v = bxor(); while (peek() === '|') { next(); v |= bxor(); } return v; }
    const v = bor();
    if (i !== toks.length) throw new AsmError(line, `junk after expression "${text}"`);
    return v;
  }

  function splitOperands(s) {
    const out = []; let depth = 0; let cur = '';
    for (const ch of s) {
      if (ch === '[') depth++;
      if (ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function lcg(seed) {
    let x = (seed >>> 0) || 1;
    return () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return (x >>> 1) & 0x7fffffff; };
  }

  /**
   * Assemble Pixelstorm assembly.
   * Returns { words, srcLine[pc], labels, config, listing }.
   */
  function assemble(src) {
    const lines = src.split(/\r?\n/);
    const symbols = {};
    for (let k = 0; k < SR.length; k++) { symbols[SR[k]] = k; symbols['SR_' + SR[k]] = k; symbols['%' + SR[k]] = k; }
    const config = { name: 'kernel', grid: 1, block: 8, params: new Array(16).fill(0), data: [], dump: [], lat: null, sms: null, notes: [], fb: null };
    const insts = [];   // {line, guard, mnem, suffix, ops, text}
    const labels = {};

    // ---- pass 1: directives, labels, instruction list ----
    lines.forEach((raw, idx) => {
      const ln = idx + 1;
      let s = raw.replace(/(;|\/\/|#).*$/, '').trim();
      if (!s) return;
      let m;
      while ((m = s.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/))) {
        const lab = m[1].toUpperCase();
        if (lab in labels) throw new AsmError(ln, `label "${m[1]}" defined twice`);
        labels[lab] = insts.length;
        s = m[2].trim();
      }
      if (!s) return;
      if (s[0] === '.') {
        const dir = s.split(/\s+/)[0];
        const args = s.slice(dir.length).trim();
        const rest = args.split(/[\s,]+/).filter(Boolean);
        // arguments are comma-separated, so each one may be a full expression: .param 5, 4 * ONE
        const nums = () => args.split(',').map(t => t.trim()).filter(Boolean).map(t => evalExpr(t, symbols, ln));
        switch (dir.toLowerCase()) {
          case '.kernel': config.name = rest[0] || 'kernel'; break;
          case '.grid': config.grid = nums()[0]; break;
          case '.block': config.block = nums()[0]; break;
          case '.lat': config.lat = nums()[0]; break;
          case '.sms': config.sms = nums()[0]; break;
          case '.equ': case '.set': {
            const mm = args.match(/^([A-Za-z_][\w]*)\s*[, =]\s*(.+)$/);
            if (!mm) throw new AsmError(ln, '.equ NAME value');
            symbols[mm[1].toUpperCase()] = evalExpr(mm[2].trim(), symbols, ln);
            break;
          }
          case '.param': { const [i, v] = nums(); if (i < 0 || i > 15) throw new AsmError(ln, 'param index 0..15'); config.params[i] = v >>> 0; break; }
          case '.data': { const v = nums(); config.data.push({ addr: v[0], values: v.slice(1).map(x => x >>> 0) }); break; }
          case '.seq': { const [a, n, st, step] = nums(); config.data.push({ addr: a, values: Array.from({ length: n }, (_, k) => (st + k * (step === undefined ? 1 : step)) >>> 0) }); break; }
          case '.fill': { const [a, n, v] = nums(); config.data.push({ addr: a, values: new Array(n).fill(v >>> 0) }); break; }
          case '.rand': { const [a, n, seed, max] = nums(); const r = lcg(seed); config.data.push({ addr: a, values: Array.from({ length: n }, () => r() % (max || 256)) }); break; }
          case '.dump': {
            const a = evalExpr(rest[0], symbols, ln); const n = evalExpr(rest[1], symbols, ln);
            const label = args.replace(/^\S+[\s,]+\S+[\s,]*/, '');
            config.dump.push({ addr: a, count: n, label }); break;
          }
          case '.note': config.notes.push(args); break;
          case '.fb': {   // framebuffer: .fb addr, width, height  (one 0x00RRGGBB word per pixel, row-major)
            const [a, w, h] = nums();
            if (!(w > 0 && h > 0)) throw new AsmError(ln, '.fb needs address, width, height');
            config.fb = { addr: a, width: w, height: h }; break;
          }
          default: throw new AsmError(ln, `unknown directive ${dir}`);
        }
        return;
      }
      let guard = null;
      m = s.match(/^@(!?)\s*P([0-3])\s+(.*)$/i);
      if (m) { guard = { neg: m[1] === '!', p: +m[2] }; s = m[3]; }
      m = s.match(/^([A-Za-z][A-Za-z0-9]*)((?:\.[A-Za-z]+)*)\s*(.*)$/);
      if (!m) throw new AsmError(ln, `cannot parse "${raw.trim()}"`);
      insts.push({ line: ln, guard, mnem: m[1].toUpperCase(), suffix: m[2].toUpperCase().split('.').filter(Boolean), ops: splitOperands(m[3]), text: raw.trim() });
    });

    for (const k in labels) symbols[k] = labels[k];

    // ---- pass 2: encode ----
    const words = []; const srcLine = [];
    for (const ins of insts) {
      words.push(encodeInst(ins, symbols));
      srcLine.push(ins.line);
    }
    const listing = words.map((w, pc) => ({ pc, word: w, hex: hex8(w), asm: disasm(w), line: srcLine[pc] }));
    return { words, srcLine, labels, config, listing };
  }

  function reg(tok, ln) {
    const m = /^R(\d+)$/i.exec(tok || '');
    if (!m || +m[1] > 15) throw new AsmError(ln, `expected register R0..R15, got "${tok}"`);
    return +m[1];
  }
  function preg(tok, ln) {
    const m = /^P([0-3])$/i.exec(tok || '');
    if (!m) throw new AsmError(ln, `expected predicate P0..P3, got "${tok}"`);
    return +m[1];
  }
  function fitSigned(v, bits, ln, what) {
    const lo = -(1 << (bits - 1)); const hi = (1 << (bits - 1)) - 1;
    if (v < lo || v > hi) throw new AsmError(ln, `${what} ${v} does not fit in ${bits} signed bits (${lo}..${hi})`);
    return v & ((1 << bits) - 1);
  }
  function memOperand(tok, symbols, ln) {
    const m = /^\[\s*(R\d+)\s*(?:([+-])\s*(.+))?\]$/i.exec(tok || '');
    if (!m) throw new AsmError(ln, `expected [Rn], [Rn+imm] or [Rn-imm], got "${tok}"`);
    let off = m[3] ? evalExpr(m[3].trim(), symbols, ln) : 0;
    if (m[2] === '-') off = -off;
    return { r: reg(m[1], ln), off };
  }

  function encodeInst(ins, symbols) {
    const ln = ins.line;
    const e = BY_NAME[ins.mnem];
    if (!e) throw new AsmError(ln, `unknown instruction "${ins.mnem}"`);
    const ops = ins.ops;
    const need = (n) => { if (ops.length !== n) throw new AsmError(ln, `${e.name} expects ${n} operand(s), got ${ops.length}`); };
    const imm = (t) => evalExpr(t, symbols, ln);
    let f = { rd: 0, rs1: 0, rs2: 0, rs3: 0, low: 0, imm14: null, imm18: null };
    switch (e.fmt) {
      case 'none': need(0); break;
      case 'br': need(1); f.imm18 = fitSigned(imm(ops[0]), 18, ln, 'target'); break;
      case 'rr': need(2); f.rd = reg(ops[0], ln); f.rs1 = reg(ops[1], ln); break;
      case 'ri18': need(2); f.rd = reg(ops[0], ln); f.imm18 = fitSigned(imm(ops[1]), 18, ln, 'immediate'); break;
      case 's2r': {
        need(2); f.rd = reg(ops[0], ln);
        const name = ops[1].toUpperCase().replace(/^%|^SR_/, '').replace(/\.X$/, '');
        const k = SR.indexOf(name);
        if (k < 0) throw new AsmError(ln, `unknown special register "${ops[1]}" (use ${SR.join(', ')})`);
        f.imm14 = k; break;
      }
      case 'ldc': {
        need(2); f.rd = reg(ops[0], ln);
        const m = /^c\s*\[(.+)\]$/i.exec(ops[1]);
        if (!m) throw new AsmError(ln, 'LDC Rd, c[index]');
        const k = imm(m[1]); if (k < 0 || k > 15) throw new AsmError(ln, 'constant index 0..15');
        f.imm14 = k; break;
      }
      case 'rrr': need(3); f.rd = reg(ops[0], ln); f.rs1 = reg(ops[1], ln); f.rs2 = reg(ops[2], ln); break;
      case 'rrrr': need(4); f.rd = reg(ops[0], ln); f.rs1 = reg(ops[1], ln); f.rs2 = reg(ops[2], ln); f.rs3 = reg(ops[3], ln); break;
      case 'sel': need(4); f.rd = reg(ops[0], ln); f.rs1 = reg(ops[1], ln); f.rs2 = reg(ops[2], ln); f.low = preg(ops[3], ln); break;
      case 'rri': need(3); f.rd = reg(ops[0], ln); f.rs1 = reg(ops[1], ln); f.imm14 = fitSigned(imm(ops[2]), 14, ln, 'immediate'); break;
      case 'setp': {
        need(3);
        const c = CMP.indexOf(ins.suffix[0] || '');
        if (c < 0) throw new AsmError(ln, `SETP needs a comparison suffix: ${CMP.map(x => 'SETP.' + x).join(' ')}`);
        f.rd = preg(ops[0], ln); f.rs1 = reg(ops[1], ln); f.rs2 = reg(ops[2], ln); f.low = c; break;
      }
      case 'vote': {
        need(2);
        const v = VOTE.indexOf(ins.suffix[0] || '');
        if (v < 0) throw new AsmError(ln, 'VOTE.ANY Pd, Ps | VOTE.ALL Pd, Ps | VOTE.BALLOT Rd, Ps');
        f.rd = v === 2 ? reg(ops[0], ln) : preg(ops[0], ln);
        f.rs1 = preg(ops[1], ln); f.low = v; break;
      }
      case 'shfl': {
        need(3);
        const mo = SHFL.indexOf(ins.suffix[0] || '');
        if (mo < 0) throw new AsmError(ln, 'SHFL.IDX / SHFL.UP / SHFL.DOWN / SHFL.XOR Rd, Rs1, imm');
        f.rd = reg(ops[0], ln); f.rs1 = reg(ops[1], ln);
        const n = imm(ops[2]); if (n < 0 || n > 31) throw new AsmError(ln, 'shuffle amount 0..31');
        f.imm14 = (mo << 12) | n; break;
      }
      case 'ld': { need(2); f.rd = reg(ops[0], ln); const mo = memOperand(ops[1], symbols, ln); f.rs1 = mo.r; f.imm14 = fitSigned(mo.off, 14, ln, 'offset'); break; }
      case 'st': { need(2); const mo = memOperand(ops[0], symbols, ln); f.rd = reg(ops[1], ln); f.rs1 = mo.r; f.imm14 = fitSigned(mo.off, 14, ln, 'offset'); break; }
      case 'atom': {
        need(3);
        if (ins.suffix.length && ins.suffix[0] !== 'ADD') throw new AsmError(ln, 'only ATOM.ADD is implemented (try adding ATOM.MAX as an exercise!)');
        f.rd = reg(ops[0], ln); const mo = memOperand(ops[1], symbols, ln);
        if (mo.off !== 0) throw new AsmError(ln, 'atomics take [Rn] with no offset');
        f.rs1 = mo.r; f.rs2 = reg(ops[2], ln); break;
      }
      default: throw new AsmError(ln, 'internal: bad fmt');
    }
    let w = (e.code << 26);
    if (ins.guard) w |= (1 << 25) | ((ins.guard.neg ? 1 : 0) << 24) | (ins.guard.p << 22);
    w |= (f.rd & 15) << 18;
    if (f.imm18 !== null) w |= f.imm18 & 0x3ffff;
    else {
      w |= (f.rs1 & 15) << 14;
      if (f.imm14 !== null) w |= f.imm14 & 0x3fff;
      else w |= ((f.rs2 & 15) << 10) | ((f.rs3 & 15) << 6) | (f.low & 7);
    }
    return w >>> 0;
  }

  // ---------------------------------------------------------------------------
  // 3. Decoder / disassembler (mirrors rtl/ps_decoder.v)
  // ---------------------------------------------------------------------------
  const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
  function decode(w) {
    w >>>= 0;
    const op = w >>> 26;
    const d = {
      word: w, op, e: BY_CODE[op] || null,
      gEn: (w >>> 25) & 1, gNeg: (w >>> 24) & 1, gP: (w >>> 22) & 3,
      rd: (w >>> 18) & 15, rs1: (w >>> 14) & 15, rs2: (w >>> 10) & 15, rs3: (w >>> 6) & 15,
      imm14: sext(w & 0x3fff, 14), imm18: sext(w & 0x3ffff, 18),
      cmp: w & 7, selp: w & 3, smode: (w >>> 12) & 3, sval: w & 31, vmode: w & 3,
    };
    const n = d.e ? d.e.name : '???';
    d.writesRd = ['MOV', 'MOVI', 'S2R', 'LDC', 'ADD', 'SUB', 'MUL', 'AND', 'OR', 'XOR', 'SHL', 'SHR', 'SRA', 'MIN', 'MAX', 'QMUL', 'MAD', 'SEL', 'POPC',
      'ADDI', 'MULI', 'ANDI', 'ORI', 'XORI', 'SHLI', 'SHRI', 'SRAI', 'SHFL', 'LDG', 'LDS', 'ATOM', 'ATOMS'].includes(n) || (n === 'VOTE' && d.vmode === 2);
    d.writesPred = n === 'SETP' || (n === 'VOTE' && d.vmode !== 2);
    d.isMem = ['LDG', 'STG', 'LDS', 'STS', 'ATOM', 'ATOMS'].includes(n);
    d.isShared = ['LDS', 'STS', 'ATOMS'].includes(n);
    d.isLoad = n === 'LDG' || n === 'LDS';
    d.isStore = n === 'STG' || n === 'STS';
    d.isAtom = n === 'ATOM' || n === 'ATOMS';
    d.isBranch = n === 'BRA'; d.isExit = n === 'EXIT'; d.isBar = n === 'BAR';
    d.name = n;
    return d;
  }

  function disasm(w) {
    const d = decode(w);
    if (!d.e) return `.word 0x${hex8(w)}`;
    const g = d.gEn ? `@${d.gNeg ? '!' : ''}P${d.gP} ` : '';
    const R = (x) => 'R' + x; const P = (x) => 'P' + x;
    const off = (v) => v === 0 ? '' : v > 0 ? `+${v}` : `${v}`;
    let s;
    switch (d.e.fmt) {
      case 'none': s = d.name; break;
      case 'br': s = `BRA ${d.imm18}`; break;
      case 'rr': s = `${d.name} ${R(d.rd)}, ${R(d.rs1)}`; break;
      case 'ri18': s = `MOVI ${R(d.rd)}, ${d.imm18}`; break;
      case 's2r': s = `S2R ${R(d.rd)}, ${SR[d.imm14 & 7]}`; break;
      case 'ldc': s = `LDC ${R(d.rd)}, c[${d.imm14 & 15}]`; break;
      case 'rrr': s = `${d.name} ${R(d.rd)}, ${R(d.rs1)}, ${R(d.rs2)}`; break;
      case 'rrrr': s = `${d.name} ${R(d.rd)}, ${R(d.rs1)}, ${R(d.rs2)}, ${R(d.rs3)}`; break;
      case 'sel': s = `SEL ${R(d.rd)}, ${R(d.rs1)}, ${R(d.rs2)}, ${P(d.selp)}`; break;
      case 'rri': s = `${d.name} ${R(d.rd)}, ${R(d.rs1)}, ${d.imm14}`; break;
      case 'setp': s = `SETP.${CMP[d.cmp]} ${P(d.rd & 3)}, ${R(d.rs1)}, ${R(d.rs2)}`; break;
      case 'vote': s = d.vmode === 2 ? `VOTE.BALLOT ${R(d.rd)}, ${P(d.rs1 & 3)}` : `VOTE.${VOTE[d.vmode] || 'ANY'} ${P(d.rd & 3)}, ${P(d.rs1 & 3)}`; break;
      case 'shfl': s = `SHFL.${SHFL[d.smode]} ${R(d.rd)}, ${R(d.rs1)}, ${d.sval}`; break;
      case 'ld': s = `${d.name} ${R(d.rd)}, [${R(d.rs1)}${off(d.imm14)}]`; break;
      case 'st': s = `${d.name} [${R(d.rs1)}${off(d.imm14)}], ${R(d.rd)}`; break;
      case 'atom': s = `${d.name}.ADD ${R(d.rd)}, [${R(d.rs1)}], ${R(d.rs2)}`; break;
      default: s = d.name;
    }
    return g + s;
  }

  function hex8(w) { return (w >>> 0).toString(16).padStart(8, '0'); }

  // ---------------------------------------------------------------------------
  // 4. Cycle-level simulator (mirrors rtl/*.v register by register)
  // ---------------------------------------------------------------------------
  const u32 = (x) => x >>> 0;
  const s32 = (x) => x | 0;

  function aluOp(d, a, b, c, psel, srv, cval) {
    const sh = b & 31; const ish = d.imm14 & 31; const i14 = d.imm14;
    let y = 0; let p = 0;
    switch (d.name) {
      case 'MOV': y = a; break;
      case 'MOVI': y = d.imm18; break;
      case 'S2R': y = srv; break;
      case 'LDC': y = cval; break;
      case 'ADD': y = a + b; break;
      case 'SUB': y = a - b; break;
      case 'MUL': y = Math.imul(a, b); break;
      case 'AND': y = a & b; break;
      case 'OR': y = a | b; break;
      case 'XOR': y = a ^ b; break;
      case 'SHL': y = a << sh; break;
      case 'SHR': y = a >>> sh; break;
      case 'SRA': y = s32(a) >> sh; break;
      case 'MIN': y = s32(a) < s32(b) ? a : b; break;
      case 'MAX': y = s32(a) > s32(b) ? a : b; break;
      case 'QMUL': y = Number(BigInt.asUintN(32, (BigInt(s32(a)) * BigInt(s32(b))) >> 16n)); break;
      case 'MAD': y = Math.imul(a, b) + c; break;
      case 'SEL': y = psel ? a : b; break;
      case 'POPC': { let v = u32(a); let n = 0; while (v) { n += v & 1; v >>>= 1; } y = n; break; }
      case 'ADDI': y = a + i14; break;
      case 'MULI': y = Math.imul(a, i14); break;
      case 'ANDI': y = a & i14; break;
      case 'ORI': y = a | i14; break;
      case 'XORI': y = a ^ i14; break;
      case 'SHLI': y = a << ish; break;
      case 'SHRI': y = u32(a) >>> ish; break;
      case 'SRAI': y = s32(a) >> ish; break;
      case 'SETP': {
        const sa = s32(a), sb = s32(b), ua = u32(a), ub = u32(b);
        p = [ua === ub, ua !== ub, sa < sb, sa <= sb, sa > sb, sa >= sb, ua < ub, ua >= ub][d.cmp] ? 1 : 0;
        break;
      }
      default: break;
    }
    return { y: u32(y), p };
  }

  class Simulator {
    constructor(cfg = {}) {
      this.cfg = Object.assign({}, DEFAULT_CFG, cfg);
      const c = this.cfg;
      this.imem = new Uint32Array(c.imemWords);
      this.cmem = new Uint32Array(c.constWords);
      this.gmem = new Uint32Array(c.gmemWords);
      this.sms = [];
      for (let s = 0; s < c.numSms; s++) this.sms.push(this._newSM(s));
    }

    _newSM(id) {
      const c = this.cfg; const NT = c.numWarps * c.warpSize;
      return {
        id, state: 'IDLE', busy: 0, blk: 0, bdim: 0, gdim: 0,
        wValid: new Uint8Array(c.numWarps), wWait: new Uint8Array(c.numWarps),
        lpc: new Int32Array(NT), ldone: new Uint8Array(NT).fill(1), preds: new Uint8Array(NT),
        rf: new Uint32Array(NT * c.numRegs), smem: new Uint32Array(c.smemWords),
        rr: 0, cw: 0, cpc: 0, cact: [], cexe: [], ir: 0, d: null,
        res: [], pres: [], npc: [], ndone: [], addr: [], data: [],
        lpend: [], lserve: [], lwait: 0, txn: 0, mcyc: 0,
        mreq: { valid: 0, op: 0, addr: 0, wmask: [], wdata: [] },
        t: [0, 0, 0, 0, 0],
      };
    }

    load(program, params = [], dataBlocks = []) {
      this.imem.fill(0);
      program.forEach((w, i) => { this.imem[i] = w >>> 0; });
      this.cmem.fill(0);
      params.forEach((v, i) => { this.cmem[i] = v >>> 0; });
      this.gmem.fill(0);
      for (const blk of dataBlocks) blk.values.forEach((v, i) => { this.gmem[(blk.addr + i) % this.cfg.gmemWords] = v >>> 0; });
    }

    /** Run a kernel launch <<<grid, block>>>. Returns { cycles, events, gmem, stats }. */
    run(grid, block, opts = {}) {
      const c = this.cfg;
      if (block > c.numWarps * c.warpSize) throw new Error(`block size ${block} is larger than one SM holds (${c.numWarps} warps x ${c.warpSize} lanes = ${c.numWarps * c.warpSize})`);
      const trace = opts.trace !== false;
      const maxCycles = opts.maxCycles || 2000000;
      const ev = []; const emit = trace ? (e) => ev.push(e) : () => { };
      const stats = { instructions: 0, laneOps: 0, activeLaneSlots: 0, globalTxns: 0, sharedPasses: 0, divergentIssues: 0 };

      // dispatcher, arbiter, memory registers
      const disp = { running: 1, done: 0, next: 0, start: new Array(c.numSms).fill(0), blkId: 0 };
      const arb = { busy: 0, owner: 0, rr: 0, reqValid: 0, req: null };
      const mem = { pend: 0, cnt: 0, req: null, respValid: 0, rdata: new Array(c.lineWords).fill(0) };

      let cycle = 0;
      for (; cycle < maxCycles; cycle++) {
        // ---- snapshot of every register another block reads this cycle ----
        const P = {
          start: disp.start.slice(), blkId: disp.blkId,
          busy: this.sms.map(s => s.busy),
          reqValid: this.sms.map(s => s.mreq.valid),
          req: this.sms.map(s => Object.assign({}, s.mreq)),
          arbBusy: arb.busy, arbOwner: arb.owner, arbReqValid: arb.reqValid, arbReq: arb.req,
          memRespValid: mem.respValid, memRdata: mem.rdata.slice(),
        };
        if (disp.done) break;

        // ---- dispatcher ----
        disp.start = new Array(c.numSms).fill(0);
        if (disp.running) {
          if (disp.next < grid) {
            for (let s = 0; s < c.numSms; s++) {
              if (!P.busy[s] && !P.start[s]) { disp.start[s] = 1; disp.blkId = disp.next; disp.next++; break; }
            }
          } else if (P.busy.every(b => !b) && P.start.every(b => !b)) {
            disp.running = 0; disp.done = 1;
          }
        }

        // ---- arbiter ----
        arb.reqValid = 0;
        if (!P.arbBusy) {
          for (let i = 0; i < c.numSms; i++) {
            const k = (arb.rr + i) % c.numSms;
            if (P.reqValid[k]) {
              arb.busy = 1; arb.owner = k; arb.reqValid = 1; arb.req = P.req[k];
              emit({ ev: 'mreq', t: cycle, sm: k, op: P.req[k].op, a: P.req[k].addr, wm: maskToInt(P.req[k].wmask) });
              break;
            }
          }
        } else if (P.memRespValid) {
          arb.busy = 0; arb.rr = (arb.owner + 1) % c.numSms;
        }

        // ---- DRAM model ----
        mem.respValid = 0;
        if (P.arbReqValid) {
          mem.pend = 1; mem.cnt = c.lat; mem.req = P.arbReq;
        } else if (mem.pend) {
          if (mem.cnt <= 1) {
            mem.pend = 0; mem.respValid = 1;
            const r = mem.req; const G = c.gmemWords;
            if (r.op === 0) {
              for (let w = 0; w < c.lineWords; w++) mem.rdata[w] = this.gmem[(r.addr + w) % G];
            } else if (r.op === 1) {
              for (let w = 0; w < c.lineWords; w++) if (r.wmask[w]) {
                const a = (r.addr + w) % G; this.gmem[a] = r.wdata[w];
                emit({ ev: 'gw', t: cycle, a, v: r.wdata[w] });
              }
            } else {
              const a = r.addr % G; const old = this.gmem[a];
              mem.rdata = new Array(c.lineWords).fill(0); mem.rdata[0] = old;
              this.gmem[a] = u32(old + r.wdata[0]);
              emit({ ev: 'gw', t: cycle, a, v: this.gmem[a] });
            }
          } else mem.cnt--;
        }

        // ---- SMs ----
        for (const sm of this.sms) {
          const respValid = P.arbBusy && P.memRespValid && P.arbOwner === sm.id;
          this._stepSM(sm, cycle, P.start[sm.id], P.blkId, block, grid, respValid, P.memRdata, emit, stats);
        }
      }
      emit({ ev: 'done', t: cycle, ok: disp.done ? 1 : 0 });
      return { cycles: cycle, events: ev, gmem: this.gmem, stats, timeout: !disp.done };
    }

    _stepSM(sm, cycle, start, blkId, bdim, gdim, respValid, rdata, emit, stats) {
      const c = this.cfg; const WS = c.warpSize; const NW = c.numWarps; const NR = c.numRegs;
      const liveW = (w) => {
        if (!sm.wValid[w]) return false;
        for (let l = 0; l < WS; l++) if (!sm.ldone[w * WS + l]) return true;
        return false;
      };
      const minPc = (w) => {
        let m = Infinity;
        for (let l = 0; l < WS; l++) if (!sm.ldone[w * WS + l] && sm.lpc[w * WS + l] < m) m = sm.lpc[w * WS + l];
        return m;
      };
      switch (sm.state) {
        case 'IDLE':
          if (start) {
            sm.busy = 1; sm.blk = blkId; sm.bdim = bdim; sm.gdim = gdim;
            for (let w = 0; w < NW; w++) { sm.wValid[w] = w * WS < bdim ? 1 : 0; sm.wWait[w] = 0; }
            for (let i = 0; i < NW * WS; i++) { sm.ldone[i] = i >= bdim ? 1 : 0; sm.lpc[i] = 0; sm.preds[i] = 0; }
            sm.rr = 0; sm.state = 'SCHED';
            emit({ ev: 'blk', t: cycle, sm: sm.id, blk: blkId, ph: 'start' });
          }
          break;
        case 'SCHED': {
          const live = []; for (let w = 0; w < NW; w++) live.push(liveW(w));
          const anyWaitLive = live.some((l, w) => l && sm.wWait[w]);
          const allLiveWaiting = live.every((l, w) => !l || sm.wWait[w]);
          if (anyWaitLive && allLiveWaiting) {
            sm.wWait.fill(0);
            emit({ ev: 'bar', t: cycle, sm: sm.id, blk: sm.blk });
            break;
          }
          let pick = -1;
          for (let i = 0; i < NW; i++) { const k = (sm.rr + i) % NW; if (live[k] && !sm.wWait[k]) { pick = k; break; } }
          if (pick >= 0) {
            const m = minPc(pick);
            sm.cw = pick; sm.cpc = m;
            sm.cact = []; for (let l = 0; l < WS; l++) sm.cact.push(!sm.ldone[pick * WS + l] && sm.lpc[pick * WS + l] === m ? 1 : 0);
            sm.t = [cycle, 0, 0, 0, 0];
            sm.state = 'FETCH';
          } else if (!live.some(Boolean)) {
            sm.busy = 0; sm.state = 'IDLE';
            emit({ ev: 'blk', t: cycle, sm: sm.id, blk: sm.blk, ph: 'end' });
          }
          break;
        }
        case 'FETCH':
          sm.ir = this.imem[sm.cpc % c.imemWords]; sm.t[1] = cycle; sm.state = 'DECODE';
          break;
        case 'DECODE': {
          const d = sm.d = decode(sm.ir);
          sm.cexe = sm.cact.map((a, l) => {
            const pr = sm.preds[sm.cw * WS + l];
            const g = !d.gEn || ((((pr >> d.gP) & 1) ^ d.gNeg) === 1);
            return a && g ? 1 : 0;
          });
          sm.t[2] = cycle; sm.state = 'EXEC';
          break;
        }
        case 'EXEC': {
          const d = sm.d; const w = sm.cw;
          const A = [], B = [], C = [], D = [];
          for (let l = 0; l < WS; l++) {
            const base = (w * WS + l) * NR;
            A.push(sm.rf[base + d.rs1]); B.push(sm.rf[base + d.rs2]); C.push(sm.rf[base + d.rs3]); D.push(sm.rf[base + d.rd]);
          }
          const ballotBits = sm.cexe.map((e, l) => e && ((sm.preds[w * WS + l] >> (d.rs1 & 3)) & 1) ? 1 : 0);
          const ballot = maskToInt(ballotBits);
          const vAny = ballot !== 0; const vAll = ballot === maskToInt(sm.cexe);
          const cval = this.cmem[d.imm14 & (c.constWords - 1)];
          sm.res = []; sm.pres = []; sm.npc = []; sm.ndone = []; sm.addr = []; sm.data = [];
          for (let l = 0; l < WS; l++) {
            const tid = w * WS + l;
            const srv = [tid, sm.blk, sm.bdim, sm.gdim, l, w, sm.id, cycle][d.imm14 & 7];
            const pr = sm.preds[tid];
            let { y, p } = aluOp(d, A[l], B[l], C[l], (pr >> d.selp) & 1, u32(srv), cval);
            if (d.name === 'SHFL') {
              let src, ok;
              if (d.smode === 0) { src = d.sval % WS; ok = true; }
              else if (d.smode === 1) { src = l - d.sval; ok = l >= d.sval; }
              else if (d.smode === 2) { src = l + d.sval; ok = l + d.sval < WS; }
              else { src = l ^ d.sval; ok = (l ^ d.sval) < WS; }
              y = ok && sm.cact[src] ? A[src] : A[l];
            }
            if (d.name === 'VOTE') { y = ballot; p = d.vmode === 1 ? (vAll ? 1 : 0) : (vAny ? 1 : 0); }
            sm.res.push(u32(y)); sm.pres.push(p);
            const cur = sm.lpc[tid];
            sm.npc.push(!sm.cact[l] ? cur : (sm.cexe[l] && d.isBranch) ? (d.imm18 & (c.imemWords - 1)) : (sm.cexe[l] && d.isExit) ? sm.cpc : sm.cpc + 1);
            sm.ndone.push(sm.ldone[tid] | (sm.cact[l] && sm.cexe[l] && d.isExit ? 1 : 0));
            sm.addr.push(u32(d.isAtom ? A[l] : A[l] + d.imm14));
            sm.data.push(u32(d.isAtom ? B[l] : D[l]));
          }
          sm.lpend = d.isMem ? sm.cexe.slice() : new Array(WS).fill(0);
          sm.lwait = 0; sm.txn = 0; sm.mcyc = 0;
          sm.t[3] = cycle; sm.t[4] = d.isMem ? cycle + 1 : 0;
          sm.state = d.isMem ? 'MEM' : 'WB';
          break;
        }
        case 'MEM': {
          const d = sm.d; sm.mcyc++;
          const leader = sm.lpend.indexOf(1);
          if (d.isShared) {
            if (leader < 0) { sm.state = 'WB'; break; }
            sm.txn++; stats.sharedPasses++;
            const SA = c.smemWords - 1; const BK = c.smemBanks - 1;
            const used = new Array(c.smemBanks).fill(false); const baddr = new Array(c.smemBanks).fill(0);
            const sel = new Array(WS).fill(0);
            for (let l = 0; l < WS; l++) {
              if (!sm.lpend[l]) continue;
              const a = sm.addr[l] & SA; const b = sm.addr[l] & BK;
              if (d.isAtom) sel[l] = l === leader ? 1 : 0;
              else if (!used[b]) { sel[l] = 1; used[b] = true; baddr[b] = a; }
              else if (baddr[b] === a) sel[l] = 1;
            }
            // reads see the memory as it was at the start of the cycle (like the RTL)
            const snap = sm.smem.slice();
            for (let l = 0; l < WS; l++) if (sel[l]) {
              const a = sm.addr[l] & SA;
              if (d.isLoad) sm.res[l] = snap[a];
              if (d.isStore) { sm.smem[a] = sm.data[l]; emit({ ev: 'sw', t: cycle, sm: sm.id, a, v: sm.data[l] }); }
              if (d.isAtom) { sm.res[l] = snap[a]; sm.smem[a] = u32(snap[a] + sm.data[l]); emit({ ev: 'sw', t: cycle, sm: sm.id, a, v: sm.smem[a] }); }
              sm.lpend[l] = 0;
            }
          } else if (!sm.lwait) {
            if (leader < 0) { sm.state = 'WB'; break; }
            const L = c.lineWords;
            const line = u32(sm.addr[leader] & ~(L - 1));
            const wmask = new Array(L).fill(0); const wdata = new Array(L).fill(0);
            sm.lserve = new Array(WS).fill(0);
            for (let l = 0; l < WS; l++) {
              if (!sm.lpend[l]) continue;
              const a = sm.addr[l];
              sm.lserve[l] = d.isAtom ? (l === leader ? 1 : 0) : (u32(a & ~(L - 1)) === line ? 1 : 0);
              if (sm.lserve[l] && d.isStore) { wmask[a & (L - 1)] = 1; wdata[a & (L - 1)] = sm.data[l]; }
            }
            sm.mreq = {
              valid: 1, op: d.isAtom ? 2 : d.isStore ? 1 : 0,
              addr: d.isAtom ? sm.addr[leader] : line,
              wmask, wdata: d.isAtom ? [sm.data[leader], 0, 0, 0].slice(0, L) : wdata,
            };
            sm.lwait = 1; sm.txn++; stats.globalTxns++;
          } else if (respValid) {
            sm.mreq = Object.assign({}, sm.mreq, { valid: 0 });
            sm.lwait = 0;
            for (let l = 0; l < WS; l++) {
              if (sm.lserve[l] && d.isLoad) sm.res[l] = rdata[sm.addr[l] & (c.lineWords - 1)];
              if (sm.lserve[l] && d.isAtom) sm.res[l] = rdata[0];
              if (sm.lserve[l]) sm.lpend[l] = 0;
            }
          }
          break;
        }
        case 'WB': {
          const d = sm.d; const w = sm.cw;
          let liveBefore = 0; for (let l = 0; l < WS; l++) if (!sm.ldone[w * WS + l]) liveBefore++;
          for (let l = 0; l < WS; l++) {
            const tid = w * WS + l;
            if (sm.cexe[l] && d.writesRd) sm.rf[tid * NR + d.rd] = sm.res[l];
            if (sm.cexe[l] && d.writesPred) {
              const pb = d.rd & 3;
              sm.preds[tid] = (sm.preds[tid] & ~(1 << pb)) | (sm.pres[l] << pb);
            }
            sm.lpc[tid] = sm.npc[l]; sm.ldone[tid] = sm.ndone[l];
          }
          if (d.isBar) sm.wWait[w] = 1;
          sm.rr = (w + 1) % NW;
          sm.state = 'SCHED';
          const act = maskToInt(sm.cact), exe = maskToInt(sm.cexe);
          stats.instructions++; stats.activeLaneSlots += WS; stats.laneOps += popcount(exe);
          if (popcount(act) < liveBefore) stats.divergentIssues++;
          emit({
            ev: 'commit', t: cycle, sm: sm.id, w, blk: sm.blk, pc: sm.cpc, ir: sm.ir,
            st: [sm.t[0], sm.t[1], sm.t[2], sm.t[3], sm.mcyc ? sm.t[4] : 0, cycle],
            act, exe, txn: sm.txn, mcyc: sm.mcyc,
            wr: d.writesRd ? 1 : 0, rd: d.rd, pw: d.writesPred ? 1 : 0, pv: maskToInt(sm.pres.map((p, l) => p & sm.cexe[l])),
            v: sm.res.slice(), lpc: sm.npc.slice(), addr: d.isMem ? sm.addr.slice() : new Array(WS).fill(0),
            done: maskToInt(sm.ndone),
          });
          break;
        }
      }
    }
  }

  function maskToInt(bits) { let m = 0; for (let i = bits.length - 1; i >= 0; i--) m = (m * 2) + (bits[i] ? 1 : 0); return m; }
  function popcount(x) { if (Array.isArray(x)) return x.reduce((a, b) => a + (b ? 1 : 0), 0); let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; }

  /** Assemble + simulate + package a trace in the format the visualizer reads. */
  function buildTrace(src, cfgOverride = {}) {
    const asm = assemble(src);
    const cfg = Object.assign({}, DEFAULT_CFG, cfgOverride);
    if (asm.config.lat !== null && cfgOverride.lat === undefined) cfg.lat = asm.config.lat;
    if (asm.config.sms !== null && cfgOverride.numSms === undefined) cfg.numSms = asm.config.sms;
    const sim = new Simulator(cfg);
    sim.load(asm.words, asm.config.params, asm.config.data);
    const out = sim.run(asm.config.grid, asm.config.block, { trace: true });
    return {
      meta: traceMeta(asm, cfg, src, 'sim', out.cycles),
      events: out.events,
      stats: out.stats,
      gmem: out.gmem,
    };
  }

  function traceMeta(asm, cfg, src, source, cycles) {
    const init = {};
    for (const b of asm.config.data) b.values.forEach((v, i) => { init[b.addr + i] = v; });
    return {
      kernel: asm.config.name, source, cycles,
      grid: asm.config.grid, block: asm.config.block,
      numSms: cfg.numSms, numWarps: cfg.numWarps, warpSize: cfg.warpSize, numRegs: cfg.numRegs,
      lineWords: cfg.lineWords, smemBanks: cfg.smemBanks, smemWords: cfg.smemWords, lat: cfg.lat,
      params: asm.config.params, dump: asm.config.dump, notes: asm.config.notes, fb: asm.config.fb,
      gmemInit: init,
      program: asm.listing,
      src: src.split(/\r?\n/),
    };
  }

  return {
    ISA, BY_NAME, BY_CODE, CMP, SR, SHFL, VOTE, STAGES, DEFAULT_CFG,
    AsmError, assemble, decode, disasm, hex8, Simulator, buildTrace, traceMeta, maskToInt, popcount,
  };
});
