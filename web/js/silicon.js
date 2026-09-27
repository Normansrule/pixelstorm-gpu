/* =============================================================================
 * silicon.js — the Pixelstorm GPU as real SkyWater 130 nm silicon
 *   hero()     KLayout render of the die with a hoverable floorplan overlay
 *   dive()     scroll-driven "powers of ten" zoom from the die to transistors
 *   cell3d()   real sky130 standard cells extruded into 3D (three.js)
 *   panzoom()  full-resolution die explorer
 * Data: web/data/silicon.json and cells3d.json, written by tools/silicon/render.py
 * ========================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const UI = window.PSUI; const reduce = UI.reduce;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const NS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- hero
  function hero(S) {
    $('stCells').dataset.ticker = S.cells; $('stTr').dataset.ticker = S.transistors_logic;
    $('stArea').textContent = S.die_mm2.toFixed(2); $('stUtil').textContent = Math.round(S.utilization * 100) + '%';
    const [FW, FH] = S.frame_um; const svg = $('dieOverlay');
    svg.setAttribute('viewBox', `0 0 ${FW} ${FH}`); svg.setAttribute('preserveAspectRatio', 'none');
    const short = (b) => b.name.replace('scheduler + LSU + control', 'control').replace('instruction memory', 'instruction memory').replace('register file', 'registers').replace('shared memory', 'shared mem');
    for (const b of S.blocks) {
      const [x, y, w, h] = b.rect_um; const X = x + 8, Y = FH - (y + 8 + h);
      const r = document.createElementNS(NS, 'rect'); Object.entries({ x: X, y: Y, width: w, height: h }).forEach(([k, v]) => r.setAttribute(k, v));
      const tip = `${b.name}: ${fmt(b.cells)} cells, ${(b.area_um2 / 1e6).toFixed(3)} mm² of cell area (${(100 * b.area_um2 / S.cell_area_um2).toFixed(1)}% of the logic)`;
      r.addEventListener('mouseenter', () => { $('dieTip').textContent = tip; });
      r.addEventListener('mouseleave', () => { $('dieTip').textContent = 'Hover a block. Every one of the 145,800 cells is a real sky130 layout.'; });
      svg.appendChild(r);
      if (h > 120 && w > 150) {
        const t = document.createElementNS(NS, 'text'); t.setAttribute('x', X + w / 2); t.setAttribute('y', Y + h / 2); t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', Math.min(96, w / 4.6)); t.textContent = short(b); svg.appendChild(t);
      }
    }
    $('ovToggle').addEventListener('change', (e) => $('die').classList.toggle('noov', !e.target.checked));
  }

  // ---------------------------------------------------------------- powers of ten
  const DIVE = [
    ['The whole die', 'SkyWater 130 nm silicon: two SMs, their register files, eight ALU lanes and the instruction memory, under an orange power grid on metal 4 and metal 5.'],
    ['600 µm: the ALU lanes', 'SM 0\'s arithmetic lanes. Each lane is roughly 9,000 cells: an adder, a 32-bit multiplier, shifters and comparators.'],
    ['200 µm: rows appear', 'Standard cells line up in rows 2.72 µm tall. The vertical amber bands are power stripes feeding every row.'],
    ['70 µm: individual gates', 'Every rectangle is one cell from the sky130 library. The large red squares are decap cells: small capacitors that steady the supply.'],
    ['24 µm: a few dozen gates', 'Blue metal-1 rails carry power along each row; violet local interconnect wires the transistors inside each cell.'],
    ['9 µm: transistors', 'Wherever red polysilicon crosses green diffusion there is a transistor. This chip has __TR__ of them.'],
  ];
  function dive(S) {
    const Z = S.zooms; const frame = $('diveFrame'); const L = Z.length;
    DIVE[5][1] = DIVE[5][1].replace('__TR__', fmt(S.transistors_logic));
    const imgs = Z.map((z, i) => { const im = new Image(); im.src = z.file; im.alt = DIVE[i][0]; im.decoding = 'async'; frame.appendChild(im); return im; });
    const dots = $('diveDots'); dots.innerHTML = '<b></b>'.repeat(L);
    const [FW, FH] = S.frame_um; const o0 = [S.zoom_center_um[0] / FW, 1 - S.zoom_center_um[1] / FH];
    let target = 0, cur = 0, running = false;
    const measure = () => { const r = $('dive').getBoundingClientRect(); return clamp(-r.top / (r.height - innerHeight), 0, 1) * (L - 1); };
    addEventListener('scroll', () => { target = measure(); if (!running) { running = true; requestAnimationFrame(loop); } }, { passive: true });
    addEventListener('resize', () => draw(cur));
    function loop() { cur = reduce ? target : cur + (target - cur) * 0.12; draw(cur); if (Math.abs(target - cur) > 0.001) requestAnimationFrame(loop); else running = false; }
    function place(im, s, ox, oy, px, py, Wi, Hi, op) {
      im.style.width = Wi + 'px';
      im.style.transformOrigin = '0 0'; im.style.left = '0'; im.style.top = '0';
      im.style.transform = `translate(${px - s * ox * Wi}px, ${py - s * oy * Hi}px) scale(${s})`;
      im.style.opacity = op;
    }
    function draw(p) {
      const W = innerWidth, H = innerHeight; const i = Math.min(L - 2, Math.floor(p)); const f = p - i;
      const asp0 = FW / FH, asp = 1.6;
      const Wi = Math.max(W, H * asp); const Hi = Wi / asp;
      const Wi0 = Wi, Hi0 = Wi0 / asp0;
      const s0 = Math.min(1, (H * 0.86) / Hi0, (W * 0.9) / Wi0);
      const ratio = Z[i].width_um / Z[i + 1].width_um;
      // current level
      let s, ox, oy, Wc, Hc, sStart = 1;
      if (i === 0) { sStart = s0; ox = o0[0]; oy = o0[1]; Wc = Wi0; Hc = Hi0; } else { ox = 0.5; oy = 0.5; Wc = Wi; Hc = Hi; }
      s = sStart * Math.pow(ratio / sStart, f);
      const e = i === 0 ? f : 1;                                      // level 0 slides the zoom point to the centre
      const px = W / 2 + (1 - e) * (ox - 0.5) * Wc * sStart, py = H / 2 + (1 - e) * (oy - 0.5) * Hc * sStart;
      const fade = clamp((f - 0.62) / 0.3, 0, 1);
      imgs.forEach((im, k) => { if (k !== i && k !== i + 1) im.style.opacity = 0; });
      place(imgs[i], s, ox, oy, px, py, Wc, Hc, 1);
      place(imgs[i + 1], s / ratio, 0.5, 0.5, px, py, Wi, Hi, fade);
      const lvl = fade > 0.5 ? i + 1 : i;
      $('diveTitle').textContent = DIVE[lvl][0]; $('diveText').textContent = DIVE[lvl][1];
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k <= lvl));
      // scale bar: pick a round length about 120 px long
      const umPerPx = lvl === i ? Z[i].width_um / (Wc * s) : Z[i + 1].width_um / (Wi * s / ratio);
      const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
      const len = nice.find(n => n / umPerPx > 70) || 1000;
      $('scaleBar').style.width = (len / umPerPx) + 'px'; $('scaleTxt').textContent = len >= 1000 ? `${len / 1000} mm` : `${len} µm`;
    }
    Promise.all(imgs.map(im => im.decode ? im.decode().catch(() => {}) : 0)).then(() => draw(measure()));
    draw(0);
  }

  // ---------------------------------------------------------------- 3D standard cell
  function cell3d(S, CELLS) {
    const cv = $('cellGl'); if (!window.THREE) return;
    let renderer; try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
    scene.add(new THREE.HemisphereLight(0xBBD0FF, 0x10131A, 0.9));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(4, 8, 6); scene.add(dl);
    const colors = {}; S.layers.forEach(l => { colors[l.key] = l.color; });
    const ORDER = ['nwell', 'diff', 'tap', 'poly', 'licon', 'li1', 'mcon', 'met1', 'via'];
    const NAMES = { nwell: 'n-well', diff: 'diffusion', tap: 'taps', poly: 'polysilicon (gates)', licon: 'contacts', li1: 'local interconnect', mcon: 'li1 to metal-1 contacts', met1: 'metal 1 (power rails)', via: 'via 1' };
    const OPAC = { nwell: 0.22, li1: 0.8, met1: 0.72 };
    const visible = {}; ORDER.forEach(k => { visible[k] = true; });
    let group = null, name = 'nand2_1';
    const seg = $('cellPick');
    Object.keys(CELLS).forEach((k) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.k = k; b.textContent = k.replace('_1', '').toUpperCase(); b.setAttribute('role', 'radio'); b.onclick = () => { name = k; build(); }; seg.appendChild(b); });
    const list = $('layerList');
    ORDER.forEach(k => { const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" checked data-k="${k}"><i style="background:${colors[k] || '#888'}"></i>${NAMES[k]}`; list.appendChild(l); });
    list.addEventListener('change', (e) => { visible[e.target.dataset.k] = e.target.checked; build(); });
    $('explode').addEventListener('input', build); $('zscale').addEventListener('input', build);
    function build() {
      if (group) { scene.remove(group); group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
      const C = CELLS[name]; group = new THREE.Group();
      const ex = +$('explode').value / 100 * 1.6, zs = +$('zscale').value;
      ORDER.forEach((k, li) => {
        const L = C.layers[k]; if (!L || !visible[k]) return;
        const [z0, z1] = L.z; const depth = Math.max(0.01, (z1 - z0) * zs * 0.25);
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors[k] || '#888'), roughness: 0.45, metalness: k.startsWith('met') ? 0.55 : 0.15, transparent: k in OPAC, opacity: OPAC[k] || 1, depthWrite: !(k in OPAC) });
        const shapes = L.polys.map(pts => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x - C.w / 2, y - C.h / 2))));
        const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
        const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = z0 * zs * 0.25 + li * ex * 0.35;
        group.add(m);
      });
      scene.add(group);
      seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.k === name); b.setAttribute('aria-checked', String(b.dataset.k === name)); });
      $('cellBadge').innerHTML = `<b>sky130_fd_sc_hd__${name}</b>${C.desc}<br>${C.transistors} transistors, ${C.w.toFixed(2)} x ${C.h.toFixed(2)} µm`;
      dist = Math.max(C.w, C.h) * 1.9;
    }
    let theta = 0.7, phi = 1.0, dist = 8, drag = false, lx = 0, ly = 0, idle = 0;
    cv.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; theta -= (e.clientX - lx) * 0.008; phi = clamp(phi - (e.clientY - ly) * 0.006, 0.15, 1.5); lx = e.clientX; ly = e.clientY; idle = performance.now(); });
    cv.addEventListener('pointerup', () => { drag = false; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); dist = clamp(dist * (1 + e.deltaY * 0.001), 2, 60); }, { passive: false });
    let on = false; new IntersectionObserver(es => { on = es[0].isIntersecting; if (on) requestAnimationFrame(tick); }).observe(cv);
    function tick(now) {
      if (!on) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      if (!drag && !reduce && now - idle > 3000) theta += 0.004;
      camera.position.set(dist * Math.sin(phi) * Math.sin(theta), dist * Math.cos(phi) + 0.5, dist * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(0, 0.4, 0);
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    build();
    window.PSSIL = Object.assign(window.PSSIL || {}, { pick: (k) => { name = k; build(); }, cam: (t, p, d) => { theta = t; phi = p; dist = d; idle = performance.now(); } });
  }

  // ---------------------------------------------------------------- gallery
  function gallery(CELLS) {
    const g = $('cellGrid');
    Object.entries(CELLS).forEach(([k, c], i) => {
      g.insertAdjacentHTML('beforeend', `<figure class="spotlight" data-reveal="${i * 60}"><img src="img/cell-${k}.png" alt="sky130 ${k} layout" loading="lazy"><figcaption><b>${k.replace('_1', '').toUpperCase()}: ${c.transistors} transistors</b><span>${c.desc}</span></figcaption></figure>`);
    });
  }

  // ---------------------------------------------------------------- pan / zoom
  function panzoom() {
    const box = $('pz'), img = $('pzImg'); let s = 1, tx = 0, ty = 0, fit = 1, drag = false, lx = 0, ly = 0;
    const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };
    const reset = () => { const W = box.clientWidth, H = box.clientHeight; fit = Math.min(W / img.naturalWidth, H / img.naturalHeight); s = fit; tx = (W - img.naturalWidth * s) / 2; ty = (H - img.naturalHeight * s) / 2; apply(); };
    const limit = () => { const W = box.clientWidth, H = box.clientHeight, iw = img.naturalWidth * s, ih = img.naturalHeight * s; tx = iw < W ? (W - iw) / 2 : clamp(tx, W - iw, 0); ty = ih < H ? (H - ih) / 2 : clamp(ty, H - ih, 0); };
    img.addEventListener('load', reset); if (img.complete) reset(); addEventListener('resize', reset);
    box.addEventListener('wheel', (e) => { e.preventDefault(); const r = box.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const ns = clamp(s * Math.exp(-e.deltaY * 0.0015), fit, 1.6); tx = mx - (mx - tx) * ns / s; ty = my - (my - ty) * ns / s; s = ns; limit(); apply(); }, { passive: false });
    box.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; box.classList.add('drag'); box.setPointerCapture(e.pointerId); });
    box.addEventListener('pointermove', (e) => { if (!drag) return; tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY; limit(); apply(); });
    box.addEventListener('pointerup', () => { drag = false; box.classList.remove('drag'); });
    box.addEventListener('dblclick', reset);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    let S = null, CELLS = {};
    try { S = await (await fetch('data/silicon.json')).json(); CELLS = await (await fetch('data/cells3d.json')).json(); }
    catch (e) { console.warn('run make silicon to generate web/data/silicon.json'); return; }
    hero(S); gallery(CELLS);
    UI.init();
    dive(S); cell3d(S, CELLS); panzoom();
  });
})();
