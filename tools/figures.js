#!/usr/bin/env node
/* =============================================================================
 * tools/figures.js — draws every figure in docs/img/ as SVG
 *
 *   node tools/figures.js          (or: make figures)
 *
 * Most figures are computed from real data: the RTL traces in web/traces/,
 * the assembler, and the golden model. Change the hardware, rerun this, and
 * the documentation pictures follow. Figures honour light/dark mode through
 * a prefers-color-scheme block inside each SVG.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('../web/js/pixelstorm.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'img');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// drawing kit
// ---------------------------------------------------------------------------
const STYLE = `
<style>
  .bg{fill:#F7F9FB} .panel{fill:#FFFFFF;stroke:#C9D1DA} .well{fill:#EEF2F6} .box{fill:#EEF2F6;stroke:#C9D1DA;stroke-width:1.2}
  .ink{fill:#182231} .ink2{fill:#4A5566} .ink3{fill:#7C8898} .ln{stroke:#C9D1DA;fill:none} .lnd{stroke:#4A5566;fill:none}
  .fb{fill:#2B57E0} .fg{fill:#13936A} .fa{fill:#D99A06} .fm{fill:#C8325F} .fv{fill:#7A4FD6} .fs{fill:#6B7A90} .fw{fill:#FFFFFF}
  .sb{stroke:#2B57E0;fill:none} .sg{stroke:#13936A;fill:none} .sa{stroke:#D99A06;fill:none} .sm{stroke:#C8325F;fill:none} .sv{stroke:#7A4FD6;fill:none}
  .tb{fill:rgba(43,87,224,.12);stroke:#2B57E0} .tg{fill:rgba(19,147,106,.16);stroke:#13936A} .ta{fill:rgba(217,154,6,.18);stroke:#D99A06}
  .tm{fill:rgba(200,50,95,.12);stroke:#C8325F} .tv{fill:rgba(122,79,214,.14);stroke:#7A4FD6} .ts{fill:rgba(107,122,144,.14);stroke:#6B7A90}
  text{font-family:'Barlow','Segoe UI',Helvetica,Arial,sans-serif;fill:#182231}
  .h{font-family:'Barlow Condensed','Arial Narrow','Segoe UI',sans-serif;font-weight:600}
  .mono{font-family:'JetBrains Mono',Consolas,'Courier New',monospace}
  .w{fill:#FFFFFF}
  @media (prefers-color-scheme: dark){
    .bg{fill:#16202A} .panel{fill:#0F151C;stroke:#2A3845} .well{fill:#1C2733} .box{fill:#1C2733;stroke:#2A3845}
    .ink,text{fill:#E3E9EF} .ink2{fill:#9AA8B8} .ink3{fill:#6D7C8C} .ln{stroke:#2A3845} .lnd{stroke:#9AA8B8}
    .fb{fill:#5B84FF} .fg{fill:#2DBE8C} .fa{fill:#F0B429} .fm{fill:#E5587F} .fv{fill:#A07DF0} .fs{fill:#8594A8}
    .sb{stroke:#5B84FF} .sg{stroke:#2DBE8C} .sa{stroke:#F0B429} .sm{stroke:#E5587F} .sv{stroke:#A07DF0}
    .tb{fill:rgba(91,132,255,.18);stroke:#5B84FF} .tg{fill:rgba(45,190,140,.18);stroke:#2DBE8C} .ta{fill:rgba(240,180,41,.18);stroke:#F0B429}
    .tm{fill:rgba(229,88,127,.16);stroke:#E5587F} .tv{fill:rgba(160,125,240,.18);stroke:#A07DF0} .ts{fill:rgba(133,148,168,.18);stroke:#8594A8}
    .w{fill:#0F151C}
  }
</style>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function svgDoc(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>${STYLE}
<defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ink2"/></marker>
  <marker id="aha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fa"/></marker>
  <marker id="ahb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fb"/></marker>
  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="well"/><line x1="0" y1="0" x2="0" y2="6" class="lnd" stroke-width="1" opacity=".5"/></pattern>
</defs>
<rect width="${w}" height="${h}" class="bg"/>
${body}
</svg>
`;
}
const R = (x, y, w, h, cls, rx = 6, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}" ${extra}/>`;
const T = (x, y, s, cls = '', size = 13, anchor = 'start', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" class="${cls}" ${extra}>${esc(s)}</text>`;
const L = (x1, y1, x2, y2, cls = 'lnd', w = 1.6, marker = 'ah', extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" stroke-width="${w}" ${marker ? `marker-end="url(#${marker})"` : ''} ${extra}/>`;
const P = (d, cls = 'lnd', w = 1.6, marker = 'ah', extra = '') => `<path d="${d}" class="${cls}" stroke-width="${w}" fill="none" ${marker ? `marker-end="url(#${marker})"` : ''} ${extra}/>`;
const box = (x, y, w, h, title, cls = 'box', sub = []) => {
  let s = R(x, y, w, h, cls) + T(x + 10, y + 20, title, 'h', 16);
  sub.forEach((line, i) => { s += T(x + 10, y + 40 + i * 17, line, i === 0 ? 'ink2' : 'mono ink2', 12.5); });
  return s;
};
const GROUP_FILL = { alu: 'fg', memory: 'fa', control: 'fb', warp: 'fv', data: 'fs', predicate: 'fs' };
const write = (name, w, h, body, title) => { fs.writeFileSync(path.join(OUT, name), svgDoc(w, h, body, title)); console.log('docs/img/' + name); };
const trace = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'traces', name + '.json'), 'utf8'));
const bit = (m, i) => (m >>> i) & 1;

// ---------------------------------------------------------------------------
// 1. top-level block diagram
// ---------------------------------------------------------------------------
function figTop() {
  let b = '';
  b += T(20, 32, 'Pixelstorm GPU: top level (rtl/ps_gpu_top.v)', 'h', 22);
  b += T(20, 52, 'Everything inside the dashed outline is synthesizable Verilog. The host and DRAM live in the testbench (sim/tb_gpu.v).', 'ink2', 13);
  b += R(210, 70, 745, 330, 'ln', 10, 'fill="none" stroke-dasharray="6 4" stroke-width="1.5"');
  b += T(222, 90, 'ps_gpu_top', 'mono ink3', 12);
  // host
  b += box(20, 110, 160, 140, 'Host (CPU)', 'tb', ['driver in tb_gpu.v', 'upload program', 'write kernel args', 'pulse launch']);
  b += L(180, 150, 236, 150, 'sb', 1.8, 'ahb') + L(180, 200, 236, 200, 'sb', 1.8, 'ahb') + P('M180,235 L220,235 L220,300 L238,300', 'sb', 1.8, 'ahb');
  b += box(240, 110, 160, 64, 'Instruction memory', 'box', ['1,024 x 32 bit']);
  b += box(240, 180, 160, 64, 'Constant bank', 'box', ['16 words: c[0..15]']);
  b += box(240, 262, 160, 76, 'Block dispatcher', 'tb', ['ps_dispatcher.v', 'one block / cycle']);
  // SMs
  for (let s = 0; s < 2; s++) {
    const y = 110 + s * 200;
    b += R(440, y, 300, 180, 'panel', 8);
    b += T(452, y + 22, `Streaming Multiprocessor ${s}`, 'h', 16) + T(728, y + 22, 'ps_sm.v', 'mono ink3', 11.5, 'end');
    b += R(452, y + 34, 86, 60, 'tb', 5) + T(460, y + 54, 'Warp', 'h', 13.5) + T(460, y + 70, 'scheduler', 'h', 13.5) + T(460, y + 86, '4 warps', 'ink2', 11.5);
    b += R(546, y + 34, 182, 60, 'tg', 5) + T(554, y + 52, '8 lanes (ps_alu x 8)', 'h', 13.5);
    for (let l = 0; l < 8; l++) b += R(554 + l * 21, y + 60, 17, 26, 'fg', 3, 'opacity=".8"');
    b += R(452, y + 102, 86, 66, 'box', 5) + T(460, y + 122, 'Register', 'h', 13.5) + T(460, y + 138, 'file 2 KB', 'h', 13.5) + T(460, y + 156, '+ predicates', 'ink2', 11.5);
    b += R(546, y + 102, 86, 66, 'ta', 5) + T(554, y + 122, 'Load/store', 'h', 13.5) + T(554, y + 138, 'unit', 'h', 13.5) + T(554, y + 156, 'coalescer', 'ink2', 11.5);
    b += R(640, y + 102, 88, 66, 'ta', 5) + T(648, y + 122, 'Shared', 'h', 13.5) + T(648, y + 138, 'memory', 'h', 13.5) + T(648, y + 156, '8 banks', 'ink2', 11.5);
    b += L(400, 142, 440, y + 60, 'lnd', 1.2) + L(400, 212, 440, y + 76, 'lnd', 1.2);
    b += L(400, 300, 440, y + 130, 'sb', 1.8, 'ahb');
    b += P(`M740,${y + 135} L780,${y + 135} L780,${s === 0 ? 280 : 320} L798,${s === 0 ? 280 : 320}`, 'sa', 2, 'aha');
  }
  b += box(800, 240, 148, 110, 'Memory arbiter', 'ta', ['ps_mem_arbiter.v', 'round robin', 'one request']);
  b += L(875, 350, 875, 418, 'sa', 2.2, 'aha');
  b += box(760, 420, 180, 90, 'DRAM model', 'ta', ['global memory 64K words', 'latency +lat (8)', '4-word lines']);
  b += T(20, 548, 'Blue: control and dispatch.  Green: arithmetic lanes.  Amber: memory path.  Real GPUs replicate the SM tile 100+ times; here NUM_SMS = 2.', 'ink2', 13);
  write('fig-top-level.svg', 960, 570, b, 'Pixelstorm top-level block diagram');
}

// ---------------------------------------------------------------------------
// 2. SM internals with RTL signal names
// ---------------------------------------------------------------------------
function figSm() {
  let b = T(20, 32, 'Inside one SM: blocks and the RTL signals that connect them (rtl/ps_sm.v)', 'h', 22);
  const sig = (x, y, s) => T(x, y, s, 'mono fb', 11.5);
  b += box(20, 60, 180, 250, 'Warp scheduler', 'tb', ['per warp: valid, wait, done', 'w_minpc = min PC of', 'live lanes', 'pick = next ready warp', '(round robin rr_ptr)', 'pick_act = lanes at', 'the min PC']);
  b += L(200, 110, 238, 110, 'sb', 1.8, 'ahb') + sig(204, 102, 'cpc');
  b += box(240, 60, 150, 90, 'Fetch', 'box', ['ir <= imem[cpc]', '1 cycle']);
  b += L(390, 110, 428, 110, 'sb', 1.8, 'ahb') + sig(396, 102, 'ir');
  b += box(430, 60, 170, 90, 'Decode', 'box', ['ps_decoder.v', 'guard per lane:', 'cexe = cact & guard_ok']);
  b += L(515, 150, 515, 186, 'sb', 1.8, 'ahb') + T(508, 174, 'd_rs1, d_rs2, d_rs3', 'mono fb', 11.5, 'end');
  b += box(240, 190, 360, 120, 'Register file', 'box', ['rf[thread * 16 + reg], 32 threads x 16 x 32 bit', 'preds: 4 bits per thread', 'lpc: one PC per thread     ldone: exited flag']);
  b += L(600, 250, 638, 250, 'sb', 1.8, 'ahb') + sig(602, 242, 'a, b, c');
  b += R(640, 60, 300, 250, 'tg', 8) + T(652, 82, 'Execution lanes', 'h', 16);
  for (let l = 0; l < 8; l++) {
    const x = 652 + (l % 4) * 70, y = 96 + Math.floor(l / 4) * 62;
    b += R(x, y, 62, 54, 'w', 5, 'stroke="#13936A"') + T(x + 8, y + 18, `lane ${l}`, 'mono ink2', 11) + T(x + 8, y + 38, 'ps_alu', 'mono', 12);
  }
  b += R(652, 226, 134, 72, 'tv', 5) + T(660, 246, 'SHFL crossbar', 'h', 14) + T(660, 264, 'reads a_flat of', 'ink2', 11.5) + T(660, 280, 'every lane', 'ink2', 11.5);
  b += R(794, 226, 134, 72, 'tv', 5) + T(802, 246, 'VOTE tree', 'h', 14) + T(802, 264, 'ballot = vote_bit', 'ink2', 11.5) + T(802, 280, '& cexe', 'ink2', 11.5);
  b += L(790, 310, 790, 350, 'sg', 1.8) + T(782, 338, 'r_res, r_addr, r_data, r_npc', 'mono fb', 11.5, 'end');
  b += box(20, 360, 420, 150, 'Load/store unit', 'ta', ['leader = lowest lane in lpend', 'global: g_serve = lanes in the leader\'s 4-word line', '        -> one mreq_valid transaction, wait mresp_valid', 'shared: s_sel = one lane per bank (same word = broadcast)', '        -> one pass per cycle, conflicts wait']);
  b += box(470, 360, 220, 150, 'Shared memory', 'ta', ['smem[256]', 'bank = address mod 8']);
  for (let k = 0; k < 8; k++) b += R(482 + k * 25, 440, 21, 56, 'w', 3, 'stroke="#D99A06"') + T(492 + k * 25, 472, String(k), 'mono ink2', 11, 'middle');
  b += L(440, 435, 468, 435, 'sa', 1.8, 'aha');
  b += box(720, 360, 220, 150, 'Writeback', 'tb', ['rf[..][d_rd] <= r_res', 'preds, lpc, ldone', 'w_wait on BAR', 'rr_ptr <= cw + 1']);
  b += L(790, 350, 790, 356, 'sg', 1.8);
  b += P('M830,360 L830,330 L960,330', 'sb', 1.4, '', 'opacity=".0"');
  b += L(230, 510, 230, 540, 'sa', 2, 'aha') + T(240, 534, 'to ps_mem_arbiter: mreq_op / mreq_addr / mreq_wmask / mreq_wdata', 'mono ink2', 12);
  b += P('M940,435 L950,435 L950,330 L10,330 L10,185 L18,185', 'sb', 1.4, 'ahb', 'stroke-dasharray="5 4"');
  b += T(18, 572, 'The dashed blue path closes the loop: after writeback the scheduler sees the new per-lane PCs and picks the next warp.', 'ink2', 13);
  write('fig-sm-internals.svg', 960, 590, b, 'Inside one Streaming Multiprocessor with RTL signal names');
}

// ---------------------------------------------------------------------------
// 3. instruction encoding with real examples
// ---------------------------------------------------------------------------
function figEncoding() {
  const fields = [
    ['opcode', 31, 26, 'tb'], ['G', 25, 25, 'tm'], ['N', 24, 24, 'tm'], ['P', 23, 22, 'tm'],
    ['Rd', 21, 18, 'tg'], ['Rs1', 17, 14, 'tg'], ['Rs2', 13, 10, 'tg'], ['Rs3', 9, 6, 'tg'], ['-', 5, 3, 'box'], ['aux', 2, 0, 'tv'],
  ];
  const X0 = 40, BW = 27;
  const bx = (bitn) => X0 + (31 - bitn) * BW;
  let b = T(20, 32, 'PS-ISA encoding: every instruction is one 32-bit word', 'h', 22);
  for (let i = 31; i >= 0; i--) b += T(bx(i) + BW / 2, 62, String(i), 'mono ink3', 10.5, 'middle');
  for (const [n, hi, lo, cls] of fields) {
    b += R(bx(hi), 70, (hi - lo + 1) * BW, 40, cls, 3) + T(bx(hi) + (hi - lo + 1) * BW / 2, 95, n, 'h', 15, 'middle');
  }
  b += R(bx(13), 116, 14 * BW, 20, 'ts', 3) + T(bx(13) + 7 * BW, 131, 'imm14 (ADDI, LDG/STG offsets, S2R, LDC, SHFL)', 'ink2', 11.5, 'middle');
  b += R(bx(17), 140, 18 * BW, 20, 'ts', 3) + T(bx(17) + 9 * BW, 155, 'imm18 (MOVI, BRA target)', 'ink2', 11.5, 'middle');
  b += T(40, 184, 'G N P = guard: @P0, @!P2 ...  (predication).  Rd also names the data register of a store.  aux = SETP comparison, SEL predicate, VOTE mode.', 'ink2', 12.5);
  // examples from the real vector_add listing
  const src = fs.readFileSync(path.join(ROOT, 'kernels', '01_vector_add.psa'), 'utf8');
  const asm = W.assemble(src);
  const pick = [3, 5, 6, 13, 16];
  let y = 214;
  b += T(20, y - 8, 'Five words from kernels/01_vector_add.psa, decoded bit by bit:', 'h', 16);
  for (const pc of pick) {
    const l = asm.listing[pc]; const w = l.word;
    b += T(20, y + 22, `PC ${pc}`, 'mono ink3', 12) + T(78, y + 22, '0x' + l.hex, 'mono', 12.5);
    for (let i = 31; i >= 0; i--) {
      const f = fields.find(([, hi, lo]) => i <= hi && i >= lo);
      const one = (w >>> i) & 1;
      b += R(bx(i) + 150, y + 6, BW - 3, 24, one ? f[3] : 'well', 2) + T(bx(i) + 150 + (BW - 3) / 2, y + 23, String(one), 'mono ' + (one ? '' : 'ink3'), 12, 'middle');
    }
    b += T(bx(0) + 190, y + 22, l.asm, 'mono', 13);
    y += 36;
  }
  b += T(20, y + 20, 'Colored cells are 1 bits, tinted by field. Regenerate with: node tools/figures.js', 'ink3', 12);
  write('fig-encoding.svg', 1260, y + 36, b, 'PS-ISA 32-bit instruction encoding with decoded examples');
}

// ---------------------------------------------------------------------------
// 4. control FSM
// ---------------------------------------------------------------------------
function figFsm() {
  let b = T(20, 32, 'The SM control Finite State Machine (FSM): one instruction at a time', 'h', 22) + '<g transform="translate(0,50)">';
  const st = [['IDLE', 80, 150, 'box', 'no block'], ['SCHED', 230, 150, 'tb', 'pick warp'], ['FETCH', 380, 150, 'tb', 'ir <= imem'], ['DECODE', 530, 150, 'tb', 'guard mask'], ['EXEC', 680, 150, 'tg', '8 ALUs'], ['MEM', 830, 240, 'ta', 'n cycles'], ['WB', 830, 90, 'tb', 'write regs']];
  const pos = {};
  for (const [n, x, y, cls, sub] of st) { pos[n] = [x, y]; b += `<circle cx="${x}" cy="${y}" r="46" class="${cls}" stroke-width="2"/>` + T(x, y - 2, n, 'h', 17, 'middle') + T(x, y + 17, sub, 'ink2', 11.5, 'middle'); }
  const arr = (a, b2, label, dy = 0, cls = 'lnd') => {
    const [x1, y1] = pos[a], [x2, y2] = pos[b2];
    const dx = x2 - x1, d = y2 - y1, len = Math.hypot(dx, d);
    const ux = dx / len, uy = d / len;
    return L(x1 + ux * 48, y1 + uy * 48 + dy, x2 - ux * 50, y2 - uy * 50 + dy, cls, 1.8) + (label ? T((x1 + x2) / 2, (y1 + y2) / 2 - 8 + dy, label, 'ink2', 11.5, 'middle') : '');
  };
  b += arr('IDLE', 'SCHED', 'blk_start') + arr('SCHED', 'FETCH', 'found') + arr('FETCH', 'DECODE', '') + arr('DECODE', 'EXEC', '');
  b += arr('EXEC', 'MEM', 'load/store', 0, 'sa') + arr('EXEC', 'WB', 'ALU op') + arr('MEM', 'WB', 'no lanes pending', 0, 'sa');
  b += P('M830,44 C830,10 230,10 230,104', 'sb', 1.8, 'ahb') + T(530, 22, 'back to SCHED: rr_ptr moves to the next warp', 'ink2', 12, 'middle');
  b += P('M876,240 C930,210 930,275 876,258', 'sa', 1.6, 'aha') + T(935, 246, 'next txn', 'ink2', 11);
  b += P('M200,190 C180,250 280,250 258,190', 'sm', 1.6, 'ah') + T(230, 262, 'barrier release', 'ink2', 11.5, 'middle');
  b += P('M200,120 C150,70 110,90 104,110', 'lnd', 1.4, 'ah') + T(150, 78, 'block done', 'ink2', 11.5, 'middle');
  b += '</g>';
  // cost bar
  const y0 = 370;
  b += T(20, y0, 'Cycle cost per instruction class', 'h', 17);
  const rows = [['ALU (ADD, MAD, SETP ...)', ['SCHED', 'FETCH', 'DECODE', 'EXEC', 'WB'], 0], ['Shared load, no conflict', ['SCHED', 'FETCH', 'DECODE', 'EXEC', 'MEM', 'MEM', 'WB'], 0], ['Global load, 2 transactions, 1 SM', ['SCHED', 'FETCH', 'DECODE', 'EXEC'], 25]];
  rows.forEach(([name, cells, mem], i) => {
    const y = y0 + 16 + i * 34;
    b += T(20, y + 18, name, 'ink2', 12.5);
    let x = 260;
    for (const c of cells) { const cls = c === 'MEM' ? 'ta' : c === 'EXEC' ? 'tg' : 'tb'; b += R(x, y, 40, 26, cls, 3) + T(x + 20, y + 17, c[0], 'h', 13, 'middle'); x += 42; }
    if (mem) { b += R(x, y, mem * 16, 26, 'ta', 3) + T(x + mem * 8, y + 17, `MEM x ${mem} cycles`, 'h', 13, 'middle'); x += mem * 16 + 2; b += R(x, y, 40, 26, 'tb', 3) + T(x + 20, y + 17, 'W', 'h', 13, 'middle'); x += 42; }
    const n = cells.length + (mem ? mem + 1 : 0);
    b += T(x + 8, y + 18, `${n} cycles`, 'mono', 12.5);
  });
  b += T(20, y0 + 136, 'A pipelined SM overlaps these boxes and issues every cycle (docs/12-make-it-better.md, exercise 1).', 'ink3', 12.5);
  write('fig-fsm.svg', 1000, 520, b, 'SM control FSM and cycle costs');
}

// ---------------------------------------------------------------------------
// 5. instruction lifecycle gantt from the real vector_add trace
// ---------------------------------------------------------------------------
function figLifecycle() {
  const tr = trace('vector_add');
  const t0 = 118, t1 = 176; const X0 = 170, CW = 13.4;
  const x = (t) => X0 + (t - t0) * CW;
  let b = T(20, 32, 'Cycles 118 to 176 of vector_add, exactly as recorded from the Verilog', 'h', 22);
  b += T(20, 52, 'The highlighted instruction is LDG R8, [R5] on SM 0 (docs/05). Each colored block is one stage of one instruction.', 'ink2', 13);
  for (let t = t0; t <= t1; t += 2) b += T(x(t) + CW / 2, 80, String(t), 'mono ink3', 9.5, 'middle') + L(x(t), 86, x(t), 330, 'ln', 0.6, '');
  const rows = [['SM 0', 0], ['SM 1', 1]];
  const stCls = ['tb', 'tb', 'tb', 'tg', 'ta', 'tb']; const stL = ['S', 'F', 'D', 'X', 'M', 'W'];
  rows.forEach(([name, sm], r) => {
    const y = 96 + r * 86;
    b += T(20, y + 22, name, 'h', 16);
    for (const c of tr.events.filter(e => e.ev === 'commit' && e.sm === sm && e.st[5] >= t0 && e.st[0] <= t1)) {
      const d = W.decode(c.ir); const focus = sm === 0 && c.pc === 13 && c.w === 0;
      for (let k = 0; k < 6; k++) {
        let a = c.st[k]; if (k === 4 && !a) continue;
        let e = k === 4 ? c.st[5] : k === 3 && c.st[4] ? c.st[4] : k === 5 ? c.st[5] + 1 : c.st[k + 1] || c.st[k] + 1;
        if (k === 3 && !c.st[4]) e = c.st[5];
        a = Math.max(a, t0); e = Math.min(e, t1 + 1); if (e <= a) continue;
        b += R(x(a) + 0.5, y, (e - a) * CW - 1, 30, stCls[k], 2, focus ? 'stroke-width="2.4"' : 'opacity=".75"');
        if ((e - a) * CW > 10) b += T(x(a) + (e - a) * CW / 2, y + 20, stL[k], 'h', 12, 'middle');
      }
      const mid = Math.max(c.st[0], t0);
      b += T(x(mid) + 1, y + 46, `W${c.w} ${d.name}`, 'mono ' + (focus ? '' : 'ink2'), 10.5, 'start', focus ? 'font-weight="700"' : '');
    }
  });
  // arbiter / DRAM row
  const y = 280;
  b += T(20, y + 22, 'DRAM', 'h', 16);
  for (const m of tr.events.filter(e => e.ev === 'mreq' && e.t >= t0 - 12 && e.t <= t1)) {
    const a = Math.max(m.t, t0), e = Math.min(m.t + tr.meta.lat + 2, t1 + 1);
    if (e > a) b += R(x(a) + 0.5, y, (e - a) * CW - 1, 30, m.sm === 0 ? 'ta' : 'tv', 2) + T(x(a) + 4, y + 20, `SM${m.sm} line ${m.a}`, 'mono', 10.5);
  }
  b += T(20, 360, 'S schedule  F fetch  D decode  X execute  M memory  W writeback.   DRAM row: amber = request from SM 0, violet = SM 1.', 'ink2', 12.5);
  b += T(20, 380, 'Notice the load waits behind SM 1\'s request: one DRAM port, round-robin arbitration, one request in flight.', 'ink2', 12.5);
  write('fig-lifecycle.svg', x(t1 + 1) + 20, 400, b, 'Real cycle-by-cycle timeline of an LDG instruction');
}

// ---------------------------------------------------------------------------
// 6. divergence mask grid
// ---------------------------------------------------------------------------
function figDivergence() {
  const tr = trace('divergence');
  const cs = tr.events.filter(e => e.ev === 'commit' && e.sm === 0 && e.w === 0);
  const RH = 21, Y0 = 98;
  let b = T(20, 32, 'Divergence in kernels/03_divergence.psa: every instruction warp 0 issued, in order', 'h', 22);
  b += T(20, 52, 'Each row is one issue of one instruction. Each column is one lane (thread 0 to 7). From the RTL trace.', 'ink2', 13);
  const lx = (l) => 470 + l * 44;
  b += T(20, 88, 'cycle', 'h ink2', 13) + T(80, 88, 'PC', 'h ink2', 13) + T(120, 88, 'instruction', 'h ink2', 13);
  for (let l = 0; l < 8; l++) b += T(lx(l) + 19, 88, `lane ${l}`, 'h ink2', 12, 'middle');
  b += T(840, 88, 'lanes busy', 'h ink2', 13);
  const done = new Array(8).fill(0);
  cs.forEach((c, i) => {
    const y = Y0 + i * RH;
    if (i % 2) b += R(14, y - 2, 930, RH, 'well', 0, 'opacity=".5"');
    b += T(20, y + 13, String(c.st[0]), 'mono ink3', 11.5) + T(80, y + 13, String(c.pc), 'mono', 11.5) + T(120, y + 13, W.disasm(c.ir), 'mono', 11.5);
    let n = 0;
    for (let l = 0; l < 8; l++) {
      let cls, fill = '';
      if (done[l]) cls = 'well';
      else if (!bit(c.act, l)) cls = 'tm';
      else if (!bit(c.exe, l)) { cls = 'ts'; fill = 'style="fill:url(#hatch)"'; }
      else { cls = 'fg'; n++; }
      b += R(lx(l), y, 38, RH - 4, cls, 3, fill);
    }
    for (let l = 0; l < 8; l++) done[l] = bit(c.done, l);
    b += R(840, y + 2, n * 8, RH - 8, 'fg', 2) + T(944, y + 13, `${n}/8`, 'mono ink2', 11.5, 'end');
  });
  const yl = Y0 + cs.length * RH + 20;
  b += R(20, yl, 22, 14, 'fg', 3) + T(48, yl + 12, 'executing', 'ink2', 12.5);
  b += R(140, yl, 22, 14, 'ts', 3, 'style="fill:url(#hatch)"') + T(168, yl + 12, 'at this PC, guard false', 'ink2', 12.5);
  b += R(340, yl, 22, 14, 'tm', 3) + T(368, yl + 12, 'diverged: waiting at another PC', 'ink2', 12.5);
  b += R(600, yl, 22, 14, 'well', 3) + T(628, yl + 12, 'exited', 'ink2', 12.5);
  const tot = cs.reduce((a, c) => a + W.popcount(c.exe), 0);
  b += T(20, yl + 40, `Warp 0 issued ${cs.length} instructions = ${cs.length * 8} lane slots, of which ${tot} did useful work (${(100 * tot / cs.length / 8).toFixed(0)}% SIMD efficiency).`, 'h', 15);
  write('fig-divergence.svg', 960, yl + 60, b, 'Active mask of every instruction of a diverging warp');
}

// ---------------------------------------------------------------------------
// 7. coalescing
// ---------------------------------------------------------------------------
function figCoalescing() {
  const pats = [['in[i]: contiguous', (l) => l, 2], ['in[i*4]: stride 4', (l) => l * 4, 8], ['in[0]: broadcast', () => 0, 1]];
  let b = T(20, 32, 'Coalescing: 8 lanes, three address patterns, 4-word DRAM lines', 'h', 22);
  b += T(20, 52, 'The load/store unit serves every lane whose address falls in the leader\'s line with one transaction (kernels/08_coalescing.psa).', 'ink2', 13);
  const cls = ['tg', 'ta', 'tb', 'tv', 'tm', 'ts', 'tg', 'ta'];
  pats.forEach(([name, f, n], p) => {
    const y0 = 80 + p * 190;
    b += T(20, y0 + 16, name, 'h', 17) + T(940, y0 + 16, `${n} transaction${n > 1 ? 's' : ''}`, 'h ' + (n > 2 ? 'fm' : n === 1 ? 'fg' : ''), 17, 'end');
    const lines = [...new Set([...Array(8).keys()].map(l => f(l) & ~3))];
    const lineIdx = (a) => lines.indexOf(a & ~3);
    for (let l = 0; l < 8; l++) {
      const x = 40 + l * 110;
      b += R(x, y0 + 28, 70, 30, cls[lineIdx(f(l))], 4) + T(x + 35, y0 + 48, `lane ${l}`, 'h', 13, 'middle');
    }
    const maxA = Math.max(...[...Array(8).keys()].map(f)) + 4 - ((Math.max(...[...Array(8).keys()].map(f))) % 4);
    const cols = Math.min(Math.max(8, maxA), 32); const cw = 900 / cols;
    for (let a = 0; a < cols; a++) {
      const li = lines.indexOf(a & ~3);
      b += R(40 + a * cw, y0 + 118, cw - 2, 26, li >= 0 ? cls[li] : 'well', 2) + T(40 + a * cw + cw / 2, y0 + 136, String(a), 'mono ink2', 10.5, 'middle');
      if (a % 4 === 0) b += T(40 + a * cw + 2, y0 + 158, `line ${a}`, 'mono ink3', 10);
    }
    for (let l = 0; l < 8; l++) {
      const a = f(l); if (a >= cols) continue;
      b += L(75 + l * 110, y0 + 58, 40 + a * cw + cw / 2, y0 + 116, 'lnd', 1, 'ah', 'opacity=".7"');
    }
  });
  b += T(20, 650, 'Same 8 words of useful data; 1x, 2x or 8x the DRAM traffic. On NVIDIA hardware the unit is a 32-byte sector and a warp has 32 lanes, but the rule is identical.', 'ink2', 13);
  write('fig-coalescing.svg', 960, 670, b, 'Memory coalescing for three access patterns');
}

// ---------------------------------------------------------------------------
// 8. shared-memory banks
// ---------------------------------------------------------------------------
function figBanks() {
  const pats = [['s[t]', (l) => 64 + l], ['s[8t]', (l) => 8 * l], ['s[5] (same word)', () => 5], ['s[2t]', (l) => 64 + 2 * l]];
  let b = T(20, 32, 'Shared-memory banks: word a lives in bank a mod 8, one word per bank per cycle', 'h', 22);
  b += T(20, 52, 'Each chip is one lane (its number), stacked on the bank it hits. Stack height = passes needed (kernels/09_bank_conflicts.psa).', 'ink2', 13);
  pats.forEach(([name, f], p) => {
    const x0 = 20 + p * 236, y0 = 80;
    // compute passes as the RTL does
    const pend = [...Array(8).keys()]; const pass = new Array(8).fill(0); let k = 0;
    let left = pend.slice();
    while (left.length) { const used = {}; const serve = []; for (const l of left) { const a = f(l), bk = a & 7; if (!(bk in used)) { used[bk] = a; serve.push(l); } else if (used[bk] === a) serve.push(l); } serve.forEach(l => { pass[l] = k; }); left = left.filter(l => !serve.includes(l)); k++; }
    b += R(x0, y0, 224, 330, 'panel', 8) + T(x0 + 12, y0 + 24, name, 'h mono', 15);
    b += T(x0 + 212, y0 + 24, `${k} pass${k > 1 ? 'es' : ''}`, 'h ' + (k > 2 ? 'fm' : k === 1 ? 'fg' : ''), 16, 'end');
    const stack = {};
    for (let bk = 0; bk < 8; bk++) b += R(x0 + 12 + bk * 25.5, y0 + 280, 22, 34, 'ta', 3) + T(x0 + 23 + bk * 25.5, y0 + 302, String(bk), 'mono', 11, 'middle');
    b += T(x0 + 12, y0 + 274, 'bank', 'ink3', 11);
    for (let l = 0; l < 8; l++) {
      const bk = f(l) & 7; stack[bk] = (stack[bk] || 0) + 1; const yy = y0 + 272 - stack[bk] * 26;
      b += R(x0 + 12 + bk * 25.5, yy - 12, 22, 22, pass[l] === 0 ? 'fg' : 'fm', 4) + T(x0 + 23 + bk * 25.5, yy + 3, String(l), 'mono w', 11, 'middle');
    }
  });
  b += T(20, 440, 'Green: served in the first pass. Magenta: had to wait for a later pass (bank conflict). Same-word accesses are a free broadcast.', 'ink2', 13);
  b += T(20, 460, 'Fix for conflicts: pad arrays (row pitch 9 instead of 8) so column accesses spread across banks. NVIDIA GPUs have 32 banks; same rule.', 'ink2', 13);
  write('fig-banks.svg', 980, 480, b, 'Shared-memory bank conflicts for four access patterns');
}

// ---------------------------------------------------------------------------
// 9. per-kernel warp timelines from RTL traces
// ---------------------------------------------------------------------------
function figTimelines() {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'traces', 'index.json'), 'utf8'));
  for (const ent of idx) {
    const tr = trace(ent.name); const m = tr.meta;
    const rows = m.numSms * m.numWarps; const RH = 16; const X0 = 70, PW = 880;
    const end = m.cycles || 1; const x = (t) => X0 + t / end * PW;
    let b = T(20, 26, `${ent.name.replace(/_/g, ' ')}: every warp instruction on the RTL (${end} cycles, ${m.numSms} SMs)`, 'h', 17);
    const cs = tr.events.filter(e => e.ev === 'commit');
    for (let r = 0; r < rows; r++) {
      const y = 40 + r * RH; const s = Math.floor(r / m.numWarps), w = r % m.numWarps;
      b += T(12, y + 12, `SM${s} W${w}`, 'h ink2', 11.5) + R(X0, y + RH - 2, PW, 1, 'well', 0);
    }
    for (const c of cs) {
      const d = W.decode(c.ir); const y = 40 + (c.sm * m.numWarps + c.w) * RH;
      const op = 0.35 + 0.65 * W.popcount(c.exe) / m.warpSize;
      b += `<rect x="${x(c.st[0]).toFixed(1)}" y="${y + 2}" width="${Math.max(0.8, x(c.st[5] + 1) - x(c.st[0])).toFixed(1)}" height="${RH - 5}" class="${GROUP_FILL[d.e ? d.e.group : 'data']}" opacity="${op.toFixed(2)}"/>`;
    }
    for (const e of tr.events.filter(e => e.ev === 'bar')) b += `<rect x="${x(e.t).toFixed(1)}" y="${40 + e.sm * m.numWarps * RH}" width="1.5" height="${m.numWarps * RH}" class="fm"/>`;
    const yb = 40 + rows * RH + 18;
    [['fg', 'arithmetic'], ['fa', 'memory'], ['fb', 'control'], ['fv', 'warp-wide'], ['fs', 'moves / predicates'], ['fm', 'barrier release']].forEach(([c, n], i) => { b += R(20 + i * 150, yb - 10, 12, 12, c, 2) + T(38 + i * 150, yb, n, 'ink2', 12); });
    b += T(20, yb + 20, 'Fainter bar = fewer active lanes. Bar length = cycles from schedule to writeback.', 'ink3', 11.5);
    write(`timeline-${ent.name}.svg`, 960, yb + 32, b, `Warp timeline of ${ent.name}`);
  }
}

// ---------------------------------------------------------------------------
// 10. scale comparison with a real GPU
// ---------------------------------------------------------------------------
function figScale() {
  const rows = [
    ['Streaming Multiprocessors', 2, 132, ''], ['Threads per warp', 8, 32, ''], ['Resident warps per SM', 4, 64, ''],
    ['Resident threads per GPU', 64, 270336, ''], ['Register file per SM', 2, 256, 'KB'], ['Shared memory per SM', 1, 228, 'KB'],
    ['Shared-memory banks', 8, 32, ''], ['Last-level cache', 0, 50 * 1024, 'KB'], ['DRAM capacity', 256, 80 * 1024 * 1024, 'KB'],
  ];
  let b = T(20, 32, 'Pixelstorm next to an NVIDIA H100 (SXM5): same ideas, different scale', 'h', 22);
  b += T(20, 52, 'Logarithmic bars. H100 figures from NVIDIA\'s H100 Tensor Core GPU architecture whitepaper.', 'ink2', 13);
  const lg = (v) => v <= 0 ? 0 : Math.log10(v) + 1; const maxL = lg(80 * 1024 * 1024); const BW = 520;
  const fmt = (v, u) => { if (!v) return 'none'; if (u === 'KB' && v >= 1024 * 1024) return (v / 1024 / 1024) + ' GB'; if (u === 'KB' && v >= 1024) return (v / 1024) + ' MB'; return v.toLocaleString('en-US') + (u ? ' ' + u : ''); };
  rows.forEach(([n, ws, h, u], i) => {
    const y = 80 + i * 50;
    b += T(20, y + 22, n, 'h', 15);
    b += R(260, y + 4, Math.max(2, lg(ws) / maxL * BW), 16, 'fg', 3) + T(266 + Math.max(2, lg(ws) / maxL * BW), y + 17, 'Pixelstorm ' + fmt(ws, u), 'mono ink2', 11.5);
    b += R(260, y + 24, lg(h) / maxL * BW, 16, 'fb', 3) + T(266 + lg(h) / maxL * BW, y + 37, 'H100 ' + fmt(h, u), 'mono ink2', 11.5);
  });
  b += T(20, 80 + rows.length * 50 + 14, 'Every Pixelstorm size is a Verilog parameter: raise NUM_SMS, WARP_SIZE, NUM_WARPS and rerun make test.', 'ink2', 13);
  write('fig-scale.svg', 960, 80 + rows.length * 50 + 34, b, 'Scale comparison between Pixelstorm and NVIDIA H100');
}

// ---------------------------------------------------------------------------
// 11. latency hiding concept (computed by a tiny scheduler model)
// ---------------------------------------------------------------------------
function latencySim(nw, lat, comp, iters) {
  // each warp: iters x [LOAD (lat cycles, async), COMPUTE x comp (needs the load)]
  const warps = [...Array(nw)].map(() => ({ i: 0, phase: 'load', ready: 0, left: comp, busy: [] }));
  const alu = []; let t = 0; let rr = 0;
  while (warps.some(w => w.i < iters) && t < 5000) {
    let issued = -1;
    for (let k = 0; k < nw; k++) {
      const wi = (rr + k) % nw; const w = warps[wi];
      if (w.i >= iters || w.ready > t) continue;
      if (w.phase === 'load') { w.busy.push([t, t + 1, 'ld']); w.ready = t + 1 + lat; w.busy.push([t + 1, t + 1 + lat, 'wait']); w.phase = 'comp'; w.left = comp; }
      else { w.busy.push([t, t + 1, 'op']); w.left--; w.ready = t + 1; if (!w.left) { w.i++; w.phase = 'load'; } }
      issued = wi; rr = wi + 1; break;
    }
    alu.push(issued >= 0 ? 1 : 0); t++;
  }
  return { warps, t, util: alu.reduce((a, c) => a + c, 0) / t };
}
function figLatency() {
  let b = T(20, 32, 'Latency hiding: why GPUs keep many warps per SM', 'h', 22);
  b += T(20, 52, 'Each warp repeats: one load (20-cycle memory latency) then 4 arithmetic instructions that need it. The scheduler issues one instruction per cycle.', 'ink2', 13);
  let y = 80;
  for (const nw of [1, 2, 4, 6]) {
    const r = latencySim(nw, 20, 4, 3); const cw = 880 / 140;
    b += T(20, y + 14, `${nw} warp${nw > 1 ? 's' : ''}: ${r.t} cycles, issue slots used ${(100 * r.util).toFixed(0)}%`, 'h', 15);
    y += 22;
    r.warps.forEach((w, i) => {
      b += T(20, y + 11, `W${i}`, 'mono ink3', 11);
      for (const [a, e, k] of w.busy) {
        if (a > 140) continue;
        b += R(60 + a * cw, y, Math.max(1, (Math.min(e, 140) - a) * cw - 0.5), 13, k === 'wait' ? 'ta' : k === 'ld' ? 'fa' : 'fg', 1.5, k === 'wait' ? 'opacity=".5"' : '');
      }
      y += 16;
    });
    y += 14;
  }
  b += R(20, y, 14, 12, 'fg', 2) + T(40, y + 11, 'arithmetic issue', 'ink2', 12) + R(170, y, 14, 12, 'fa', 2) + T(190, y + 11, 'load issue', 'ink2', 12) + R(290, y, 14, 12, 'ta', 2, 'opacity=".5"') + T(310, y + 11, 'waiting on memory (the SM can run another warp)', 'ink2', 12);
  b += T(20, y + 36, 'Pixelstorm today stalls the whole SM during MEM, like the 1-warp row. Exercise 2 in docs/12 makes it behave like the 4-warp row. Try it live in web/labs.html.', 'ink2', 13);
  write('fig-latency-hiding.svg', 960, y + 56, b, 'Latency hiding with multiple warps');
}

// ---------------------------------------------------------------------------
// 12. memory hierarchy
// ---------------------------------------------------------------------------
function figHierarchy() {
  let b = T(20, 32, 'Memory hierarchy: size grows, speed drops', 'h', 22);
  const lv = [
    ['Registers', 'per thread', '16 x 32 bit, 1 cycle', '255 x 32 bit, ~1 cycle', 'tg'],
    ['Shared memory', 'per block, on the SM', '256 words, 1 cycle per bank pass', 'up to 228 KB, ~20-30 cycles', 'ta'],
    ['L1 / L2 cache', 'per SM / whole chip', 'none (exercise 3)', '256 KB L1 per SM, 50 MB L2', 'ts'],
    ['Global memory (DRAM)', 'whole GPU', '64K words, 8 cycles + queueing', '80 GB HBM3, ~400-600 cycles, 3.35 TB/s', 'tb'],
  ];
  lv.forEach(([n, scope, ws, h, cls], i) => {
    const w = 180 + i * 100, x = 290 - w / 2, y = 60 + i * 76;
    b += `<path d="M${x},${y + 66} L${x + w},${y + 66} L${x + w - 40},${y} L${x + 40},${y} Z" class="${cls}" stroke-width="1.5"/>`;
    b += T(290, y + 26, n, 'h', 17, 'middle') + T(290, y + 46, scope, 'ink2', 12.5, 'middle');
    b += T(580, y + 26, 'Pixelstorm: ' + ws, 'mono', 12) + T(580, y + 46, 'H100 (approx.): ' + h, 'mono ink2', 12);
    b += L(290 + w / 2 - 20, y + 33, 572, y + 33, 'ln', 1, '');
  });
  b += T(20, 390, 'Latencies for real GPUs vary by product and access; treat them as orders of magnitude, measured with microbenchmarks in published studies.', 'ink3', 12);
  write('fig-hierarchy.svg', 960, 410, b, 'GPU memory hierarchy');
}


// ---------------------------------------------------------------------------
// 13. thread hierarchy: grid -> blocks -> warps -> lanes -> SMs
// ---------------------------------------------------------------------------
function figThreads() {
  let b = T(20, 32, 'From a CUDA launch to hardware: vector_add<<<4, 16>>>', 'h', 22);
  b += T(20, 52, '4 blocks of 16 threads. Each block becomes 2 warps of 8 lanes; the dispatcher hands blocks to whichever SM is free.', 'ink2', 13);
  b += R(20, 70, 920, 150, 'panel', 8) + T(32, 92, 'Grid (the whole launch): threads 0 to 63', 'h', 16);
  const cls = ['tb', 'tg', 'ta', 'tv'];
  for (let blk = 0; blk < 4; blk++) {
    const x = 32 + blk * 226;
    b += R(x, 102, 214, 106, cls[blk], 6) + T(x + 10, 122, `Block ${blk}  (blockIdx.x = ${blk})`, 'h', 14);
    for (let w = 0; w < 2; w++) {
      const y = 132 + w * 36;
      b += T(x + 10, y + 18, `warp ${w}`, 'mono ink2', 11);
      for (let l = 0; l < 8; l++) {
        const tid = blk * 16 + w * 8 + l;
        b += R(x + 60 + l * 18.5, y + 4, 16, 22, 'w', 3, 'stroke-width="1"') + T(x + 68 + l * 18.5, y + 19, String(tid), 'mono', 8.5, 'middle');
      }
    }
  }
  b += T(20, 246, 'Numbers are the global index i = blockIdx.x * blockDim.x + threadIdx.x. One warp = 8 consecutive threads = 8 lanes that share an instruction stream.', 'ink2', 12.5);
  // SM assignment from the real trace
  const tr = trace('vector_add');
  const blks = tr.events.filter(e => e.ev === 'blk');
  b += T(20, 284, 'What the dispatcher actually did (from the RTL trace):', 'h', 16);
  const end = tr.meta.cycles; const X0 = 90, PW = 840; const x = (t) => X0 + t / end * PW;
  for (let sm = 0; sm < 2; sm++) {
    const y = 300 + sm * 44;
    b += T(20, y + 24, `SM ${sm}`, 'h', 15) + R(X0, y, PW, 34, 'well', 4);
    for (const st of blks.filter(e => e.sm === sm && e.ph === 'start')) {
      const en = blks.find(e => e.sm === sm && e.ph === 'end' && e.blk === st.blk && e.t >= st.t);
      const e2 = en ? en.t : end;
      b += R(x(st.t), y + 2, x(e2) - x(st.t) - 2, 30, cls[st.blk], 4) + T(x(st.t) + 8, y + 22, `block ${st.blk}: cycles ${st.t} to ${e2}`, 'h', 13);
    }
  }
  b += T(20, 410, `Two SMs finish 4 blocks in ${end} cycles; with one SM the same launch takes about 1.6 times longer (docs/10).`, 'ink2', 12.5);
  write('fig-thread-hierarchy.svg', 960, 430, b, 'Grid, blocks, warps and lanes mapped onto SMs');
}

// ---------------------------------------------------------------------------
// 14. shuffle reduction with the real register values + barrier arrivals
// ---------------------------------------------------------------------------
function figShuffle() {
  const tr = trace('reduction_shuffle');
  const cs = tr.events.filter(e => e.ev === 'commit' && e.sm === 0 && e.w === 0 && e.blk === 0);
  const ldg = cs.find(c => W.decode(c.ir).name === 'LDG');
  const shf = cs.filter(c => W.decode(c.ir).name === 'SHFL');
  const adds = cs.filter(c => W.decode(c.ir).name === 'ADD' && c.pc > ldg.pc);
  let b = T(20, 32, 'Warp reduction with SHFL.DOWN: the real register values from the RTL', 'h', 22);
  b += T(20, 52, 'Block 0, warp 0 of kernels/05_reduction_shuffle.psa. Each row is R5 after an ADD; arrows show which lane each value came from.', 'ink2', 13);
  const lx = (l) => 150 + l * 96;
  const rows = [['LDG R5', ldg.v]];
  shf.forEach((s, i) => rows.push([`+ SHFL.DOWN ${[4, 2, 1][i]}`, adds[i].v]));
  rows.forEach(([lab, v], r) => {
    const y = 80 + r * 92;
    b += T(20, y + 22, lab, 'mono', 12.5);
    for (let l = 0; l < 8; l++) {
      const valid = r === 0 || l + [4, 2, 1][r - 1] < 8 || true;
      b += R(lx(l), y, 80, 34, l === 0 && r === 3 ? 'tg' : 'box', 5, l === 0 && r === 3 ? 'stroke-width="2.5"' : '') + T(lx(l) + 40, y + 23, String(v[l]), 'mono', 14, 'middle');
      if (r === 0) b += T(lx(l) + 40, y - 8, `lane ${l}`, 'h ink2', 12.5, 'middle');
    }
    if (r < rows.length - 1) {
      const d = [4, 2, 1][r];
      for (let l = 0; l + d < 8; l++) b += P(`M${lx(l + d) + 40},${y + 36} C${lx(l + d) + 40},${y + 62} ${lx(l) + 40},${y + 52} ${lx(l) + 40},${y + 88}`, 'sv', 1.3, 'ah', 'opacity=".8"');
      for (let l = 8 - d; l < 8; l++) b += L(lx(l) + 40, y + 36, lx(l) + 40, y + 88, 'ln', 1.2, 'ah');
    }
  });
  b += T(20, 80 + rows.length * 92 - 6, `Lane 0 ends with ${rows[rows.length - 1][1][0]} = 1 + 2 + ... + 8 after 3 shuffles and 3 adds: no shared memory, no barrier.`, 'ink2', 12.5);
  b += T(20, 80 + rows.length * 92 + 12, 'Violet arrows: SHFL reads another lane. Grey arrows: source is out of range, so the lane keeps its own value.', 'ink2', 12.5);
  // barrier arrival
  const rt = trace('reduction_shared');
  const bar0 = rt.events.find(e => e.ev === 'bar' && e.sm === 0).t;
  const arr = rt.events.filter(e => e.ev === 'commit' && e.sm === 0 && W.decode(e.ir).isBar && e.t <= bar0);
  const y0 = 80 + rows.length * 92 + 44;
  b += T(20, y0, `BAR in reduction_shared: four warps arrive, one release (SM 0, cycles ${arr[0].t - 10} to ${bar0 + 6})`, 'h', 16);
  const t0 = arr[0].t - 10, t1 = bar0 + 6; const x = (t) => 150 + (t - t0) / (t1 - t0) * 760;
  arr.forEach((a, i) => {
    const y = y0 + 16 + i * 26;
    b += T(20, y + 15, `warp ${a.w}`, 'mono ink2', 12) + R(x(t0), y + 3, x(a.t) - x(t0), 16, 'tg', 3) + R(x(a.t), y + 3, x(bar0) - x(a.t), 16, 'tm', 3);
    b += T(Math.min(x(a.t) + 4, 700), y + 15, `arrives ${a.t}, parked ${bar0 - a.t} cycle${bar0 - a.t === 1 ? '' : 's'}`, 'mono', 10.5);
  });
  b += L(x(bar0), y0 + 12, x(bar0), y0 + 16 + arr.length * 26, 'sm', 2.5, '') + T(x(bar0) + 6, y0 + 16 + arr.length * 26 + 12, `release at ${bar0}`, 'h fm', 13);
  write('fig-shuffle-barrier.svg', 960, y0 + 16 + arr.length * 26 + 30, b, 'Shuffle reduction and barrier arrival from real traces');
}

// ---------------------------------------------------------------------------
// graphics: final framebuffer of a kernel, reconstructed from its RTL trace
// ---------------------------------------------------------------------------
function framebuffer(name) {
  const tr = trace(name); const fb = tr.meta.fb;
  const mem = Object.assign({}, tr.meta.gmemInit);
  for (const e of tr.events) if (e.ev === 'gw') mem[e.a] = e.v;
  const px = [];
  for (let i = 0; i < fb.width * fb.height; i++) px.push((mem[fb.addr + i] || 0) >>> 0);
  return { fb, px, meta: tr.meta, tr };
}
const hex6 = (v) => '#' + (v & 0xffffff).toString(16).padStart(6, '0');
function pixelRects(px, w, h, x0, y0, S) {
  let b = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b += `<rect x="${x0 + x * S}" y="${y0 + y * S}" width="${S + 0.3}" height="${S + 0.3}" fill="${hex6(px[y * w + x])}"/>`;
  return b;
}
function figGallery() {
  const items = [['gradient_shader', 'Gradient shader', 'one thread per pixel, no divergence'], ['triangle_raster', 'Triangle rasterizer', 'edge functions + barycentric color'], ['mandelbrot', 'Mandelbrot set', 'Q16.16 iterations, heavy divergence']];
  let b = T(20, 32, 'Rendered by the Verilog: three framebuffers read back from RTL simulation', 'h', 22);
  b += T(20, 52, 'Every pixel below was computed by rtl/ps_sm.v in Icarus Verilog and checked against the golden model and a CPU renderer.', 'ink2', 13);
  items.forEach(([k, title, sub], i) => {
    const { fb, px, meta } = framebuffer(k);
    const S = Math.floor(288 / fb.width); const x0 = 20 + i * 312, y0 = 76;
    b += R(x0 - 2, y0 - 2, fb.width * S + 4, fb.height * S + 4, 'box', 4);
    b += pixelRects(px, fb.width, fb.height, x0, y0, S);
    const yt = y0 + 32 * 9 + 22;
    b += T(x0, yt, title, 'h', 17) + T(x0, yt + 18, sub, 'ink2', 12.5);
    b += T(x0, yt + 36, `${fb.width} x ${fb.height} px, ${meta.cycles.toLocaleString('en-US')} cycles on 2 SMs`, 'mono ink3', 11.5);
  });
  write('fig-gallery.svg', 960, 76 + 288 + 80, b, 'Three images rendered by the Pixelstorm Verilog');
}
function figRaster() {
  const { fb, px } = framebuffer('triangle_raster');
  const A = [32, 4], B = [60, 58], C = [4, 52]; const S = 12; const X0 = 30, Y0 = 70;
  const P = (v) => [X0 + v[0] / 2 * S, Y0 + v[1] / 2 * S];
  let b = T(20, 32, 'Rasterization with edge functions (kernels/14_triangle_raster.psa)', 'h', 22);
  b += T(20, 52, 'Each thread tests its pixel center against three edges; all three positive means inside. The values are also the blend weights.', 'ink2', 13);
  b += pixelRects(px, 32, 32, X0, Y0, S);
  for (let i = 0; i <= 32; i += 4) { b += L(X0 + i * S, Y0, X0 + i * S, Y0 + 32 * S, 'ln', 0.5, '', 'opacity=".4"') + L(X0, Y0 + i * S, X0 + 32 * S, Y0 + i * S, 'ln', 0.5, '', 'opacity=".4"'); }
  const [ax, ay] = P(A), [bx, by] = P(B), [cx, cy] = P(C);
  b += `<path d="M${ax},${ay} L${bx},${by} L${cx},${cy} Z" fill="none" stroke="#FFFFFF" stroke-width="2.2"/>`;
  b += `<circle cx="${ax}" cy="${ay}" r="6" fill="#E5484D"/><circle cx="${bx}" cy="${by}" r="6" fill="#30A46C"/><circle cx="${cx}" cy="${cy}" r="6" fill="#3E63DD"/>`;
  b += T(ax + 10, ay + 4, 'A (red)', 'h w', 14) + T(bx - 64, by + 20, 'B (green)', 'h w', 14) + T(cx - 6, cy + 22, 'C (blue)', 'h w', 14);
  // a sample pixel
  const sx = 20, sy = 20; const spx = [X0 + (sx + 0.5) * S, Y0 + (sy + 0.5) * S];
  b += `<rect x="${X0 + sx * S}" y="${Y0 + sy * S}" width="${S}" height="${S}" fill="none" stroke="#FFFFFF" stroke-width="2.5"/>`;
  const edge = (Pp, V0, V1) => (V1[1] - V0[1]) * Pp[0] - (V1[0] - V0[0]) * Pp[1] + (V0[1] * (V1[0] - V0[0]) - V0[0] * (V1[1] - V0[1]));
  const Pp = [2 * sx + 1, 2 * sy + 1]; const area = edge(A, C, B);
  const w = [edge(Pp, C, B), edge(Pp, A, C), edge(Pp, B, A)];
  const tx = X0 + 32 * S + 30;
  b += T(tx, 90, `Pixel (${sx}, ${sy}), center (${Pp[0]}, ${Pp[1]}) in half-pixel units:`, 'h', 16);
  const rows = [['wA  edge C to B', w[0], 'red'], ['wB  edge A to C', w[1], 'green'], ['wC  edge B to A', w[2], 'blue']];
  rows.forEach(([n, v, c], i) => {
    const y = 118 + i * 30;
    b += T(tx, y, n, 'mono', 13) + T(tx + 170, y, String(v), 'mono', 13, 'end') + T(tx + 180, y, `>= 0, ${c} = ${Math.floor(v * Math.trunc(255 * 65536 / area) / 65536)}`, 'ink2', 13);
  });
  b += T(tx, 222, `All three >= 0, so the pixel is inside. wA + wB + wC = ${w[0] + w[1] + w[2]} = twice the area.`, 'ink2', 13);
  b += T(tx, 256, 'The same test, in hardware terms:', 'h', 16);
  const code = ['MAD  R2, R5, R0, R6   ; wA = a*Px + b*Py + c', 'MIN  R5, R2, R3', 'MIN  R5, R5, R4', 'SETP.GE P0, R5, R6    ; inside?', 'QMUL R2, R2, R7       ; weight -> red', '@!P0 MOV R2, R8       ; outside: background'];
  code.forEach((c, i) => { b += T(tx, 282 + i * 20, c, 'mono', 12.5); });
  b += T(tx, 420, 'Real GPUs do this in a fixed-function rasterizer that', 'ink2', 13) + T(tx, 438, 'tests many pixels per cycle, then launch a pixel shader', 'ink2', 13) + T(tx, 456, 'thread for each covered pixel. Pixelstorm does both in', 'ink2', 13) + T(tx, 474, 'the shader: one thread per pixel.', 'ink2', 13);
  write('fig-raster.svg', 960, Y0 + 32 * S + 30, b, 'Triangle rasterization with edge functions');
}
function figMandelDivergence() {
  const { fb, px, tr } = framebuffer('mandelbrot');
  const MAX = 12; const it = px.map(v => v === 0 ? MAX : ((v >> 8) & 255) / 10);
  const S = 14; const X0 = 20, Y0 = 70;
  let b = T(20, 32, 'Why the Mandelbrot set is the poster child for divergence', 'h', 22);
  b += T(20, 52, 'Left: iterations each pixel needed. Right: iterations its warp (8 pixels in a row) had to issue. The difference is idle lane time.', 'ink2', 13);
  const shade = (f) => { const c = Math.round(255 * (1 - f)); return `rgb(${c},${c},${Math.round(c * 0.9 + 25)})`; };
  let useful = 0, slots = 0;
  for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) {
    const v = it[y * fb.width + x]; const w0 = x & ~7;
    let mx = 0; for (let k = w0; k < w0 + 8; k++) mx = Math.max(mx, it[y * fb.width + k]);
    useful += v + 1; slots += mx + 1;
    b += `<rect x="${X0 + x * S}" y="${Y0 + y * S}" width="${S + 0.3}" height="${S + 0.3}" fill="${shade(v / MAX)}"/>`;
    const idle = (mx - v) / (mx + 1);
    b += `<rect x="${X0 + 470 + x * S}" y="${Y0 + y * S}" width="${S + 0.3}" height="${S + 0.3}" class="${idle > 0.01 ? 'fm' : 'fg'}" opacity="${idle > 0.01 ? (0.25 + 0.75 * idle).toFixed(2) : 0.85}"/>`;
  }
  for (let y = 0; y <= fb.height; y++) for (const off of [0, 470]) b += L(X0 + off, Y0 + y * S, X0 + off + 32 * S, Y0 + y * S, 'ln', 0.6, '', 'opacity=".5"');
  for (let x = 0; x <= 32; x += 8) for (const off of [0, 470]) b += L(X0 + off + x * S, Y0, X0 + off + x * S, Y0 + 16 * S, 'lnd', 1.6, '');
  const yb = Y0 + 16 * S + 26;
  b += T(X0, yb, 'darker = more iterations (black = never escaped, 12)', 'ink2', 12.5);
  b += T(X0 + 470, yb, 'green = lane busy until its warp finished; magenta = lane idle', 'ink2', 12.5);
  const commits = tr.events.filter(e => e.ev === 'commit');
  const eff = commits.reduce((a, c) => a + W.popcount(c.exe), 0) / (commits.length * 8);
  b += T(X0, yb + 34, `Loop iterations needed vs issued: ${Math.round(100 * useful / slots)}%. Whole-kernel SIMD efficiency on the RTL: ${Math.round(eff * 100)}%.`, 'h', 16);
  b += T(X0, yb + 56, 'Warp boundaries are the thick vertical lines. Warps on the edge of the set are the expensive ones.', 'ink2', 13);
  write('fig-mandel-divergence.svg', 960, yb + 74, b, 'Mandelbrot iteration counts and idle lanes per warp');
}

// ---------------------------------------------------------------------------
// silicon: RTL -> GDS flow, and where the area goes (from web/data/silicon.json)
// ---------------------------------------------------------------------------
function figSiliconFlow() {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'data', 'silicon.json'), 'utf8'));
  const steps = [
    ['Verilog RTL', 'rtl/*.v', 'done', 'tb'], ['Synthesis', 'Yosys + sky130 Liberty', 'done', 'tg'],
    ['Gate netlist', `${S.cells.toLocaleString('en-US')} cells`, 'done', 'tg'], ['Floorplan', `${S.die_um[0]} x ${S.die_um[1]} um`, 'done', 'ta'],
    ['Placement', `${Math.round(S.utilization * 100)}% utilization`, 'done', 'ta'], ['Clock tree', 'OpenROAD', 'next', 'box'],
    ['Routing', 'OpenROAD', 'next', 'box'], ['Sign-off', 'DRC, LVS, timing', 'next', 'box'], ['GDS', 'KLayout', 'done', 'tm'],
    ['Fab', 'SkyWater 130 nm', 'real', 'tv'], ['Package', 'bond, test', 'real', 'tv'],
  ];
  let b = T(20, 32, 'From Verilog to silicon: the steps, and which ones Pixelstorm runs today', 'h', 22);
  b += T(20, 52, 'Solid: done by make silicon. Dashed: the rest of a real flow (OpenROAD / OpenLane). Violet: what a foundry and packaging house do.', 'ink2', 13);
  steps.forEach(([t, sub, st, cls], i) => {
    const x = 20 + (i % 6) * 156, y = 80 + Math.floor(i / 6) * 118;
    b += R(x, y, 140, 80, cls, 8, st === 'next' ? 'stroke-dasharray="6 4" stroke-width="1.6"' : 'stroke-width="1.6"');
    b += T(x + 12, y + 28, t, 'h', 17) + T(x + 12, y + 50, sub, 'ink2', 12);
    b += T(x + 12, y + 68, st === 'done' ? 'Pixelstorm: yes' : st === 'next' ? 'exercise' : 'industry', st === 'done' ? 'h fg' : 'h ink3', 12);
    if (i % 6 !== 5 && i < steps.length - 1) b += L(x + 142, y + 40, x + 154, y + 40, 'lnd', 1.6);
  });
  b += P('M 800 160 C 820 185, 40 180, 20 198', 'lnd', 1.4, 'ah', 'stroke-dasharray="4 4"');
  write('fig-silicon-flow.svg', 960, 330, b, 'The RTL-to-GDS flow and what Pixelstorm runs');
}
function figSiliconArea() {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'data', 'silicon.json'), 'utf8'));
  const kinds = {}; const lab = { rf: 'register files', lane: 'ALU lanes (8)', smem: 'shared memory', ctrl: 'schedulers, LSUs, control', imem: 'instruction memory', cmem: 'constant bank', arb: 'memory arbiter', disp: 'dispatcher', top: 'top level' };
  for (const blk of S.blocks) { let k = blk.id.split('.').pop(); if (k.startsWith('lane')) k = 'lane'; kinds[k] = (kinds[k] || 0) + blk.area_um2; }
  const rows = Object.entries(kinds).sort((a, c) => c[1] - a[1]); const tot = rows.reduce((a, r) => a + r[1], 0);
  const cls = { rf: 'fv', lane: 'fg', smem: 'fa', ctrl: 'fb', imem: 'fb', cmem: 'fb', arb: 'fm', disp: 'fb', top: 'fs' };
  let b = T(20, 32, `Where the ${(tot / 1e6).toFixed(2)} mm² of logic goes (SkyWater 130 nm, ps_s130 configuration)`, 'h', 22);
  b += T(20, 52, 'Standard-cell area by block, from Yosys + the placer. Arithmetic lanes and storage dominate, as on every GPU.', 'ink2', 13);
  rows.forEach(([k, a], i) => {
    const y = 76 + i * 30; const w = a / rows[0][1] * 250;
    b += T(20, y + 16, lab[k] || k, 'ink', 13.5) + R(230, y + 2, w, 20, cls[k] || 'fs', 3) + T(236 + w, y + 17, `${(a / 1e6).toFixed(3)} mm²  ${(100 * a / tot).toFixed(1)}%`, 'mono ink2', 11.5);
  });
  const x0 = 580; const tt = S.top_cell_types.slice(0, 12); const mx = tt[0][1];
  b += T(x0 + 150, 72, "Most used cells", "h", 16);
  tt.forEach(([n, c], i) => { const y = 104 + i * 22; b += T(x0 + 140, y + 13, n, 'mono', 11.5, 'end') + R(x0 + 150, y + 2, c / mx * 210, 14, 'fs', 2) + T(x0 + 156 + c / mx * 210, y + 13, c.toLocaleString('en-US'), 'mono ink3', 11); });
  const h = Math.max(76 + rows.length * 30, 104 + tt.length * 22) + 30;
  b += T(20, h - 6, `${S.cells.toLocaleString('en-US')} cells (${S.flops.toLocaleString('en-US')} flip-flops) plus ${S.fillers.toLocaleString('en-US')} tap/decap/filler cells on a ${S.die_um[0]} x ${S.die_um[1]} um die (${S.die_mm2} mm²).`, 'ink2', 12.5);
  write('fig-silicon-area.svg', 960, h + 10, b, 'Silicon area by block and most used standard cells');
}

// ---------------------------------------------------------------------------
// the cache: same kernels with and without rtl/ps_cache.v (golden model, which
// ./pixelstorm test proves equal to the RTL cycle for cycle)
// ---------------------------------------------------------------------------
function figCache() {
  const K = [['07_matmul.psa', 'matmul', 'reuses rows and columns'], ['08_coalescing.psa', 'coalescing', 'a little reuse'],
             ['13_gradient_shader.psa', 'gradient_shader', 'pure streaming'], ['06_histogram.psa', 'histogram', 'atomics bypass the cache']];
  const rows = K.map(([f, n, why]) => {
    const src = fs.readFileSync(path.join(ROOT, 'kernels', f), 'utf8').replace(/^\.cache.*$/m, '');
    const run = (cl) => { const t = W.buildTrace(src, { numSms: 2, cacheLines: cl }); const hits = t.events.filter(e => e.ev === 'cache' && e.hit).length;
      const look = t.events.filter(e => e.ev === 'cache').length; const mreq = t.events.filter(e => e.ev === 'mreq').length; return { cyc: t.meta.cycles, dram: mreq - hits, hits, look }; };
    return { n, why, a: run(0), b: run(16) };
  });
  let b = T(20, 32, 'A 16-line cache between the arbiter and DRAM: who wins, who loses', 'h', 22);
  b += T(20, 52, 'Same instructions, 2 SMs, DRAM latency 8. Grey: no cache. Colored: with rtl/ps_cache.v. Computed by the golden model, which the tests match to the RTL.', 'ink2', 13);
  const mx = Math.max(...rows.map(r => Math.max(r.a.cyc, r.b.cyc)));
  rows.forEach((r, i) => {
    const y = 84 + i * 86; const d = (r.b.cyc - r.a.cyc) / r.a.cyc; const good = d < 0;
    b += T(20, y + 14, r.n, 'h', 16) + T(20, y + 32, r.why, 'ink2', 12);
    const W1 = r.a.cyc / mx * 390, W2 = r.b.cyc / mx * 390;
    b += R(200, y, W1, 18, 'fs', 3, 'opacity=".45"') + T(206 + W1, y + 14, `${r.a.cyc.toLocaleString('en-US')} cycles`, 'mono ink2', 11);
    b += R(200, y + 24, W2, 18, good ? 'fg' : 'fm', 3) + T(206 + W2, y + 38, `${r.b.cyc.toLocaleString('en-US')} cycles (${good ? '' : '+'}${(100 * d).toFixed(0)}%)`, 'mono', 11);
    b += T(780, y + 14, `${r.b.look ? Math.round(100 * r.b.hits / r.b.look) : 0}% hits`, 'h ' + (r.b.hits ? 'fg' : 'ink3'), 16);
    b += T(780, y + 34, `DRAM trips ${r.a.dram} -> ${r.b.dram}`, 'mono ink2', 11.5);
  });
  b += T(20, 84 + rows.length * 86 + 8, 'Reuse pays: most matmul loads never reach DRAM. Streaming loses a little: every miss now takes an extra hop through the cache.', 'ink2', 13);
  write('fig-cache.svg', 960, 84 + rows.length * 86 + 26, b, 'Cycles and DRAM trips with and without the cache');
}

const SIL = fs.existsSync(path.join(ROOT, 'web', 'data', 'silicon.json')) ? [figSiliconFlow, figSiliconArea] : [];
[...SIL, figCache, figGallery, figRaster, figMandelDivergence, figThreads, figShuffle, figTop, figSm, figEncoding, figFsm, figLifecycle, figDivergence, figCoalescing, figBanks, figTimelines, figScale, figLatency, figHierarchy].forEach(f => f());
