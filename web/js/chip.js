/* =============================================================================
 * chip.js — the Pixelstorm GPU in 3D, replaying a real RTL trace
 *
 * The die is modelled block by block after rtl/ps_gpu_top.v: two SMs (each
 * with warp scheduler, fetch, decode, register file, 8 lanes, load/store unit,
 * writeback and 8 shared-memory banks), the block dispatcher, the memory
 * arbiter, instruction and constant memory, four DRAM chips on the package,
 * and the framebuffer floating above the chip. Every frame the trace is
 * replayed to the current cycle (replay.js, the same engine as the 2D
 * visualizer) and the model is lit accordingly.
 *
 * Inspired by bbycroft/llm-viz (a model you can fly through) and Bruno
 * Simon's folio (a scene you can play with). three.js r147 + UnrealBloom.
 * ========================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const W = window.PIXELSTORM, RP = window.PSREPLAY, UI = window.PSUI, G = window.gsap;
  const reduce = UI.reduce;
  const REPO = 'https://github.com/Normansrule/pixelstorm-gpu/blob/main/';
  const COL = { blue: 0x5B84FF, green: 0x2DD4A0, amber: 0xFFB938, magenta: 0xFF4D8D, violet: 0xA07DF0, cyan: 0x38D6FF, slate: 0x6B7A90, white: 0xffffff };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const bit = (m, i) => (m >>> i) & 1;

  // ---------------------------------------------------------------------------
  // renderer, scene, lights, bloom
  // ---------------------------------------------------------------------------
  const cv = $('gl');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { $('noWebgl').hidden = false; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05070B, 110, 260);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
  scene.add(new THREE.HemisphereLight(0x9DB8FF, 0x0A0C12, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(30, 70, 35); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -60, right: 60, top: 50, bottom: -50, near: 1, far: 200 });
  key.shadow.bias = -0.0005; scene.add(key);
  const rim = new THREE.DirectionalLight(0x7A5CFF, 0.55); rim.position.set(-50, 25, -50); scene.add(rim);
  let composer = null, bloom = null;
  if (THREE.EffectComposer && THREE.UnrealBloomPass) {
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.45, 0.62);
    composer.addPass(bloom);
  }

  // ---------------------------------------------------------------------------
  // building blocks
  // ---------------------------------------------------------------------------
  const pickables = []; const labels = []; const glowers = [];
  function mat(color, o = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.5, metalness: o.metal ?? 0.35, emissive: 0x000000, transparent: !!o.opacity, opacity: o.opacity ?? 1, map: o.map || null });
  }
  function box(w, h, d, color, o) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o)); m.castShadow = true; m.receiveShadow = true; return m; }
  function put(m, x, y, z, parent) { m.position.set(x, y, z); (parent || scene).add(m); return m; }
  function glow(m, color) { m.userData.glowColor = new THREE.Color(color); m.userData.glow = 0; m.userData.glowT = 0; glowers.push(m); return m; }
  function pick(m, id) { m.userData.id = id; pickables.push(m); return m; }
  function label(obj, text, dy = 1.4) { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; $('labels').appendChild(el); labels.push({ obj, el, dy }); }
  function dieTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
    x.fillStyle = '#161C2A'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${90 + Math.random() * 60},${110 + Math.random() * 60},${170 + Math.random() * 60},${Math.random() * 0.06})`; x.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 30, 1 + Math.random() * 3); }
    x.strokeStyle = 'rgba(120,150,210,.08)'; for (let i = 0; i <= 512; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.moveTo(0, i); x.lineTo(512, i); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); return t;
  }

  // ---------------------------------------------------------------------------
  // the model
  // ---------------------------------------------------------------------------
  const grid = new THREE.GridHelper(300, 60, 0x1D2A44, 0x111A2A); grid.material.transparent = true; grid.material.opacity = 0.45; scene.add(grid);
  const substrate = put(box(78, 1.2, 52, 0x0E2A24, { rough: 0.85, metal: 0.1 }), 0, 0.6, 0);
  pick(substrate, 'package');
  for (let i = 0; i < 26; i++) for (const z of [-25.2, 25.2]) put(box(1.2, 0.12, 0.6, 0xC9A445, { metal: 0.9, rough: 0.3 }), -36 + i * 2.9, 1.26, z);
  const die = put(box(44, 0.8, 32, 0x1A2130, { metal: 0.6, rough: 0.32, map: dieTexture() }), 0, 1.6, 0);
  pick(die, 'die');
  const TOP = 2.0;

  const SM = [];
  for (let s = 0; s < 2; s++) {
    const g = new THREE.Group(); g.position.set(s ? 11 : -11, TOP, 0); scene.add(g);
    const base = put(box(18, 0.25, 28, 0x1B2436, { metal: 0.5, rough: 0.4 }), 0, 0.125, 0, g); pick(base, `sm${s}`);
    const sched = glow(put(box(15, 0.6, 3.4, 0x243149), 0, 0.55, -11.2, g), COL.blue); pick(sched, `sched${s}`);
    const warps = [];
    for (let w = 0; w < 4; w++) { const m = glow(put(box(3.1, 0.28, 2.4, 0x2C3A58), -5.1 + w * 3.4, 0.99, -11.2, g), COL.green); pick(m, `sched${s}`); warps.push(m); }
    const fetch = glow(put(box(6.6, 0.5, 2.8, 0x22304A), -3.9, 0.5, -7.2, g), COL.blue); pick(fetch, `fetch${s}`);
    const decode = glow(put(box(6.6, 0.5, 2.8, 0x22304A), 3.9, 0.5, -7.2, g), COL.blue); pick(decode, `decode${s}`);
    const rf = glow(put(box(15, 0.9, 3.0, 0x2A2F55), 0, 0.7, -3.2, g), COL.violet); pick(rf, `rf${s}`);
    const lanes = [];
    for (let l = 0; l < 8; l++) {
      const m = glow(put(box(1.4, 1, 3.6, 0x1E3A34, { metal: 0.3 }), -6.3 + l * 1.8, 0.75, 1.6, g), COL.green); pick(m, `lanes${s}`);
      m.userData.h = 0.5; m.userData.hT = 0.5; lanes.push(m);
    }
    const lsu = glow(put(box(8, 0.8, 3.0, 0x3A2F1A), -3.4, 0.65, 6.6, g), COL.amber); pick(lsu, `lsu${s}`);
    const wb = glow(put(box(6, 0.6, 3.0, 0x22304A), 4.4, 0.55, 6.6, g), COL.blue); pick(wb, `wb${s}`);
    const banks = [];
    for (let b = 0; b < 8; b++) { const m = glow(put(box(1.5, 0.5, 2.0, 0x33291A), -6.3 + b * 1.8, 0.5, 10.6, g), COL.amber); pick(m, `smem${s}`); banks.push(m); }
    SM.push({ g, base, sched, warps, fetch, decode, rf, lanes, lsu, wb, banks });
  }
  const disp = pick(glow(put(box(3.4, 1.0, 8, 0x223355), 0, TOP + 0.5, -8), COL.blue), 'disp');
  const arb = pick(glow(put(box(3.4, 1.0, 8, 0x3A2D14), 0, TOP + 0.5, 8), COL.amber), 'arb');
  const imem = pick(glow(put(box(26, 0.45, 1.6, 0x1F2A40), -2, TOP + 0.22, -15), COL.blue), 'imem');
  const cmem = pick(put(box(8, 0.45, 1.6, 0x1F2A40), 16, TOP + 0.22, -15), 'cmem');
  const DRAM = [];
  const dpos = [[-30, -11], [-30, 11], [30, -11], [30, 11]];
  for (const [x, z] of dpos) { const m = pick(glow(put(box(10, 1.5, 7, 0x0F1218, { metal: 0.55, rough: 0.35 }), x, 1.95, z), COL.amber), 'dram'); DRAM.push(m); }
  // package traces arbiter -> DRAM
  const traces = [];
  for (const [x, z] of dpos) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 2.1, 12.2), new THREE.Vector3(Math.sign(x) * 8, 1.28, 18), new THREE.Vector3(Math.sign(x) * 22, 1.28, z * 1.4 + 2), new THREE.Vector3(x - Math.sign(x) * 5, 1.4, z)]);
    const tm = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.18, 6, false), new THREE.MeshBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.18 }));
    scene.add(tm); traces.push({ curve, mesh: tm });
  }
  // framebuffer screen
  const fbCanvas = document.createElement('canvas'); fbCanvas.width = 256; fbCanvas.height = 128;
  const fbTex = new THREE.CanvasTexture(fbCanvas); fbTex.magFilter = THREE.NearestFilter; fbTex.minFilter = THREE.LinearFilter;
  const screen = new THREE.Group(); screen.position.set(0, 18, -30); screen.rotation.x = -0.1; scene.add(screen);
  const bezel = put(box(32.6, 16.6, 0.7, 0x0B0F16, { metal: 0.6, rough: 0.3 }), 0, 0, -0.4, screen);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(32, 16), new THREE.MeshBasicMaterial({ map: fbTex, toneMapped: false }));
  put(panel, 0, 0, 0.01, screen); pick(panel, 'screen'); pick(bezel, 'screen');
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(32.6, 16.6, 0.7)), new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.5 }));
  edges.position.z = -0.4; screen.add(edges);
  for (const x of [-12, 12]) put(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 12, 8), mat(0x2A3346, { metal: 0.8 })), x, -13.5, -1.2, screen);
  // memory request particles
  const particles = [];
  for (let i = 0; i < 16; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color: COL.amber })); p.visible = false; scene.add(p); particles.push(p); }

  label(SM[0].base, 'SM 0', 2.2); label(SM[1].base, 'SM 1', 2.2);
  label(SM[0].sched, 'Warp scheduler'); label(SM[0].lanes[3], '8 lanes', 3.2); label(SM[0].lsu, 'Load/store unit');
  label(SM[0].banks[2], 'Shared memory', 1.6); label(disp, 'Dispatcher'); label(arb, 'Memory arbiter'); label(DRAM[3], 'DRAM', 2.2); label(imem, 'Instruction memory');
  label(screen, 'Framebuffer', 10.2);

  // ---------------------------------------------------------------------------
  // what each block is (info panel)
  // ---------------------------------------------------------------------------
  const INFO = {
    package: { kind: 'Package', title: 'Package substrate', body: 'The green board the die sits on. It carries power in and signals out, and routes the memory traces from the chip to the DRAM chips beside it, just as on a real graphics card or an H100 module.', rtl: 'sim/tb_gpu.v', doc: 'docs/13-real-world-gpus.md' },
    die: { kind: 'Silicon', title: 'The Pixelstorm die', body: 'Everything inside rtl/ps_gpu_top.v: two Streaming Multiprocessors, the block dispatcher, the memory arbiter, instruction memory and the constant bank. Real GPUs tile the SM 100 or more times.', rtl: 'rtl/ps_gpu_top.v', doc: 'docs/04-microarchitecture.md' },
    sm: { kind: 'Streaming Multiprocessor', title: 'SM', body: 'The GPU\'s core. It holds one thread block at a time as 4 warps of 8 threads, and steps one warp instruction at a time through schedule, fetch, decode, execute, memory and writeback.', rtl: 'rtl/ps_sm.v', doc: 'docs/04-microarchitecture.md' },
    sched: { kind: 'Control', title: 'Warp scheduler', body: 'Picks the next warp, round robin, skipping warps parked at a barrier. For the chosen warp it finds the lowest PC among live lanes: lanes at that PC are active, the rest wait. That one comparison is how divergent warps reconverge. The four tiles are the four warps.', rtl: 'rtl/ps_sm.v', doc: 'docs/07-divergence.md' },
    fetch: { kind: 'Front end', title: 'Fetch', body: 'Reads one 32-bit instruction from instruction memory at the warp\'s PC. One fetch serves all 8 lanes: that sharing is SIMT (Single Instruction, Multiple Threads).', rtl: 'rtl/ps_sm.v', doc: 'docs/05-instruction-lifecycle.md' },
    decode: { kind: 'Front end', title: 'Decode', body: 'Splits the word into opcode, registers and immediate (rtl/ps_decoder.v) and evaluates each lane\'s guard predicate, turning the active mask into the execution mask.', rtl: 'rtl/ps_decoder.v', doc: 'docs/03-isa.md' },
    rf: { kind: 'Storage', title: 'Register file', body: '16 registers of 32 bits for each of the 32 resident threads, plus 4 predicate bits each: 2 KB per SM. An H100 SM has 256 KB, so it can keep far more warps in flight to hide memory latency.', rtl: 'rtl/ps_sm.v', doc: 'docs/06-reading-the-rtl.md' },
    lanes: { kind: 'Execution', title: '8 lanes', body: 'Eight copies of rtl/ps_alu.v, one per thread of the warp. Green and tall: executing. Magenta: waiting at another PC after a divergent branch. Grey: exited or guard false. Amber: waiting on memory.', rtl: 'rtl/ps_alu.v', doc: 'docs/02-simt-warps-blocks.md' },
    lsu: { kind: 'Memory', title: 'Load/store unit', body: 'Groups the lanes\' addresses into as few 4-word line requests as possible (coalescing) and sends them to the arbiter, or resolves shared-memory bank conflicts pass by pass.', rtl: 'rtl/ps_sm.v', doc: 'docs/08-memory.md' },
    wb: { kind: 'Back end', title: 'Writeback', body: 'Writes results to registers and predicates, advances every active lane\'s private PC, and parks the warp if it just executed a barrier.', rtl: 'rtl/ps_sm.v', doc: 'docs/05-instruction-lifecycle.md' },
    smem: { kind: 'Memory', title: 'Shared memory, 8 banks', body: '256 words per SM, sliced into 8 banks by address. Each bank serves one word per cycle, so lanes that hit the same bank at different words must take turns: a bank conflict.', rtl: 'rtl/ps_sm.v', doc: 'docs/08-memory.md' },
    disp: { kind: 'Control', title: 'Block dispatcher', body: 'Hands thread blocks to whichever SM is idle, one per cycle. With one block per row of pixels, this is what spreads an image across the two SMs.', rtl: 'rtl/ps_dispatcher.v', doc: 'docs/02-simt-warps-blocks.md' },
    arb: { kind: 'Memory', title: 'Memory arbiter', body: 'One DRAM port shared by both SMs, round robin, one request in flight. When both SMs want memory, one waits. Real GPUs have many channels and dozens of requests outstanding.', rtl: 'rtl/ps_mem_arbiter.v', doc: 'docs/05-instruction-lifecycle.md' },
    imem: { kind: 'Storage', title: 'Instruction memory', body: '1,024 instructions of 32 bits, written by the host before launch. Every SM fetches from it.', rtl: 'rtl/ps_gpu_top.v', doc: 'docs/03-isa.md' },
    cmem: { kind: 'Storage', title: 'Constant bank', body: '16 words of kernel arguments (the .param values), read with LDC. In CUDA these are the parameters of the __global__ function.', rtl: 'rtl/ps_gpu_top.v', doc: 'docs/03-isa.md' },
    dram: { kind: 'Off chip', title: 'DRAM (global memory)', body: 'The large, slow memory: 64K words here, served as 4-word lines after a fixed latency. Amber particles are read requests travelling from an SM\'s load/store unit to DRAM and back; cyan ones are writes.', rtl: 'sim/tb_gpu.v', doc: 'docs/08-memory.md' },
    screen: { kind: 'Output', title: 'Framebuffer', body: 'A region of global memory shown as an image: one 0x00RRGGBB word per pixel. It paints as warps store their pixels. Kernels without a framebuffer show their output memory as a heat map instead.', rtl: 'kernels/15_mandelbrot.psa', doc: 'docs/11-graphics.md' },
  };
  function infoFor(id) { const m = /^(\D+)(\d?)$/.exec(id); const base = INFO[m[1]]; return Object.assign({ key: m[1], sm: m[2] === '' ? null : +m[2] }, base); }

  // ---------------------------------------------------------------------------
  // simulation state
  // ---------------------------------------------------------------------------
  let R = null, T = 0, Tf = 0, playing = !reduce, speed = 250, holdUntil = 0, selected = null, sparkBase = null;
  let index = [];
  async function init() {
    try { index = await (await fetch('traces/index.json')).json(); } catch (e) { index = []; }
    const names = index.length ? index.map(e => e.name) : (window.PS_EXAMPLES || []).map(ex => (/^\.kernel\s+(\S+)/m.exec(ex.src) || [])[1]).filter(Boolean);
    const sel = $('kSel');
    names.forEach((n, i) => { const o = document.createElement('option'); o.value = n; o.textContent = `${String(i + 1).padStart(2, '0')}  ${n.replace(/_/g, ' ')}`; sel.appendChild(o); });
    const want = (/[?&]k=(\w+)/.exec(location.search) || [])[1] || 'mandelbrot';
    sel.value = names.includes(want) ? want : names[0];
    sel.onchange = () => load(sel.value);
    await load(sel.value);
  }
  async function load(name) {
    let trace = null;
    const ent = index.find(e => e.name === name);
    if (ent) { try { trace = await (await fetch('traces/' + ent.file)).json(); } catch (e) { trace = null; } }
    if (!trace) {
      const ex = (window.PS_EXAMPLES || []).find(x => new RegExp(`^\\.kernel\\s+${name}\\b`, 'm').test(x.src));
      if (!ex) return;
      trace = W.buildTrace(ex.src);
    }
    R = new RP.Replay(trace); T = 0; Tf = 0; holdUntil = 0;
    const fb = R.meta.fb;
    if (fb) { fbCanvas.width = fb.width * 8; fbCanvas.height = fb.height * 8; panel.scale.set(1, 1, 1); const asp = fb.width / fb.height; panel.scale.set(asp >= 2 ? 1 : asp / 2, 1, 1); }
    else { fbCanvas.width = 256; fbCanvas.height = 128; panel.scale.set(1, 1, 1); }
    fbTex.dispose(); fbTex.needsUpdate = true;
    $('cycMax').textContent = `/ ${R.end.toLocaleString('en-US')}`; $('scrub').max = R.end;
    $('tPxL').textContent = fb ? 'pixels painted' : 'words written';
    buildSpark();
    const smc = $('smCards'); smc.innerHTML = '';
    for (let s = 0; s < R.meta.numSms; s++) {
      smc.insertAdjacentHTML('beforeend', `<div class="smc"><div class="top"><span>SM ${s}</span><span id="smb${s}"></span></div><div class="asm" id="sma${s}">idle</div><div class="pills">${'<i></i>'.repeat(6)}</div></div>`);
    }
    if (selected) showInfo(selected);
  }

  // sparkline: warp instructions per 100 cycles, over the whole run
  function buildSpark() {
    const B = 100; const n = Math.ceil((R.end + 1) / B); const bins = new Array(n).fill(0);
    for (const c of R.commits) bins[Math.floor(c.t / B)]++;
    const mx = Math.max(1, ...bins);
    const c = document.createElement('canvas'); c.width = 560; c.height = 110; const x = c.getContext('2d');
    const grad = x.createLinearGradient(0, 0, 0, 110); grad.addColorStop(0, 'rgba(56,214,255,.45)'); grad.addColorStop(1, 'rgba(56,214,255,0)');
    x.beginPath(); x.moveTo(0, 110);
    bins.forEach((v, i) => x.lineTo(i / (n - 1 || 1) * 560, 106 - v / mx * 96));
    x.lineTo(560, 110); x.closePath(); x.fillStyle = grad; x.fill();
    x.beginPath(); bins.forEach((v, i) => { const px = i / (n - 1 || 1) * 560, py = 106 - v / mx * 96; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.strokeStyle = '#38D6FF'; x.lineWidth = 2.5; x.stroke();
    for (const b of R.bars) { x.fillStyle = 'rgba(255,77,141,.5)'; x.fillRect(b.t / R.end * 560, 0, 1.5, 110); }
    sparkBase = c;
  }
  function drawSpark() {
    const c = $('spark'); const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
    if (sparkBase) x.drawImage(sparkBase, 0, 0);
    const px = R ? T / R.end * c.width : 0; x.fillStyle = '#fff'; x.fillRect(px - 1, 0, 2, c.height);
  }

  // ---------------------------------------------------------------------------
  // per-frame: light the model from the replayed state
  // ---------------------------------------------------------------------------
  const STAGE_GLOW = [['sched'], ['fetch'], ['decode'], ['rf', 'lanes'], ['lsu'], ['wb', 'rf']];
  function update() {
    if (!R) return;
    R.seek(T);
    const m = R.meta, WS = m.warpSize;
    for (const g of glowers) g.userData.glowT = 0;
    for (let s = 0; s < Math.min(2, m.numSms); s++) {
      const S = SM[s]; const sm = R.sms[s]; const c = R.inflight(s, T); const st = c ? RP.stageOf(c, T) : -1; const d = c ? c.d : null;
      if (st >= 0) for (const k of STAGE_GLOW[st]) if (S[k] && S[k].userData) S[k].userData.glowT = k === 'rf' ? 0.5 : 1.2;
      if (st === 4) S.lsu.userData.glowT = 1.4;
      // warps
      for (let w = 0; w < 4; w++) {
        const valid = sm.busy && w * WS < m.block; let live = 0;
        for (let l = 0; l < WS; l++) if (!sm.ldone[w * WS + l]) live++;
        const t = S.warps[w];
        if (!valid || !live) { t.userData.glowT = 0; t.material.color.setHex(0x1C2436); continue; }
        t.material.color.setHex(0x2C3A58);
        if (c && c.w === w) { t.userData.glowColor.setHex(COL.cyan); t.userData.glowT = 1.6; }
        else if (sm.wait[w]) { t.userData.glowColor.setHex(COL.magenta); t.userData.glowT = 0.9; }
        else { t.userData.glowColor.setHex(COL.green); t.userData.glowT = 0.35; }
      }
      // lanes
      for (let l = 0; l < 8; l++) {
        const L = S.lanes[l]; let h = 0.35, col = COL.slate, gl = 0;
        if (c) {
          const tid = c.w * WS + l; const act = bit(c.act, l), exe = bit(c.exe, l);
          if (tid >= m.block) { h = 0.25; }
          else if (sm.ldone[tid] && !act) { h = 0.3; }
          else if (!act) { h = 0.7; col = COL.magenta; gl = 0.8; }
          else if (st <= 1) { h = 0.9; col = COL.blue; gl = 0.5; }
          else if (!exe) { h = 0.5; col = COL.slate; gl = 0.25; }
          else if (st === 4) { h = 1.8; col = COL.amber; gl = 1.2; }
          else if (st === 3 || st === 5) { h = 2.9; col = COL.green; gl = 1.6; }
          else { h = 1.2; col = COL.blue; gl = 0.6; }
        }
        L.userData.hT = h; L.userData.glowColor.setHex(col); L.userData.glowT = gl;
      }
      // shared-memory banks during a shared access
      if (c && st === 4 && d.isShared) {
        const plan = RP.memPlan(c, m); const k = Math.min(T - c.st[4], plan.n - 1); const inf = plan.info[k];
        if (inf) for (const l of inf.lanes) { const b = S.banks[c.addr[l] & (m.smemBanks - 1)]; b.userData.glowColor.setHex(plan.n > 1 ? COL.magenta : COL.amber); b.userData.glowT = 1.5; }
      }
      // HUD card
      const card = $(`sma${s}`);
      if (card) {
        card.textContent = c ? W.disasm(c.ir) : (sm.busy ? 'between instructions' : 'idle');
        $(`smb${s}`).textContent = sm.busy ? `block ${sm.blk}${c ? ', warp ' + c.w : ''}` : '';
        const pills = card.nextElementSibling.children;
        for (let i = 0; i < 6; i++) pills[i].className = i === st ? ('on' + (i === 3 ? ' x' : i === 4 ? ' m' : '')) : '';
      }
    }
    // dispatcher pulses when a block starts
    if (R.blks.some(b => b.ph === 'start' && Math.abs(b.t - T) < 12)) disp.userData.glowT = 1.5;
    imem.userData.glowT = (R.inflight(0, T) && RP.stageOf(R.inflight(0, T), T) === 1) || (R.inflight(1, T) && RP.stageOf(R.inflight(1, T), T) === 1) ? 0.8 : 0;
    // memory requests in flight
    particles.forEach(p => { p.visible = false; });
    traces.forEach(t => { t.mesh.material.opacity = 0.14; });
    let pi = 0; const lat = m.lat + 1;
    const lo = lowerBound(R.mreqs, Tf - lat - 1);
    for (let i = lo; i < R.mreqs.length && R.mreqs[i].t <= Tf && pi < particles.length; i++) {
      const q = R.mreqs[i]; const f = (Tf - q.t) / lat; if (f < 0 || f > 1) continue;
      const k = (q.a >> 2) & 3; const trc = traces[k];
      arb.userData.glowT = 1.4; DRAM[k].userData.glowT = f > 0.3 && f < 0.85 ? 1.2 : 0.4; trc.mesh.material.opacity = 0.55;
      const lsuPos = new THREE.Vector3(); SM[q.sm].lsu.getWorldPosition(lsuPos); lsuPos.y += 0.8;
      const arbPos = new THREE.Vector3(0, TOP + 1.2, 8);
      const p = particles[pi++]; p.visible = true; p.material.color.setHex(q.op === 1 ? COL.cyan : q.op === 2 ? COL.magenta : COL.amber);
      let pos;
      if (f < 0.12) pos = lsuPos.clone().lerp(arbPos, f / 0.12);
      else if (f < 0.35) pos = trc.curve.getPoint((f - 0.12) / 0.23);
      else if (f < 0.7) { pos = trc.curve.getPoint(1); pos.y += 1.2 + 0.4 * Math.sin(f * 40); }
      else if (q.op === 1) { p.visible = false; continue; }
      else if (f < 0.9) pos = trc.curve.getPoint(1 - (f - 0.7) / 0.2);
      else pos = arbPos.clone().lerp(lsuPos, (f - 0.9) / 0.1);
      p.position.copy(pos);
    }
    // framebuffer / memory heat map
    drawScreen();
    // telemetry
    $('cyc').textContent = Math.floor(T).toLocaleString('en-US');
    $('scrub').value = Math.floor(T);
    const stt = R.stats;
    $('tIpc').textContent = T ? (stt.instr / T).toFixed(3) : '0';
    $('tEff').textContent = stt.slots ? Math.round(100 * stt.laneOps / stt.slots) + '%' : '0%';
    $('tMem').textContent = upperBound(R.mreqs, T).toLocaleString('en-US');
    drawSpark();
  }
  const lowerBound = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].t < t) lo = mid + 1; else hi = mid; } return lo; };
  const upperBound = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].t <= t) lo = mid + 1; else hi = mid; } return lo; };
  let lastScreenT = -1;
  function drawScreen() {
    if (Math.floor(T) === lastScreenT) return; lastScreenT = Math.floor(T);
    const x = fbCanvas.getContext('2d'); const fb = R.meta.fb;
    if (fb) {
      const S = fbCanvas.width / fb.width; let n = 0;
      for (let i = 0; i < fb.width * fb.height; i++) {
        const a = fb.addr + i; const t = R.gTouch.get(a); const px = (i % fb.width) * S, py = Math.floor(i / fb.width) * S;
        if (t === undefined) { x.fillStyle = (((i % fb.width) + Math.floor(i / fb.width)) & 1) ? '#101723' : '#0B1119'; x.fillRect(px, py, S, S); continue; }
        n++; x.fillStyle = '#' + (R.gmem.get(a) & 0xffffff).toString(16).padStart(6, '0'); x.fillRect(px, py, S, S);
        if (T - t < 25) { x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(px, py, S, S); }
      }
      $('tPx').textContent = n.toLocaleString('en-US');
    } else {
      const regs = R.meta.dump || []; x.fillStyle = '#0A0F16'; x.fillRect(0, 0, fbCanvas.width, fbCanvas.height);
      let n = 0; const cells = []; for (const r of regs) for (let i = 0; i < r.count; i++) cells.push(r.addr + i);
      const cols = 16, rows = Math.max(1, Math.ceil(cells.length / cols)); const cw = fbCanvas.width / cols, ch = fbCanvas.height / rows;
      let mx = 1; for (const a of cells) mx = Math.max(mx, Math.abs((R.gmem.get(a) || 0) | 0));
      cells.forEach((a, i) => {
        const t = R.gTouch.get(a); const v = Math.abs((R.gmem.get(a) || 0) | 0) / mx;
        if (t !== undefined) n++;
        x.fillStyle = t === undefined ? `rgba(91,132,255,${0.08 + 0.3 * v})` : `hsl(${190 - 150 * v}, 90%, ${35 + 30 * v}%)`;
        x.fillRect((i % cols) * cw + 1, Math.floor(i / cols) * ch + 1, cw - 2, ch - 2);
        if (t !== undefined && T - t < 25) { x.fillStyle = 'rgba(255,255,255,.6)'; x.fillRect((i % cols) * cw + 1, Math.floor(i / cols) * ch + 1, cw - 2, ch - 2); }
      });
      $('tPx').textContent = n.toLocaleString('en-US');
    }
    fbTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // camera: orbit, zoom, fly-to presets
  // ---------------------------------------------------------------------------
  const cam = { theta: -0.6, phi: 0.98, r: 100, tx: 0, ty: 5, tz: -4 };
  const PRESETS = {
    overview: { theta: -0.6, phi: 0.98, r: 100, tx: 0, ty: 5, tz: -4 },
    sm0: { theta: -0.35, phi: 0.72, r: 42, tx: -11, ty: 2, tz: 0 },
    sm1: { theta: 0.4, phi: 0.72, r: 42, tx: 11, ty: 2, tz: 0 },
    memory: { theta: 0.15, phi: 0.95, r: 70, tx: 0, ty: 2, tz: 8 },
    screen: { theta: 0.0, phi: 1.32, r: 46, tx: 0, ty: 16, tz: -30 },
  };
  function applyCam() {
    const sp = Math.sin(cam.phi);
    camera.position.set(cam.tx + cam.r * sp * Math.sin(cam.theta), cam.ty + cam.r * Math.cos(cam.phi), cam.tz + cam.r * sp * Math.cos(cam.theta));
    camera.lookAt(cam.tx, cam.ty, cam.tz);
  }
  function flyTo(name) {
    const p = PRESETS[name]; if (!p) return;
    let dt = p.theta - cam.theta; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
    const to = Object.assign({}, p, { theta: cam.theta + dt });
    if (G && !reduce) G.to(cam, Object.assign({ duration: 1.5, ease: 'power3.inOut' }, to)); else Object.assign(cam, to);
    document.querySelectorAll('.cambar [data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === name));
    lastInput = performance.now();
  }
  let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInput = 0; const pointers = new Map(); let pinch0 = 0;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; lastInput = performance.now(); if (G) G.killTweensOf(cam); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  cv.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (dragging && pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) cam.r = clamp(cam.r * pinch0 / d, 22, 190); pinch0 = d; moved += 10; return; }
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      cam.theta -= dx * 0.0055; cam.phi = clamp(cam.phi - dy * 0.0045, 0.12, 1.5); cv.classList.add('dragging'); lastInput = performance.now();
    } else hover(e);
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size) return; dragging = false; cv.classList.remove('dragging'); if (moved < 5) click(e); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); cam.r = clamp(cam.r * (1 + e.deltaY * 0.0012), 22, 190); lastInput = performance.now(); if (G) G.killTweensOf(cam); }, { passive: false });
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let hovered = null;
  function hit(e) { const r = cv.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const h = ray.intersectObjects(pickables, false)[0]; return h ? h.object : null; }
  function hover(e) { const o = hit(e); hovered = o ? o.userData.id : null; cv.classList.toggle('hover', !!o); }
  function click(e) { const o = hit(e); if (o) { selected = o.userData.id; showInfo(selected); } }
  function showInfo(id) {
    const i = infoFor(id);
    $('iKind').textContent = i.kind; $('iTitle').textContent = i.title + (i.sm !== null ? ` ${i.sm}` : '');
    $('iBody').textContent = i.body;
    $('iLinks').innerHTML = `<a href="${REPO}${i.rtl}" target="_blank" rel="noopener">${i.rtl}</a><a href="${REPO}${i.doc}" target="_blank" rel="noopener">Read the chapter</a><a href="visualizer.html?k=${R ? R.meta.kernel : 'mandelbrot'}">Open in 2D visualizer</a><a href="silicon.html">See it as real silicon</a>`;
    liveInfo();
  }
  function liveInfo() {
    if (!selected || !R) return;
    const i = infoFor(selected); const rows = [];
    const add = (k, v) => rows.push(`<div><span>${k}</span><b>${v}</b></div>`);
    const smIdx = i.sm !== null ? i.sm : 0; const sm = R.sms[smIdx]; const c = R.inflight(smIdx, T);
    if (['sm', 'sched', 'fetch', 'decode', 'rf', 'lanes', 'lsu', 'wb', 'smem'].includes(i.key)) {
      add('Block', sm.busy ? sm.blk : 'none'); add('Instruction', c ? W.disasm(c.ir) : 'none');
      add('Stage', c ? ['schedule', 'fetch', 'decode', 'execute', 'memory', 'writeback'][RP.stageOf(c, T)] : '-');
      add('Active lanes', c ? `${W.popcount(c.exe)} of 8` : '-');
      if (c && c.d.e) add('CUDA analog', c.d.e.cuda.split(';')[0]);
    } else if (i.key === 'dram' || i.key === 'arb') {
      add('Requests so far', upperBound(R.mreqs, T)); add('Latency', `${R.meta.lat} cycles`);
      const q = R.mreqs[upperBound(R.mreqs, T) - 1]; if (q && T - q.t <= R.meta.lat + 1) add('In flight', `SM ${q.sm}, ${['read', 'write', 'atomic'][q.op]} line ${q.a}`);
    } else if (i.key === 'disp') { add('Blocks handed out', `${R.stats.blocksStarted} of ${R.meta.grid}`); add('Launch', `<<<${R.meta.grid}, ${R.meta.block}>>>`); }
    else if (i.key === 'screen') { add('Kernel', R.meta.kernel); if (R.meta.fb) { add('Size', `${R.meta.fb.width} x ${R.meta.fb.height}`); add('Address', '0x' + R.meta.fb.addr.toString(16)); } add('Painted', $('tPx').textContent); }
    else if (i.key === 'cmem') R.meta.params.slice(0, 6).forEach((v, k) => add(`c[${k}]`, v | 0));
    else { add('Kernel', R.meta.kernel); add('Cycle', Math.floor(T)); }
    $('iMeta').innerHTML = rows.join('');
  }

  // ---------------------------------------------------------------------------
  // controls
  // ---------------------------------------------------------------------------
  $('bPlay').onclick = () => { playing = !playing; $('bPlay').textContent = playing ? 'Pause' : 'Play'; };
  $('bPlay').textContent = playing ? 'Pause' : 'Play';
  $('bStart').onclick = () => { Tf = T = 0; if (R) R.reset(); };
  $('bStep').onclick = () => { if (!R) return; playing = false; $('bPlay').textContent = 'Play'; const t = R.nextCommitAfter(T); Tf = T = isFinite(t) ? t - 1 : R.end; };
  $('spd').onchange = (e) => { speed = +e.target.value; };
  $('scrub').oninput = (e) => { Tf = T = +e.target.value; };
  document.querySelectorAll('.cambar [data-cam]').forEach(b => b.addEventListener('click', () => flyTo(b.dataset.cam)));
  $('showLbl').onchange = (e) => $('labels').classList.toggle('off', !e.target.checked);
  addEventListener('keydown', (e) => {
    if (/INPUT|SELECT/.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); $('bPlay').click(); }
    else if (e.key === 'n' || e.key === 'N') $('bStep').click();
    else if (e.key >= '1' && e.key <= '5') flyTo(['overview', 'sm0', 'sm1', 'memory', 'screen'][+e.key - 1]);
  });

  // ---------------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------------
  function resize() {
    const w = cv.clientWidth, h = cv.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) { composer.setSize(w, h); bloom.resolution.set(w, h); }
    if (w < 900) { cam.r = Math.max(cam.r, 130); }
  }
  addEventListener('resize', resize);
  let last = performance.now(), infoTick = 0;
  const tmpC = new THREE.Color(); const v3 = new THREE.Vector3();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (R && playing) {
      if (holdUntil) { if (now > holdUntil) { holdUntil = 0; Tf = 0; R.reset(); } }
      else { Tf += speed * dt; if (Tf >= R.end) { Tf = R.end; holdUntil = now + 2500; } }
      T = Math.floor(Tf);
    }
    update();
    if ($('autoRot').checked && !dragging && now - lastInput > 5000 && !reduce) cam.theta += dt * 0.06;
    applyCam();
    // animate glow + lane heights
    const k = 1 - Math.pow(0.001, dt);
    for (const g of glowers) {
      const u = g.userData; u.glow = lerp(u.glow, 0.62 * u.glowT + (hovered && u.id === hovered ? 0.35 : 0) + (selected && u.id === selected ? 0.25 : 0), k * 1.4);
      tmpC.copy(u.glowColor).multiplyScalar(u.glow); g.material.emissive.copy(tmpC);
      if (u.hT !== undefined) { u.h = lerp(u.h, u.hT, k); g.scale.y = u.h; g.position.y = 0.25 + u.h / 2; }
    }
    // labels
    if (!$('labels').classList.contains('off')) {
      const r = cv.getBoundingClientRect();
      for (const L of labels) {
        L.obj.getWorldPosition(v3); v3.y += L.dy; v3.project(camera);
        const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
        L.el.style.opacity = vis ? 1 : 0;
        L.el.style.left = `${(v3.x + 1) / 2 * r.width}px`; L.el.style.top = `${(1 - v3.y) / 2 * r.height}px`;
      }
    }
    if (now - infoTick > 250) { infoTick = now; liveInfo(); }
    if (composer) composer.render(); else renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  resize(); applyCam();
  UI.nav && UI.nav();
  window.PSCHIP = { flyTo, setCam: (o) => { if (G) G.killTweensOf(cam); Object.assign(cam, o); lastInput = performance.now(); }, cam, setCycle: (t) => { Tf = T = t; }, pause: () => { playing = false; }, select: (id) => { selected = id; showInfo(id); } };
  init().then(() => requestAnimationFrame(frame));
})();
