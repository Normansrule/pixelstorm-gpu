#!/usr/bin/env node
/* fpga/gen_programs.js — assemble the FPGA demo kernels into the loader's ROM images.
 *   slot 0 gradient_shader, 1 triangle_raster, 2 mandelbrot,
 *   3 mandelbrot again with different kernel arguments (zoomed onto the top bulb):
 *     the same instructions, only the constant bank changes.
 * Writes fpga/gen/prog_imem.hex, prog_cmem.hex, prog_info.hex and slots.json.   */
'use strict';
const fs = require('fs'), path = require('path');
const W = require('../web/js/pixelstorm.js');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'gen');
const IMEM = 256;
const ONE = 65536, STEP = Math.round(0.70 / 32 * ONE);                       // the top bulb of the set: 0.70 wide
const SLOTS = [
  { file: '13_gradient_shader.psa' },
  { file: '14_triangle_raster.psa' },
  { file: '15_mandelbrot.psa' },
  { file: '15_mandelbrot.psa', name: 'mandelbrot_zoom', params: { 1: Math.round(-0.1 * ONE) - 16 * STEP + STEP / 2, 2: Math.round(0.85 * ONE) - 8 * STEP + STEP / 2, 3: STEP, 4: 24 } },
];
const hex = (v) => (v >>> 0).toString(16).padStart(8, '0');
const imem = [], cmem = [], info = [], meta = [];
for (const s of SLOTS) {
  const src = fs.readFileSync(path.join(ROOT, 'kernels', s.file), 'utf8');
  const a = W.assemble(src);
  if (a.words.length > IMEM) throw new Error(`${s.file}: ${a.words.length} instructions > ${IMEM}`);
  if (!a.config.fb) throw new Error(`${s.file}: FPGA demo kernels need a .fb framebuffer`);
  const params = a.config.params.slice(0, 16);
  for (const [k, v] of Object.entries(s.params || {})) params[+k] = v;
  for (let i = 0; i < IMEM; i++) imem.push(hex(a.words[i] || 0));
  for (let i = 0; i < 16; i++) cmem.push(hex(params[i] || 0));
  info.push(hex(a.config.grid), hex(a.config.block), hex(a.config.fb.addr), hex((a.config.fb.width << 8) | a.config.fb.height));
  meta.push({ slot: meta.length, name: s.name || a.config.name, file: s.file, grid: a.config.grid, block: a.config.block, fb: a.config.fb, params, instructions: a.words.length });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'prog_imem.hex'), imem.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'prog_cmem.hex'), cmem.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'prog_info.hex'), info.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'slots.json'), JSON.stringify(meta, null, 1));
// kernel names for the on-screen status line: 16 characters per slot, upper case, space padded
const names = [];
for (const m of meta) { const t = m.name.toUpperCase().replace(/[^ -_]/g, ' ').padEnd(16).slice(0, 16); for (const ch of t) names.push(ch.charCodeAt(0).toString(16).padStart(2, '0')); }
fs.writeFileSync(path.join(OUT, 'prog_names.hex'), names.join('\n') + '\n');
console.log('fpga/gen: ' + meta.map(m => `${m.slot}=${m.name}`).join(', '));
