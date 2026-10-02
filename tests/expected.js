/* Independent "what is the right answer" checks, written the way a CPU would
 * compute them. tools/pixelstorm.js test runs these on the RTL's final memory, so a
 * kernel only passes if the hardware AND the golden model agree AND the math
 * is right. Each function returns null (ok) or an error string. */
'use strict';

function initMem(asm) {
  const m = new Map();
  for (const b of asm.config.data) b.values.forEach((v, i) => m.set(b.addr + i, v >>> 0));
  return (a) => m.get(a) || 0;
}
function check(g, base, expect, what) {
  for (let i = 0; i < expect.length; i++) {
    if ((g[base + i] >>> 0) !== (expect[i] >>> 0)) return `${what}[${i}] = ${g[base + i] | 0}, expected ${expect[i] | 0}`;
  }
  return null;
}

module.exports = {
  vector_add(g) {
    return check(g, 0x200, Array.from({ length: 64 }, (_, i) => i + 100 + 10 * i), 'C');
  },
  saxpy_fixed(g) {
    return check(g, 0x100, Array.from({ length: 64 }, (_, i) => Math.round((2.5 * i + 1) * 65536)), 'y');
  },
  divergence(g) {
    return check(g, 0x300, Array.from({ length: 16 }, (_, i) => ((i & 1) ? i * 3 : i >> 1) + 10 * (i & 3)), 'out');
  },
  reduction_shared(g) {
    return check(g, 0x400, [0, 1, 2, 3].map(b => { let s = 0; for (let k = 1; k <= 32; k++) s += 32 * b + k; return s; }), 'out');
  },
  reduction_shuffle(g) {
    return check(g, 0x500, [128 * 129 / 2], 'out');
  },
  histogram(g, asm) {
    const m = initMem(asm); const bins = new Array(16).fill(0);
    for (let i = 0; i < 128; i++) bins[m(i)]++;
    return check(g, 0x600, bins, 'bins');
  },
  matmul(g) {
    const A = (r, c) => 1 + r * 8 + c; const B = (r, c) => r * 8 + c;
    const C = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { let s = 0; for (let k = 0; k < 8; k++) s += A(r, k) * B(k, c); C.push(s); }
    return check(g, 0x80, C, 'C');
  },
  coalescing(g) {
    const e = [];
    for (let t = 0; t < 8; t++) e.push(t);
    for (let t = 0; t < 8; t++) e.push(t * 4);
    for (let t = 0; t < 8; t++) e.push(0);
    return check(g, 0x700, e, 'out');
  },
  bank_conflicts(g) {
    const e = [];
    for (let t = 0; t < 8; t++) e.push(100 * t);                 // s[64+t]
    for (let t = 0; t < 8; t++) e.push(t === 0 ? 5 : 100 * t);   // s[8t]; s[0] untouched... except s[5]? no: 8t never equals 5
    for (let t = 0; t < 8; t++) e.push(5);                       // s[5]
    for (let t = 0; t < 8; t++) e.push(2 * t < 8 ? 100 * (2 * t) : 0); // s[64+2t]
    // s[8*0] = s[0] is written with 100*0 = 0 by lane 0, so lane 0 reads 0
    e[8] = 0;
    return check(g, 0x780, e, 'out');
  },
  vote_ballot(g, asm) {
    const m = initMem(asm); const e = [];
    for (let w = 0; w < 4; w++) {
      let mask = 0;
      for (let l = 0; l < 8; l++) if ((m(w * 8 + l) | 0) > 50) mask |= 1 << l;
      const pc = mask.toString(2).split('').filter(x => x === '1').length;
      e.push(mask, pc, mask ? 1 : 0, mask === 0xff ? 1 : 0);
    }
    return check(g, 0x7C0, e, 'out');
  },
  prefix_scan(g) {
    return check(g, 0x800, Array.from({ length: 32 }, (_, i) => (i % 8) + 1), 'out');
  },
  threshold_image(g, asm) {
    const m = initMem(asm);
    return check(g, 0x900, Array.from({ length: 64 }, (_, i) => (m(i) > 128 ? 255 : 0)), 'out');
  },

  // ---- graphics kernels: recompute every pixel the way a CPU renderer would ----
  gradient_shader(g) {
    const px = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px.push(((x * 8) << 16) | ((y * 8) << 8) | Math.max(0, 255 - 4 * (x + y)));
    return check(g, 0x1000, px, 'fb');
  },
  triangle_raster(g) {
    const A = [32, 4], B = [60, 58], C = [4, 52];               // half-pixel units, as in the kernel
    const edge = (P, V0, V1) => (V1[1] - V0[1]) * P[0] - (V1[0] - V0[0]) * P[1] + (V0[1] * (V1[0] - V0[0]) - V0[0] * (V1[1] - V0[1]));
    const area = edge(A, C, B);
    const k = Math.trunc(255 * 65536 / area);
    const px = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const P = [2 * x + 1, 2 * y + 1];
      const w = [edge(P, C, B), edge(P, A, C), edge(P, B, A)];
      const inside = Math.min(...w) >= 0;
      const ch = w.map(v => Number((BigInt(v) * BigInt(k)) >> 16n));
      px.push(inside ? ((ch[0] << 16) | (ch[1] << 8) | ch[2]) >>> 0 : 0x101828);
    }
    return check(g, 0x1000, px, 'fb');
  },
  mandelbrot(g) {
    const ONE = 65536, STEP = ONE / 8, MAXIT = 12;
    const q = (a, b) => Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> 16n));
    const px = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const cx = STEP / 2 - 5 * ONE / 2 + x * STEP, cy = STEP / 2 - ONE + y * STEP;
      let zx = 0, zy = 0, it = 0;
      for (;;) {
        const x2 = q(zx, zx), y2 = q(zy, zy);
        if (x2 + y2 > 4 * ONE || it >= MAXIT) break;
        zy = ((q(zx, zy) << 1) + cy) | 0; zx = (x2 - y2 + cx) | 0; it++;
      }
      const r = Math.min(255, 24 * it), gr = 10 * it, b = Math.max(0, 170 - 12 * it);
      px.push(it >= MAXIT ? 0 : (r << 16) | (gr << 8) | b);
    }
    return check(g, 0x1000, px, 'fb');
  },
  matmul_cached(g, asm) { return module.exports.matmul(g, asm); },
};
