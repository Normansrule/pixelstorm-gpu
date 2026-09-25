/* =============================================================================
 * labs.js — five small GPU experiments (coalescing, banks, divergence,
 * latency hiding, occupancy). Each lab is: read knobs -> compute exactly what
 * the hardware would do -> draw it as SVG -> explain the number.
 * ========================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  // ---------- theme (shared with the visualizer) ----------
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
    try { localStorage.setItem('ps-theme', t); } catch (e) { /* storage blocked */ }
    renderAll();
  }

  // ---------- tiny SVG builder ----------
  function S(svg, w, h) {
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = '';
    const g = { svg };
    g.rect = (x, y, ww, hh, cls, rx = 4) => add('rect', { x, y, width: Math.max(0, ww), height: hh, rx, class: cls });
    g.text = (x, y, s, cls = '', anchor = 'start') => { const t = add('text', { x, y, class: cls, 'text-anchor': anchor }); t.textContent = s; return t; };
    g.line = (x1, y1, x2, y2, cls) => add('line', { x1, y1, x2, y2, class: cls });
    function add(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; }
    return g;
  }
  const bind = (id, fn) => { const el = $(id); el.addEventListener('input', fn); el.addEventListener('change', fn); };
  const out = (id, v) => { $(id + 'O').textContent = v; };
  const plural = (n, a, b) => `${n} ${n === 1 ? a : (b || a + 's')}`;
  const GROUP = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'];

  // =========================================================================
  // 1. coalescing
  // =========================================================================
  function coalesce() {
    const stride = +$('cStride').value, off = +$('cOff').value, L = +$('cLine').value, WS = +$('cWarp').value;
    out('cStride', stride); out('cOff', off);
    const addr = [...Array(WS).keys()].map(l => off + l * stride);
    // exactly the RTL algorithm: leader = lowest pending lane, serve its line
    let pend = [...Array(WS).keys()]; const txn = new Array(WS); const lines = [];
    while (pend.length) {
      const line = Math.floor(addr[pend[0]] / L) * L;
      lines.push(line);
      pend = pend.filter(l => { if (Math.floor(addr[l] / L) * L === line) { txn[l] = lines.length - 1; return false; } return true; });
    }
    const Wd = 980; const maxA = Math.max(...addr) + 1;
    const span = Math.min(Math.max(maxA, L * 2), 160);
    const H = 250;
    const g = S($('cSvg'), Wd, H);
    const lw = Math.min(90, (Wd - 40) / WS - 4);
    g.text(20, 18, 'lanes', 'lab-cap');
    addr.forEach((a, l) => {
      const x = 20 + l * (lw + 4);
      g.rect(x, 26, lw, 28, 'chip ' + GROUP[txn[l] % 8]);
      if (lw > 22) g.text(x + lw / 2, 45, WS > 16 ? String(l) : `lane ${l}`, 'chip-t', 'middle');
    });
    const cw = (Wd - 40) / span;
    g.text(20, 138, `global memory words 0 to ${span - 1}${maxA > span ? ' (clipped)' : ''}`, 'lab-cap');
    for (let a = 0; a < span; a++) {
      const line = Math.floor(a / L) * L; const k = lines.indexOf(line);
      g.rect(20 + a * cw, 146, Math.max(1, cw - 1), 30, k >= 0 ? 'cell ' + GROUP[k % 8] : 'cell', 2);
      if (a % L === 0) { g.line(20 + a * cw, 180, 20 + a * cw, 190, 'tick'); if (cw * L > 34) g.text(22 + a * cw, 202, `line ${a}`, 'lab-mini'); }
    }
    addr.forEach((a, l) => { if (a < span) g.line(20 + l * (lw + 4) + lw / 2, 56, 20 + a * cw + cw / 2, 144, 'wire-l'); });
    const used = new Set(addr).size; const fetched = lines.length * L;
    const eff = Math.round(100 * used / fetched);
    g.text(20, 236, `${plural(lines.length, 'transaction')}: ${fetched} words fetched for ${used} distinct words used, bus efficiency ${eff}%`, 'lab-big');
    $('cOut').innerHTML = verdict(lines.length, Math.ceil(WS / L) || 1, WS) +
      `<p>The ideal for ${WS} lanes reading consecutive words is <b>${Math.max(1, Math.ceil(WS / L))}</b> ${Math.ceil(WS / L) === 1 ? 'transaction' : 'transactions'} (${WS} ÷ ${L}). ` +
      (off % L && stride === 1 ? 'A misaligned start makes the warp straddle one extra line. ' : '') +
      (stride >= L ? 'With a stride of a whole line or more, every lane needs its own line: this is the "array of structures" and "column access" pattern. ' : '') +
      (stride === 0 ? 'Every lane asks for the same word, so one transaction is broadcast to all. ' : '') + '</p>';
  }
  function verdict(n, ideal, worst) {
    const cls = n <= ideal ? 'good' : n >= worst ? 'bad' : 'meh';
    const word = n <= ideal ? 'Fully coalesced' : n >= worst ? 'Uncoalesced: one transaction per lane' : 'Partly coalesced';
    return `<p class="verdict ${cls}">${word}</p>`;
  }

  // =========================================================================
  // 2. banks
  // =========================================================================
  function banks() {
    const pat = $('bPat').value, st = +$('bStride').value, NB = +$('bBanks').value, WS = +$('bWarp').value;
    out('bStride', st);
    const addr = [...Array(WS).keys()].map(l => pat === 'same' ? 5 : pat === 'row' ? l * st : l * st + 3);
    let left = [...Array(WS).keys()]; const pass = new Array(WS); let k = 0;
    while (left.length) {
      const used = {};
      left = left.filter(l => { const b = addr[l] % NB; if (!(b in used)) { used[b] = addr[l]; pass[l] = k; return false; } if (used[b] === addr[l]) { pass[l] = k; return false; } return true; });
      k++;
    }
    const Wd = 980; const bw = (Wd - 40) / NB; const chip = Math.min(bw - 4, 30);
    const stackH = {}; for (let l = 0; l < WS; l++) { const b = addr[l] % NB; stackH[b] = (stackH[b] || 0) + 1; }
    const tall = Math.max(...Object.values(stackH));
    const ch = Math.min(22, 200 / Math.max(tall, 1)); const H = 90 + tall * (ch + 2) + 70;
    const g = S($('bSvg'), Wd, H);
    const base = 40 + tall * (ch + 2);
    const cnt = {};
    for (let l = 0; l < WS; l++) {
      const b = addr[l] % NB; cnt[b] = (cnt[b] || 0) + 1;
      const y = base - cnt[b] * (ch + 2);
      g.rect(20 + b * bw + (bw - chip) / 2, y, chip, ch, 'chip ' + (pass[l] === 0 ? 'g0' : 'bad'), 3);
      if (chip >= 18 && ch >= 12) g.text(20 + b * bw + bw / 2, y + ch / 2 + 4, String(l), 'chip-t', 'middle');
    }
    for (let b = 0; b < NB; b++) {
      g.rect(20 + b * bw + 1, base + 6, bw - 2, 30, 'cell bank', 3);
      if (bw > 16) g.text(20 + b * bw + bw / 2, base + 26, String(b), 'lab-mini', 'middle');
    }
    g.text(20, base + 56, `bank (address mod ${NB})`, 'lab-cap');
    g.text(20, 22, `${plural(k, 'pass', 'passes')} = ${k} cycle${k > 1 ? 's' : ''} for this warp's access`, 'lab-big');
    const ideal = 1;
    $('bOut').innerHTML = `<p class="verdict ${k === ideal ? 'good' : k >= WS / 2 ? 'bad' : 'meh'}">${k === 1 ? 'Conflict-free' : `${k}-way bank conflict`}</p>` +
      `<p>Chip number = lane. Green chips are served in the first cycle, magenta ones wait. ${pat === 'col' && st % NB === 0 ? `A row pitch that is a multiple of ${NB} puts a whole column in one bank. Try pitch ${st + 1}.` : ''}${pat === 'col' && st % 2 === 1 ? ' An odd pitch spreads a column across all banks: the padding trick.' : ''}${pat === 'same' ? ' Same-word reads are broadcast, so no conflict at all.' : ''}</p>` +
      `<p class="mono small">addresses: ${addr.slice(0, 16).join(', ')}${WS > 16 ? ', …' : ''}</p>`;
  }

  // =========================================================================
  // 3. divergence
  // =========================================================================
  let randMask = null;
  function diverge() {
    const cond = $('dCond').value, A = +$('dA').value, B = +$('dB').value, mode = $('dMode').value;
    out('dA', A); out('dB', B);
    const WS = 8;
    if (!randMask) randMask = [...Array(WS)].map(() => Math.random() < 0.5);
    const take = [...Array(WS).keys()].map(l => cond === 'odd' ? l % 2 === 1 : cond === 'lt' ? l < 2 : cond === 'zero' ? l === 0 : cond === 'warp' ? true : randMask[l]);
    const all = take.map(() => true);
    const rows = []; // {label, mask(active), exe, cls}
    rows.push({ label: 'SETP  P0, cond', act: all, exe: all, kind: 'p' });
    const nT = take.filter(Boolean).length;
    if (mode === 'branch') {
      rows.push({ label: '@!P0 BRA else', act: all, exe: take.map(t => !t), kind: 'c' });
      if (nT > 0) for (let i = 0; i < A; i++) rows.push({ label: `A${i + 1}  (then)`, act: take, exe: take, kind: 'a' });
      if (nT > 0 && nT < WS) rows.push({ label: 'BRA join', act: take, exe: take, kind: 'c' });
      if (nT < WS) for (let i = 0; i < B; i++) rows.push({ label: `B${i + 1}  (else)`, act: take.map(t => !t), exe: take.map(t => !t), kind: 'a' });
    } else {
      for (let i = 0; i < A; i++) rows.push({ label: `@P0 A${i + 1}`, act: all, exe: take, kind: 'a' });
      for (let i = 0; i < B; i++) rows.push({ label: `@!P0 B${i + 1}`, act: all, exe: take.map(t => !t), kind: 'a' });
    }
    rows.push({ label: 'join: next', act: all, exe: all, kind: 'p' });
    const RH = 20, Wd = 980, H = 40 + rows.length * RH + 20;
    const g = S($('dSvg'), Wd, H);
    g.text(20, 20, 'issue', 'lab-cap'); g.text(80, 20, 'instruction', 'lab-cap');
    for (let l = 0; l < WS; l++) g.text(300 + l * 50 + 22, 20, `lane ${l}`, 'lab-cap', 'middle');
    g.text(730, 20, 'useful lanes', 'lab-cap');
    let useful = 0;
    rows.forEach((r, i) => {
      const y = 30 + i * RH;
      g.text(20, y + 14, String(i + 1), 'lab-mini'); g.text(80, y + 14, r.label, 'lab-mono');
      let n = 0;
      for (let l = 0; l < WS; l++) {
        const cls = !r.act[l] ? 'lane-div' : !r.exe[l] ? 'lane-off' : 'lane-exe';
        if (r.act[l] && r.exe[l]) n++;
        g.rect(300 + l * 50, y + 2, 44, RH - 5, cls, 3);
      }
      useful += n;
      g.rect(730, y + 4, n * 16, RH - 9, 'chip g0', 2); g.text(870, y + 14, `${n}/${WS}`, 'lab-mini');
    });
    const slots = rows.length * WS; const eff = Math.round(100 * useful / slots);
    // compare
    const branchCost = 3 + (nT > 0 ? A : 0) + (nT > 0 && nT < WS ? 1 : 0) + (nT < WS ? B : 0);
    const predCost = 2 + A + B;
    $('dOut').innerHTML = `<p class="verdict ${eff > 85 ? 'good' : eff > 55 ? 'meh' : 'bad'}">${rows.length} issues, SIMD efficiency ${eff}%</p>` +
      `<p>Branching costs <b>${branchCost}</b> issue slots here; predication costs <b>${predCost}</b>. ${nT === 0 || nT === WS ? 'Every lane agrees, so the branch is uniform: one path is skipped entirely and branching wins.' : branchCost > predCost ? 'Both paths run anyway, so the branch overhead makes predication cheaper.' : 'Predication is only worth it when both bodies are short.'}</p>` +
      `<p class="small">Green: lane does useful work. Hatched grey: lane is at this PC but its guard is false. Magenta: lane is waiting at another PC (diverged).${cond === 'rand' ? ' <button type="button" id="dReroll" class="linkbtn">New random data</button>' : ''}</p>`;
    const rr = $('dReroll'); if (rr) rr.onclick = () => { randMask = null; diverge(); };
  }

  // =========================================================================
  // 4. latency hiding (same model as docs/img/fig-latency-hiding.svg)
  // =========================================================================
  function latSim(nw, lat, comp, iters, stall) {
    const warps = [...Array(nw)].map(() => ({ i: 0, phase: 'load', ready: 0, left: comp, busy: [] }));
    let t = 0, rr = 0, issued = 0, smBusyUntil = 0;
    while (warps.some(w => w.i < iters) && t < 20000) {
      if (!(stall && t < smBusyUntil)) {
        for (let k = 0; k < nw; k++) {
          const wi = (rr + k) % nw; const w = warps[wi];
          if (w.i >= iters || w.ready > t) continue;
          if (w.phase === 'load') {
            w.busy.push([t, t + 1, 'ld']); w.ready = t + 1 + lat; w.busy.push([t + 1, t + 1 + lat, 'wait']); w.phase = 'comp'; w.left = comp;
            if (stall) smBusyUntil = t + 1 + lat;
          } else { w.busy.push([t, t + 1, 'op']); w.left--; w.ready = t + 1; if (!w.left) { w.i++; w.phase = 'load'; } }
          issued++; rr = wi + 1; break;
        }
      }
      t++;
    }
    return { warps, t, util: issued / t };
  }
  function latency() {
    const nw = +$('lW').value, lat = +$('lL').value, comp = +$('lC').value, it = +$('lI').value, stall = $('lStall').checked;
    out('lW', nw); out('lL', lat); out('lC', comp); out('lI', it);
    const r = latSim(nw, lat, comp, it, stall); const one = latSim(1, lat, comp, it, false);
    const RH = Math.max(8, Math.min(18, 300 / nw)); const Wd = 980, X0 = 50, PW = Wd - X0 - 20;
    const H = 40 + nw * RH + 30;
    const g = S($('lSvg'), Wd, H);
    const cw = PW / r.t;
    g.text(20, 20, `${r.t} cycles to finish ${nw * it} loop iterations`, 'lab-big');
    r.warps.forEach((w, i) => {
      const y = 32 + i * RH;
      g.text(20, y + RH - 4, `W${i}`, 'lab-mini');
      for (const [a, e, k] of w.busy) g.rect(X0 + a * cw, y, Math.max(0.8, (e - a) * cw - 0.3), RH - 3, k === 'wait' ? 'wait' : k === 'ld' ? 'chip g1' : 'chip g0', 1.5);
    });
    const yb = 32 + nw * RH + 6;
    g.rect(X0, yb, PW * r.util, 10, 'chip g0', 2); g.rect(X0 + PW * r.util, yb, PW * (1 - r.util), 10, 'cell', 2);
    g.text(X0 + PW + 2, yb + 10, `${Math.round(r.util * 100)}%`, 'lab-mini', 'end');
    const need = Math.ceil(lat / (comp + 1)) + 1;
    const thr = (nw * it) / r.t, thr1 = it / one.t;
    $('lOut').innerHTML = `<p class="verdict ${r.util > 0.85 ? 'good' : r.util > 0.5 ? 'meh' : 'bad'}">Issue slots used: ${Math.round(r.util * 100)}%</p>` +
      `<p>Throughput is <b>${(thr / thr1).toFixed(1)}×</b> a single warp. To keep the scheduler busy you need about <b>${need}</b> warps (latency ${lat} ÷ ${comp + 1} instructions per iteration, plus one). ${stall ? 'With the SM stalling on every load, extra warps barely help: this is how Pixelstorm behaves today.' : nw >= need ? 'You have enough warps: memory latency is hidden.' : 'Add warps or add arithmetic per load to hide more latency.'}</p>` +
      '<p class="small">Green: arithmetic issue. Amber: load issue. Pale amber: waiting for DRAM (the scheduler can pick another warp). Bottom bar: fraction of cycles in which something issued.</p>';
  }

  // =========================================================================
  // 5. occupancy
  // =========================================================================
  const GPUS = {
    h100: { name: 'H100', warpSize: 32, maxThreads: 2048, maxWarps: 64, maxBlocks: 32, regs: 65536, smemSM: 228, smemBlock: 227, reserve: 1, maxTpb: 1024, regUnit: 256, maxRegs: 255 },
    a100: { name: 'A100', warpSize: 32, maxThreads: 2048, maxWarps: 64, maxBlocks: 32, regs: 65536, smemSM: 164, smemBlock: 163, reserve: 1, maxTpb: 1024, regUnit: 256, maxRegs: 255 },
    rtx: { name: 'RTX 30-series', warpSize: 32, maxThreads: 1536, maxWarps: 48, maxBlocks: 16, regs: 65536, smemSM: 100, smemBlock: 99, reserve: 1, maxTpb: 1024, regUnit: 256, maxRegs: 255 },
    ws: { name: 'Pixelstorm', warpSize: 8, maxThreads: 32, maxWarps: 4, maxBlocks: 1, regs: 512, smemSM: 1, smemBlock: 1, reserve: 0, maxTpb: 32, regUnit: 1, maxRegs: 16 },
  };
  function occupancy() {
    const G = GPUS[$('oGpu').value];
    const tpb = +$('oT').value, rpt = +$('oR').value, smem = +$('oS').value;
    out('oT', tpb); out('oR', rpt); out('oS', smem + ' KB');
    const wpb = Math.ceil(tpb / G.warpSize);
    const problems = [];
    if (tpb > G.maxTpb) problems.push(`${G.name} allows at most ${G.maxTpb} threads per block.`);
    if (rpt > G.maxRegs) problems.push(`${G.name} gives each thread at most ${G.maxRegs} registers${G === GPUS.ws ? ' (R0 to R15)' : ''}; the compiler would spill to local memory.`);
    if (smem > G.smemBlock) problems.push(`${G.name} allows at most ${G.smemBlock} KB of shared memory per block.`);
    const regsPerWarp = Math.ceil(rpt * G.warpSize / G.regUnit) * G.regUnit;
    const lim = {
      'thread slots': Math.floor(G.maxThreads / (wpb * G.warpSize)),
      'block slots': G.maxBlocks,
      'registers': Math.floor(Math.floor(G.regs / regsPerWarp) / wpb),
      'shared memory': smem + G.reserve > 0 ? Math.floor(G.smemSM / (smem + G.reserve)) : Infinity,
    };
    const blocks = problems.length ? 0 : Math.min(...Object.values(lim));
    const warps = Math.min(blocks * wpb, G.maxWarps);
    const occ = warps / G.maxWarps;
    const Wd = 980, H = 230; const g = S($('oSvg'), Wd, H);
    g.text(20, 22, `${G.name}: ${blocks} block${blocks === 1 ? '' : 's'} × ${wpb} warps = ${warps} of ${G.maxWarps} warp slots (${Math.round(occ * 100)}% occupancy)`, 'lab-big');
    const keys = Object.keys(lim); const maxB = Math.max(...keys.map(k => isFinite(lim[k]) ? lim[k] : 0), 1);
    keys.forEach((k, i) => {
      const y = 44 + i * 36; const v = lim[k]; const binding = v === blocks && !problems.length;
      g.text(20, y + 18, `limit from ${k}`, 'lab-cap');
      const w = isFinite(v) ? Math.max(2, v / maxB * 560) : 560;
      g.rect(210, y + 4, w, 20, binding ? 'chip bad' : 'chip g2', 3);
      g.text(220 + w, y + 19, isFinite(v) ? `${v} blocks` : 'no limit', 'lab-mono');
    });
    const sx = 210, sy = 196, cell = Math.min(24, 740 / G.maxWarps);
    for (let i = 0; i < G.maxWarps; i++) g.rect(sx + i * cell, sy, cell - 2, 18, i < warps ? 'chip g0' : 'cell', 2);
    g.text(20, sy + 14, 'warp slots on one SM', 'lab-cap');
    $('oOut').innerHTML = (problems.length ? `<p class="verdict bad">Launch would fail or spill</p><p>${problems.join(' ')}</p>` :
      `<p class="verdict ${occ >= 0.5 ? 'good' : occ >= 0.25 ? 'meh' : 'bad'}">${Math.round(occ * 100)}% occupancy</p>`) +
      `<p>The red bar is the resource that runs out first. ${lim.registers === blocks && !problems.length ? 'Registers are the limit: fewer registers per thread (for example with <code>__launch_bounds__</code>) would fit more warps.' : ''}${lim['shared memory'] === blocks && !problems.length ? 'Shared memory is the limit: smaller tiles fit more blocks.' : ''} Higher occupancy is not always faster, but low occupancy leaves little to switch to while waiting on memory (lab 4).</p>`;
  }


  // =========================================================================
  // 6. pixels and warps (Mandelbrot divergence)
  // =========================================================================
  const REGIONS = {
    full: [-0.6, 0, 1.35], seahorse: [-0.745, 0.11, 0.035], elephant: [0.285, 0.012, 0.03], spiral: [-0.7454, 0.1130, 0.0075],
  };
  const PW = 128, PH = 96;
  function mandelIters(region, maxit) {
    const [cxm, cym, half] = REGIONS[region]; const sc = (2 * half) / PH;
    const it = new Uint16Array(PW * PH);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const cx = cxm + (x - PW / 2 + 0.5) * sc, cy = cym + (y - PH / 2 + 0.5) * sc;
      let zx = 0, zy = 0, n = 0;
      while (n < maxit) { const x2 = zx * zx, y2 = zy * zy; if (x2 + y2 > 4) break; zy = 2 * zx * zy + cy; zx = x2 - y2 + cx; n++; }
      it[y * PW + x] = n;
    }
    return it;
  }
  function warpDims(n, shape) {
    if (shape === 'row') return [n, 1];
    const t = { 4: [2, 2], 8: [4, 2], 16: [4, 4], 32: [8, 4], 64: [8, 8] }[n];
    return t;
  }
  function efficiency(it, n, shape) {
    const [ww, wh] = warpDims(n, shape); let useful = 0, slots = 0;
    const idle = new Float32Array(PW * PH);
    for (let by = 0; by < PH; by += wh) for (let bx = 0; bx < PW; bx += ww) {
      let mx = 0;
      for (let y = by; y < by + wh; y++) for (let x = bx; x < bx + ww; x++) mx = Math.max(mx, it[y * PW + x] + 1);
      for (let y = by; y < by + wh; y++) for (let x = bx; x < bx + ww; x++) { const v = it[y * PW + x] + 1; useful += v; slots += mx; idle[y * PW + x] = 1 - v / mx; }
    }
    return { eff: useful / slots, idle, ww, wh };
  }
  let pCache = { key: '' };
  function pixels() {
    const region = $('pRegion').value, maxit = +$('pIt').value, n = +$('pWarp').value, shape = $('pShape').value;
    out('pIt', maxit);
    const key = region + ':' + maxit;
    if (pCache.key !== key) pCache = { key, it: mandelIters(region, maxit) };
    const it = pCache.it;
    const res = efficiency(it, n, shape);
    const other = efficiency(it, n, shape === 'row' ? 'tile' : 'row');
    const S = 4;
    // image, cosine palette
    const img = $('pImg').getContext('2d');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const v = it[y * PW + x];
      if (v >= maxit) img.fillStyle = '#000';
      else {
        const t = Math.sqrt(v / maxit);
        const c = (k) => Math.round(255 * (0.5 + 0.5 * Math.cos(6.28318 * (t * 1.0 + k))));
        img.fillStyle = `rgb(${c(0.0)},${c(0.1)},${c(0.2)})`;
      }
      img.fillRect(x * S, y * S, S, S);
    }
    // cost map
    const cm = $('pCost').getContext('2d');
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const f = res.idle[y * PW + x];
      const r = Math.round(19 + f * (229 - 19)), g = Math.round(147 + f * (40 - 147)), b = Math.round(106 + f * (127 - 106));
      cm.fillStyle = `rgb(${r},${g},${b})`; cm.fillRect(x * S, y * S, S, S);
    }
    if ($('pGrid').checked && res.ww * S >= 8) {
      for (const ctx of [img, cm]) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
        for (let x = 0; x <= PW; x += res.ww) { ctx.beginPath(); ctx.moveTo(x * S + 0.5, 0); ctx.lineTo(x * S + 0.5, PH * S); ctx.stroke(); }
        for (let y = 0; y <= PH; y += res.wh) { ctx.beginPath(); ctx.moveTo(0, y * S + 0.5); ctx.lineTo(PW * S, y * S + 0.5); ctx.stroke(); }
      }
    }
    const e = Math.round(res.eff * 100), o = Math.round(other.eff * 100);
    $('pOut').innerHTML = `<p class="verdict ${e > 85 ? 'good' : e > 65 ? 'meh' : 'bad'}">SIMD efficiency ${e}% with ${res.ww} x ${res.wh} warps</p>` +
      `<p>${shape === 'row' ? 'Tiles' : 'Rows'} of the same size would give <b>${o}%</b>. ${res.eff > other.eff ? 'Compact warps win here: pixels close together in 2D tend to need similar iteration counts.' : 'Here the shapes are close; try a detailed view such as Seahorse valley.'} Larger warps always lose some efficiency, because one slow pixel holds up more lanes.</p>` +
      `<p class="small">${PW} x ${PH} pixels, ${PW * PH} threads. Efficiency = iterations actually needed / iterations issued (each warp issues as many as its slowest pixel).</p>`;
  }

  // =========================================================================
  function renderAll() { coalesce(); banks(); diverge(); latency(); occupancy(); pixels(); }
  function init() {
    const saved = (() => { try { return localStorage.getItem('ps-theme'); } catch (e) { return null; } })();
    document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    $('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? 'Light theme' : 'Dark theme';
    $('themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    ['cStride', 'cOff', 'cLine', 'cWarp'].forEach(id => bind(id, coalesce));
    ['bPat', 'bStride', 'bBanks', 'bWarp'].forEach(id => bind(id, banks));
    ['dCond', 'dA', 'dB', 'dMode'].forEach(id => bind(id, diverge));
    ['lW', 'lL', 'lC', 'lI', 'lStall'].forEach(id => bind(id, latency));
    ['oGpu', 'oT', 'oR', 'oS'].forEach(id => bind(id, occupancy));
    ['pRegion', 'pIt', 'pWarp', 'pShape', 'pGrid'].forEach(id => bind(id, pixels));
    document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { const [s, o] = b.dataset.c.split(','); $('cStride').value = s; $('cOff').value = o; coalesce(); });
    document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { const [p, s] = b.dataset.b.split(','); $('bPat').value = p; $('bStride').value = s; banks(); });
    $('oGpu').addEventListener('change', () => { if ($('oGpu').value === 'ws') { $('oT').value = 32; $('oR').value = 16; $('oS').value = 1; } occupancy(); });
    renderAll();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
