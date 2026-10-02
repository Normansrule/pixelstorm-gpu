#!/usr/bin/env node
/* fpga/sim/check.js <slot> <frame.ppm> [out.png-ish.ppm]
 * Runs the golden model with the FPGA's GPU configuration on the same ROM slot,
 * then checks that every framebuffer pixel appears on the captured VGA frame
 * (RGB444, the top 4 bits of each channel), at the position ps_vga.v draws it. */
'use strict';
const fs = require('fs'), path = require('path');
const W = require('../../web/js/pixelstorm.js');
const slot = +process.argv[2], ppm = process.argv[3];
const NW = +(process.argv[4] || 4), WS = +(process.argv[5] || 8);          // GPU shape of the build under test
const S = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gen', 'slots.json'), 'utf8'))[slot];
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'kernels', S.file), 'utf8');
const a = W.assemble(src);
const sim = new W.Simulator(Object.assign({}, W.DEFAULT_CFG, { numSms: 1, numWarps: NW, warpSize: WS }));
sim.load(a.words, S.params, a.config.data);
const m = sim.run(S.grid, S.block, { trace: false });
const tok = fs.readFileSync(ppm, 'utf8').split(/\s+/).filter(Boolean);
const Wd = +tok[1], Ht = +tok[2]; const px = tok.slice(4).map(Number);
const SC = 12, fw = S.fb.width, fh = S.fb.height; const x0 = (640 - fw * SC) >> 1, y0 = ((480 - fh * SC) >> 1) - 16;
let bad = 0;
for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
  const v = m.gmem[S.fb.addr + y * fw + x] >>> 0;
  const want = [(v >> 20) & 15, (v >> 12) & 15, (v >> 4) & 15];
  const sy = y0 + y * SC + SC / 2;
  for (const sx of [x0 + x * SC, x0 + x * SC + SC / 2, x0 + x * SC + SC - 1]) {   // left edge, centre, right edge
  const i = (sy * Wd + sx) * 3; const got = [px[i], px[i + 1], px[i + 2]];
  if (got.join() !== want.join()) { if (bad < 5) console.log(`pixel (${x},${y}) at screen x=${sx}: ${got} vs model ${want}`); bad++; break; }
  }
}
console.log(bad ? `FAIL: ${bad} of ${fw * fh} pixels differ` : `PASS: all ${fw * fh} framebuffer pixels on the VGA frame match the golden model (${S.name})`);
process.exitCode = bad ? 1 : 0;
