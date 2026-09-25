#!/usr/bin/env node
/* tools/site_data.js — small JSON files for the home page, extracted from the
 * RTL traces so the landing page animates real hardware behaviour without
 * downloading multi-megabyte traces.   node tools/site_data.js  (make site) */
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('../web/js/pixelstorm.js');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'web', 'data');
fs.mkdirSync(OUT, { recursive: true });
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'traces', 'index.json'), 'utf8'));

const paint = {};
const kernels = [];
for (const ent of idx) {
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'traces', ent.file), 'utf8'));
  const m = tr.meta; const commits = tr.events.filter(e => e.ev === 'commit');
  const lane = commits.reduce((a, c) => a + W.popcount(c.exe), 0);
  kernels.push({ name: m.kernel, cycles: m.cycles, instr: commits.length, simd: Math.round(1000 * lane / (commits.length * m.warpSize)) / 10, grid: m.grid, block: m.block, graphics: !!m.fb });
  if (!m.fb) continue;
  const fb = m.fb; const n = fb.width * fb.height;
  const color = new Array(n).fill(0), t = new Array(n).fill(0), sm = new Array(n).fill(0);
  // gw events carry the address and cycle; the SM comes from the arbiter's write request (mreq) for that line
  const open = new Map();                   // line address -> sm of the latest write request
  for (const e of tr.events.filter(x => x.ev === 'gw' || (x.ev === 'mreq' && x.op === 1)).sort((x, y) => x.t - y.t || (x.ev === 'mreq' ? -1 : 1))) {
    if (e.ev === 'mreq') { open.set(e.a & ~(m.lineWords - 1), e.sm); continue; }
    const i = e.a - fb.addr; if (i < 0 || i >= n) continue;
    color[i] = e.v >>> 0; t[i] = e.t; sm[i] = open.get(e.a & ~(m.lineWords - 1)) || 0;
  }
  paint[m.kernel] = { width: fb.width, height: fb.height, cycles: m.cycles, color, t, sm };
}
// ~40 real lines of the SM scheduler for the home page's code card
const sm = fs.readFileSync(path.join(ROOT, 'rtl', 'ps_sm.v'), 'utf8').split('\n');
const s0 = sm.findIndex(l => /Warp status \+ scheduler/.test(l));
const rtl = sm.slice(Math.max(0, s0 - 1), s0 + 42).join('\n');
const isa = W.ISA.map(e => ({ name: e.name, group: e.group, cuda: e.cuda }));
fs.writeFileSync(path.join(OUT, 'site.json'), JSON.stringify({ kernels, paint, isa, rtl }));
console.log(`web/data/site.json  ${kernels.length} kernels, ${Object.keys(paint).length} framebuffers`);
