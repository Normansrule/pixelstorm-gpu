/* =============================================================================
 * app.js — Pixelstorm visualizer
 * -----------------------------------------------------------------------------
 * Reads a trace ({meta, events}) produced either by the Verilog RTL
 * (tools/pixelstorm.js traces) or by the golden model in this browser (pixelstorm.js),
 * and replays it cycle by cycle:
 *
 *   Replay       rebuilds registers / predicates / lane PCs / memory at any
 *                cycle by applying every event with t < cursor
 *   SM diagram   one SVG per Streaming Multiprocessor (SM): scheduler, fetch,
 *                decode, register file, 8 execution lanes, load/store unit,
 *                writeback, shared-memory banks
 *   Narration    plain-English account of what the hardware does this cycle
 *   Inspector    register file of one warp, global + shared memory
 *   Timeline     every warp instruction as a bar; click to jump
 * ========================================================================== */
(function () {
  'use strict';
  const W = window.PIXELSTORM;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------------------
  // small helpers
  // ---------------------------------------------------------------------------
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, attrs, parent, text) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const bit = (m, i) => (m >>> i) & 1;
  const popc = (m) => W.popcount(m >>> 0);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const s32 = (v) => v | 0;
  const fmtVal = (v, hex) => hex ? '0x' + (v >>> 0).toString(16) : String(s32(v));
  const lanesList = (mask, n) => { const o = []; for (let i = 0; i < n; i++) if (bit(mask, i)) o.push(i); return o; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const STAGE_NAMES = ['Schedule', 'Fetch', 'Decode', 'Execute', 'Memory', 'Writeback'];
  const GROUP_VAR = { alu: '--green', memory: '--amber', control: '--blue', warp: '--violet', data: '--slate', predicate: '--slate' };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Replay, stageOf and memPlan live in replay.js (shared with the 3D chip explorer)
  const { Replay, stageOf, memPlan } = window.PSREPLAY;

  // ---------------------------------------------------------------------------
  // SM block diagram
  // ---------------------------------------------------------------------------
  class SmView {
    constructor(host, id, meta) {
      this.id = id; this.meta = meta;
      const wrap = h('div', { class: 'panel sm-wrap' }, host);
      const s = this.svg = svg('svg', { viewBox: '0 0 960 262', role: 'img', 'aria-label': `Block diagram of Streaming Multiprocessor ${id}` }, wrap);
      const defs = svg('defs', {}, s);
      const pat = svg('pattern', { id: `hatch${id}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-l' }, pat);
      const mk = svg('marker', { id: `ah${id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'ah' }, mk);
      this.hatch = `url(#hatch${id})`;

      // title + stage pills
      this.title = svg('text', { x: 12, y: 21, class: 't-sm' }, s);
      this.title.textContent = `SM ${id}`;
      this.blkText = svg('text', { x: 64, y: 21, class: 't-sub' }, s);
      this.pills = [];
      const pw = 84;
      STAGE_NAMES.forEach((n, i) => {
        const x = 432 + i * (pw + 4);
        const r = svg('rect', { x, y: 6, width: pw, height: 20, rx: 10, class: 'pill' }, s);
        const t = svg('text', { x: x + pw / 2, y: 20.5, 'text-anchor': 'middle', class: 'pill-t' }, s);
        t.textContent = n;
        this.pills.push([r, t]);
      });

      // wires (drawn first so boxes sit on top)
      const wire = (d, cls) => svg('path', { d, class: 'wire ' + (cls || ''), 'marker-end': `url(#ah${id})` }, s);
      this.wSchedFetch = wire('M180,66 L198,66');
      this.wFetchDec = wire('M308,66 L318,66');
      this.wDecExec = wire('M468,66 L488,66');
      this.wDecRf = wire('M395,98 L395,106');
      this.wRfExec = wire('M468,140 L488,140');
      this.wExecLsu = wire('M790,66 L808,66', 'mem');
      this.wExecWb = wire('M790,140 L808,140');
      this.wLsuWb = wire('M880,98 L880,106', 'mem');
      this.wLsuSmem = wire('M930,98 L930,186', 'mem');

      const box = (x, y, w, hh, title) => {
        const g = svg('g', {}, s);
        const r = svg('rect', { x, y, width: w, height: hh, class: 'box' }, g);
        const t = svg('text', { x: x + 10, y: y + 19, class: 't-title' }, g); t.textContent = title;
        return { g, r, x, y, w, h: hh };
      };
      // warp scheduler
      this.bSched = box(10, 34, 170, 214, 'Warp scheduler');
      this.warps = [];
      for (let w = 0; w < meta.numWarps; w++) {
        const y = 60 + w * 46;
        const r = svg('rect', { x: 18, y, width: 154, height: 40, class: 'wrow' }, s);
        const t = svg('text', { x: 26, y: y + 16, class: 't-mono' }, s);
        const st = svg('text', { x: 166, y: y + 16, 'text-anchor': 'end', class: 't-sub' }, s);
        const dots = [];
        for (let l = 0; l < meta.warpSize; l++) dots.push(svg('circle', { cx: 30 + l * 13, cy: y + 29, r: 4, class: 'dot' }, s));
        this.warps.push({ r, t, st, dots });
      }
      // fetch / decode
      this.bFetch = box(200, 34, 108, 64, 'Fetch');
      this.fetchT1 = svg('text', { x: 210, y: 70, class: 't-mono' }, s);
      this.fetchT2 = svg('text', { x: 210, y: 88, class: 't-mono-s' }, s);
      this.bDec = box(320, 34, 148, 64, 'Decode');
      this.decT1 = svg('text', { x: 330, y: 70, class: 't-mono' }, s);
      this.decT2 = svg('text', { x: 330, y: 88, class: 't-mono-s' }, s);
      // register file
      this.bRf = box(200, 108, 268, 64, `Register file (${meta.numRegs} per thread)`);
      this.rfT1 = svg('text', { x: 210, y: 144, class: 't-mono' }, s);
      this.rfT2 = svg('text', { x: 210, y: 162, class: 't-mono-s' }, s);
      // execution lanes
      this.bExec = box(490, 34, 300, 138, `Execution lanes (${meta.warpSize} ALUs)`);
      this.lanes = [];
      for (let l = 0; l < meta.warpSize; l++) {
        const x = 498 + (l % 4) * 72, y = 60 + Math.floor(l / 4) * 55;
        const r = svg('rect', { x, y, width: 66, height: 49, class: 'lane' }, s);
        const n = svg('text', { x: x + 6, y: y + 14, class: 't-mono-s' }, s); n.textContent = `lane ${l}`;
        const v = svg('text', { x: x + 6, y: y + 31, class: 't-mono' }, s);
        const sub = svg('text', { x: x + 6, y: y + 44, class: 't-mono-s' }, s);
        this.lanes.push({ r, v, sub });
      }
      // load/store unit + writeback
      this.bLsu = box(810, 34, 142, 64, 'Load/store unit');
      this.lsuT1 = svg('text', { x: 820, y: 70, class: 't-mono' }, s);
      this.lsuT2 = svg('text', { x: 820, y: 88, class: 't-mono-s' }, s);
      this.bWb = box(810, 108, 142, 64, 'Writeback');
      this.wbT1 = svg('text', { x: 820, y: 144, class: 't-mono' }, s);
      this.wbT2 = svg('text', { x: 820, y: 162, class: 't-mono-s' }, s);
      // shared memory banks
      this.bSmem = box(200, 186, 752, 62, `Shared memory (${meta.smemWords} words, ${meta.smemBanks} banks)`);
      this.banks = [];
      const bw = Math.min(82, Math.floor(730 / meta.smemBanks) - 4);
      for (let b = 0; b < meta.smemBanks; b++) {
        const x = 210 + b * (bw + 10), y = 212;
        const r = svg('rect', { x, y, width: bw, height: 30, class: 'bank' }, s);
        const t = svg('text', { x: x + 6, y: y + 13, class: 't-mono-s' }, s); t.textContent = `bank ${b}`;
        const v = svg('text', { x: x + 6, y: y + 26, class: 't-mono-s' }, s);
        this.banks.push({ r, v });
      }
    }

    set(el, cls) { el.setAttribute('class', cls); }

    render(R, T) {
      const m = this.meta, WS = m.warpSize;
      const sm = R.sms[this.id];
      const c = R.inflight(this.id, T);
      const stage = c ? stageOf(c, T) : -1;
      const d = c ? c.d : null;
      this.blkText.textContent = sm.busy ? `running block ${sm.blk} of ${m.grid}` : (sm.blocksDone ? `idle (finished ${plural(sm.blocksDone, 'block')})` : 'idle, waiting for a block');

      // pills
      this.pills.forEach(([r, t], i) => {
        const on = i === stage;
        const extra = i === 4 ? ' mem' : i === 3 ? ' exec' : '';
        r.setAttribute('class', 'pill' + (on ? ' on' + extra : ''));
        t.setAttribute('class', 'pill-t' + (on ? ' on' : ''));
        if (i === 4 && c && !c.st[4]) { r.setAttribute('opacity', '.35'); t.setAttribute('opacity', '.5'); }
        else { r.removeAttribute('opacity'); t.removeAttribute('opacity'); }
      });

      // boxes lit by stage
      this.set(this.bSched.r, 'box' + (stage === 0 ? ' on' : ''));
      this.set(this.bFetch.r, 'box' + (stage === 1 ? ' on' : ''));
      this.set(this.bDec.r, 'box' + (stage === 2 ? ' on' : ''));
      this.set(this.bRf.r, 'box' + (stage === 3 || stage === 5 ? ' on' : ''));
      this.set(this.bExec.r, 'box' + (stage === 3 ? ' on exec' : ''));
      this.set(this.bLsu.r, 'box' + (stage === 4 ? ' on mem' : ''));
      this.set(this.bWb.r, 'box' + (stage === 5 ? ' on' : ''));
      const smemActive = stage === 4 && d && d.isShared;
      this.set(this.bSmem.r, 'box' + (smemActive ? ' on mem' : ''));
      this.set(this.wSchedFetch, 'wire' + (stage === 1 ? ' on' : ''));
      this.set(this.wFetchDec, 'wire' + (stage === 2 ? ' on' : ''));
      this.set(this.wDecExec, 'wire' + (stage === 3 ? ' on' : ''));
      this.set(this.wDecRf, 'wire' + (stage === 3 ? ' on' : ''));
      this.set(this.wRfExec, 'wire' + (stage === 3 ? ' on' : ''));
      this.set(this.wExecLsu, 'wire mem' + (stage === 4 ? ' on' : ''));
      this.set(this.wExecWb, 'wire' + (stage === 5 && !(d && d.isMem) ? ' on' : ''));
      this.set(this.wLsuWb, 'wire mem' + (stage === 5 && d && d.isMem ? ' on' : ''));
      this.set(this.wLsuSmem, 'wire mem' + (smemActive ? ' on' : ''));

      // warp rows
      for (let w = 0; w < m.numWarps; w++) {
        const row = this.warps[w];
        const valid = sm.busy && w * WS < m.block;
        let live = 0, minpc = Infinity; const pcs = new Set();
        for (let l = 0; l < WS; l++) { const tid = w * WS + l; if (!sm.ldone[tid]) { live++; pcs.add(sm.lpc[tid]); minpc = Math.min(minpc, sm.lpc[tid]); } }
        const isCur = c && c.w === w;
        let status;
        if (!valid) status = 'empty';
        else if (!live) status = 'exited';
        else if (sm.wait[w]) status = 'at barrier';
        else if (isCur) status = 'issuing';
        else status = pcs.size > 1 ? 'diverged' : 'ready';
        this.set(row.r, 'wrow' + (isCur ? ' cur' : (valid && live && sm.wait[w] ? ' bar' : '')));
        row.t.textContent = `W${w}` + (valid && live ? `  PC ${minpc}` : '');
        row.st.textContent = status;
        for (let l = 0; l < WS; l++) {
          const tid = w * WS + l;
          let cls = 'dot';
          if (valid) {
            if (sm.ldone[tid]) cls = 'dot done';
            else if (sm.lpc[tid] === minpc) cls = 'dot on';
            else cls = 'dot div';
          }
          this.set(row.dots[l], cls);
        }
      }

      // fetch/decode/regfile/lsu/wb text
      const blank = (...els) => els.forEach(e => { e.textContent = ''; });
      if (!c) {
        blank(this.fetchT1, this.fetchT2, this.decT1, this.decT2, this.rfT1, this.rfT2, this.lsuT1, this.lsuT2, this.wbT1, this.wbT2);
        for (const ln of this.lanes) { this.set(ln.r, 'lane none'); ln.v.textContent = ''; ln.sub.textContent = ''; ln.r.style.fill = ''; }
        for (const b of this.banks) { this.set(b.r, 'bank'); b.v.textContent = ''; }
        return;
      }
      this.fetchT1.textContent = `PC ${c.pc}`;
      this.fetchT2.textContent = stage >= 1 ? `0x${W.hex8(c.ir)}` : 'address sent';
      if (stage >= 2) {
        this.decT1.textContent = d.name + (d.gEn ? `  @${d.gNeg ? '!' : ''}P${d.gP}` : '');
        this.decT2.textContent = `op 0x${d.op.toString(16).padStart(2, '0')} ${d.e ? d.e.group : ''}`;
      } else blank(this.decT1, this.decT2);
      const srcRegs = regReads(d);
      if (stage >= 3) {
        this.rfT1.textContent = (srcRegs.length ? 'read ' + srcRegs.join(' ') : 'no register reads') + (c.wr ? `   write R${c.rd}` : c.pw ? `   write P${c.rd & 3}` : '');
        this.rfT2.textContent = `warp ${c.w} = threads ${c.w * WS}..${c.w * WS + WS - 1}`;
      } else blank(this.rfT1, this.rfT2);

      // lanes
      const plan = d.isMem && stage >= 3 ? memPlan(c, m) : null;
      let curGroup = -1;
      if (plan && stage === 4) {
        if (d.isShared) curGroup = Math.min(T - c.st[4], plan.n - 1);
        else {
          const g = R.mreqs.filter(e => e.sm === this.id && e.t >= c.st[4] && e.t <= T).length;
          curGroup = Math.max(0, Math.min(g - 1, plan.n - 1));
        }
      }
      let liveBefore = 0;
      for (let l = 0; l < WS; l++) if (!sm.ldone[c.w * WS + l]) liveBefore++;
      for (let l = 0; l < WS; l++) {
        const ln = this.lanes[l]; const tid = c.w * WS + l;
        const inBlock = tid < m.block;
        const act = bit(c.act, l), exe = bit(c.exe, l);
        let cls = 'lane', val = '', sub = '';
        if (!inBlock) { cls = 'lane none'; sub = 'no thread'; }
        else if (sm.ldone[tid] && !act) { cls = 'lane done'; sub = 'exited'; }
        else if (!act) { cls = 'lane div'; sub = `wait @${sm.lpc[tid]}`; }
        else if (stage <= 1) { cls = 'lane sel'; sub = 'selected'; }
        else if (!exe) { cls = 'lane off'; sub = 'guard off'; }
        else {
          cls = stage === 4 ? 'lane mem' : stage === 3 || stage === 5 ? 'lane exe' : 'lane sel';
          if (stage >= 3) {
            if (d.isMem) {
              sub = `addr ${c.addr[l]}`;
              if (plan) {
                const g = plan.group[l];
                if (stage === 4) sub = g < curGroup ? `done (#${g + 1})` : g === curGroup ? `serving #${g + 1}` : `queued #${g + 1}`;
              }
              if (stage === 5 || (stage === 4 && plan && plan.group[l] < curGroup)) val = (d.isLoad || d.isAtom) ? fmtVal(c.v[l], hexMode()) : '';
              if (d.isStore) val = stage >= 4 ? 'store' : '';
            } else if (c.wr) { val = fmtVal(c.v[l], hexMode()); sub = `R${c.rd}`; }
            else if (c.pw) { val = bit(c.pv, l) ? 'true' : 'false'; sub = `P${c.rd & 3}`; }
            else if (d.isBranch) { val = c.lpc[l] !== c.pc + 1 ? 'jump' : 'fall'; sub = `next PC ${c.lpc[l]}`; }
            else if (d.isExit) { val = 'exit'; }
            else if (d.isBar) { val = 'wait'; sub = 'barrier'; }
          } else sub = 'guard true';
        }
        this.set(ln.r, cls);
        ln.r.style.fill = cls === 'lane off' ? this.hatch : '';
        ln.v.textContent = val; ln.sub.textContent = sub;
      }

      // load/store unit
      if (d.isMem && stage >= 3 && plan) {
        const unit = d.isShared ? (d.isAtom ? ['atomic step', 'atomic steps'] : ['bank pass', 'bank passes']) : (d.isAtom ? ['atomic', 'atomics'] : ['transaction', 'transactions']);
        this.lsuT1.textContent = plural(plan.n, unit[0], unit[1]);
        if (stage === 4) this.lsuT2.textContent = `#${curGroup + 1}: lanes ${plan.info[curGroup] ? plan.info[curGroup].lanes.join(',') : ''}`;
        else if (stage === 5) this.lsuT2.textContent = `${c.mcyc} memory cycles`;
        else this.lsuT2.textContent = `${popc(c.exe)} lanes want memory`;
      } else { this.lsuT1.textContent = d.isMem ? 'waiting' : 'idle'; this.lsuT2.textContent = ''; }
      // banks
      for (let b = 0; b < m.smemBanks; b++) {
        const bk = this.banks[b];
        let cls = 'bank', txt = '';
        if (plan && d.isShared && stage === 4 && plan.info[curGroup]) {
          const inf = plan.info[curGroup];
          const lanesHere = inf.lanes.filter(l => (c.addr[l] & (m.smemBanks - 1)) === b);
          if (lanesHere.length) { cls = 'bank on'; txt = `L${lanesHere.join(',')}`; }
          const waiting = lanesList(c.exe, WS).filter(l => plan.group[l] > curGroup && (c.addr[l] & (m.smemBanks - 1)) === b);
          if (waiting.length) { cls = 'bank conf'; txt = (txt ? txt + ' ' : '') + `+${waiting.length} queued`; }
        }
        this.set(bk.r, cls); bk.v.textContent = txt;
      }
      // writeback
      if (stage === 5) {
        const n = popc(c.exe);
        this.wbT1.textContent = c.wr ? `R${c.rd} for ${n} lanes` : c.pw ? `P${c.rd & 3} for ${n} lanes` : 'no result';
        const npcs = [...new Set(lanesList(c.act, WS).map(l => c.lpc[l]))];
        this.wbT2.textContent = d.isExit ? 'lanes retire' : `next PC ${npcs.join(' / ')}`;
      } else blank(this.wbT1, this.wbT2);
    }
  }

  function regReads(d) {
    if (!d || !d.e) return [];
    const R = (x) => 'R' + x;
    switch (d.e.fmt) {
      case 'rr': return [R(d.rs1)];
      case 'rrr': return [R(d.rs1), R(d.rs2)];
      case 'rrrr': return [R(d.rs1), R(d.rs2), R(d.rs3)];
      case 'sel': return [R(d.rs1), R(d.rs2), 'P' + d.selp];
      case 'rri': case 'shfl': case 'ld': return [R(d.rs1)];
      case 'setp': return [R(d.rs1), R(d.rs2)];
      case 'vote': return ['P' + (d.rs1 & 3)];
      case 'st': return [R(d.rs1), R(d.rd)];
      case 'atom': return [R(d.rs1), R(d.rs2)];
      default: return [];
    }
  }

  // ---------------------------------------------------------------------------
  // memory system strip (dispatcher, arbiter, DRAM)
  // ---------------------------------------------------------------------------
  class MemView {
    constructor(el, meta) {
      this.el = el; this.meta = meta; el.innerHTML = '';
      const s = el;
      const defs = svg('defs', {}, s);
      const mk = svg('marker', { id: 'ahm', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, defs);
      svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'ah' }, mk);
      const box = (x, y, w, hh, title) => {
        const r = svg('rect', { x, y, width: w, height: hh, class: 'box' }, s);
        const t = svg('text', { x: x + 10, y: y + 19, class: 't-title' }, s); t.textContent = title;
        return r;
      };
      this.disp = box(10, 8, 200, 80, 'Block dispatcher');
      this.dispT = svg('text', { x: 20, y: 50, class: 't-mono' }, s);
      this.dispT2 = svg('text', { x: 20, y: 70, class: 't-mono-s' }, s);
      this.ports = [];
      const n = meta.numSms; const ph = Math.min(36, (80 - (n - 1) * 6) / n);
      for (let i = 0; i < n; i++) {
        const y = 8 + i * (ph + 6);
        const r = svg('rect', { x: 240, y, width: 150, height: ph, class: 'box port' }, s);
        const t = svg('text', { x: 250, y: y + ph / 2 + 5, class: 't-mono-s' }, s);
        svg('path', { d: `M390,${y + ph / 2} L438,48`, class: 'wire', 'marker-end': 'url(#ahm)' }, s);
        this.ports.push({ r, t });
      }
      this.arb = box(440, 8, 190, 80, 'Memory arbiter');
      this.arbT = svg('text', { x: 450, y: 50, class: 't-mono' }, s);
      this.arbT2 = svg('text', { x: 450, y: 70, class: 't-mono-s' }, s);
      this.wire2 = svg('path', { d: 'M630,48 L658,48', class: 'wire', 'marker-end': 'url(#ahm)' }, s);
      this.dram = box(660, 8, 290, 80, `DRAM (global memory, ${meta.lat}-cycle latency)`);
      this.dramT = svg('text', { x: 670, y: 50, class: 't-mono' }, s);
      svg('rect', { x: 670, y: 62, width: 270, height: 12, rx: 3, class: 'prog-bg' }, s);
      this.bar = svg('rect', { x: 670, y: 62, width: 0, height: 12, rx: 3, class: 'prog' }, s);
    }
    render(R, T) {
      const m = this.meta;
      const started = R.stats.blocksStarted;
      this.dispT.textContent = `grid ${m.grid} x block ${m.block}`;
      this.dispT2.textContent = started >= m.grid ? `all ${m.grid} blocks handed out` : `next block: ${started} of ${m.grid}`;
      // latest request at or before T
      let req = null;
      for (let i = R.mreqs.length - 1; i >= 0; i--) if (R.mreqs[i].t <= T) { req = R.mreqs[i]; break; }
      const busy = req && T <= req.t + m.lat + 1;
      const ops = ['read line', 'write line', 'atomic add'];
      for (let i = 0; i < this.ports.length; i++) {
        const p = this.ports[i]; const c = R.inflight(i, T);
        const waiting = c && stageOf(c, T) === 4 && !c.d.isShared;
        p.r.setAttribute('class', 'box port' + (waiting ? ' on' : ''));
        p.t.textContent = `SM ${i} port` + (waiting ? (busy && req.sm === i ? ' granted' : ' requesting') : '');
      }
      this.arb.setAttribute('class', 'box' + (busy ? ' on mem' : ''));
      this.arbT.textContent = busy ? `owner: SM ${req.sm}` : 'free';
      this.arbT2.textContent = 'one request at a time, round robin';
      this.wire2.setAttribute('class', 'wire' + (busy ? ' on mem' : ''));
      this.dram.setAttribute('class', 'box' + (busy ? ' on mem' : ''));
      if (busy) {
        const wm = req.op === 1 ? ` mask ${req.wm.toString(2).padStart(m.lineWords, '0')}` : '';
        this.dramT.textContent = `${ops[req.op]} @${req.a}${wm}`;
        const f = Math.min(1, (T - req.t) / (m.lat + 1));
        this.bar.setAttribute('width', String(270 * f));
      } else { this.dramT.textContent = 'idle'; this.bar.setAttribute('width', '0'); }
    }
  }

  // ---------------------------------------------------------------------------
  // narration
  // ---------------------------------------------------------------------------
  function narrate(R, s, T) {
    const m = R.meta, WS = m.warpSize;
    const sm = R.sms[s];
    const c = R.inflight(s, T);
    if (!c) {
      if (R.bars.some(b => b.sm === s && b.t === T)) return `<b>SM ${s}</b>Every live warp of block ${sm.blk} has reached the barrier (<code>BAR</code>, CUDA <code>__syncthreads()</code>), so the scheduler releases them all this cycle.`;
      if (R.blks.some(b => b.sm === s && b.t === T && b.ph === 'start')) return `<b>SM ${s}</b>The block dispatcher hands block ${R.blks.find(b => b.sm === s && b.t === T).blk} to this SM. Every thread's PC is set to 0 and ${plural(Math.ceil(m.block / WS), 'warp')} become ready.`;
      if (R.blks.some(b => b.sm === s && b.t === T && b.ph === 'end')) return `<b>SM ${s}</b>Every thread of the block has executed <code>EXIT</code>. The SM reports "done" and is free for the next block.`;
      if (T >= R.end) return `<b>SM ${s}</b>The kernel is finished. Check the global memory panel for the results.`;
      return `<b>SM ${s}</b>${sm.busy ? 'Between instructions.' : 'Idle: no thread block is assigned to this SM right now.'}`;
    }
    const d = c.d; const stage = stageOf(c, T); const name = d.name;
    const act = popc(c.act), exe = popc(c.exe);
    let live = 0; for (let l = 0; l < WS; l++) if (!sm.ldone[c.w * WS + l]) live++;
    const head = `<b>SM ${s}, warp ${c.w}</b>`;
    const asm = `<code>${esc(W.disasm(c.ir))}</code>`;
    switch (stage) {
      case 0: {
        let t = `${head}The warp scheduler picks warp ${c.w} (round robin over warps that are not waiting). It issues the lowest PC among the warp's live lanes, PC ${c.pc}`;
        if (act < live) t += `. Only ${act} of ${live} live lanes sit at that PC, so the warp is <em>diverged</em>: the other lanes wait until their PC is the lowest one.`;
        else t += `, and all ${live} live lanes are there, so the whole warp moves together.`;
        return t;
      }
      case 1: return `${head}Instruction memory returns the 32-bit word <code>0x${W.hex8(c.ir)}</code> stored at PC ${c.pc}. One fetch serves all ${act} active lanes: that sharing is the whole idea of SIMT (Single Instruction, Multiple Threads).`;
      case 2: {
        let t = `${head}The decoder splits the word into fields: opcode <code>0x${d.op.toString(16).padStart(2, '0')}</code> is ${asm}. ${d.e ? esc(d.e.desc) : ''}`;
        if (d.gEn) t += ` The guard predicate is checked per lane: ${exe} of ${act} active lanes pass${exe < act ? '; the rest stay idle for this instruction (predication, no branch needed)' : ''}.`;
        return t;
      }
      case 3: {
        if (d.isBranch) {
          const taken = lanesList(c.exe, WS).length;
          if (taken === act) return `${head}Every active lane takes the branch to PC ${d.imm18}. A uniform branch costs nothing extra.`;
          if (taken === 0) return `${head}No lane takes the branch; all ${act} fall through to PC ${c.pc + 1}.`;
          return `${head}${taken} lanes jump to PC ${d.imm18} and ${act - taken} fall through to PC ${c.pc + 1}. The warp has <em>diverged</em>: from now on the scheduler runs the lower PC first and the lanes meet again where their PCs become equal (min-PC reconvergence).`;
        }
        if (d.isExit) return `${head}${exe} lanes execute <code>EXIT</code> and finish. The warp keeps running until every one of its lanes has exited.`;
        if (d.isBar) return `${head}Warp ${c.w} reaches <code>BAR</code> and will be parked until every warp of block ${c.blk} arrives. That is how <code>__syncthreads()</code> keeps shared-memory reads from racing ahead of writes.`;
        if (name === 'SHFL') return `${head}The shuffle network lets each lane read a register of another lane in the same warp, with no memory access: ${asm}. CUDA calls this <code>__shfl_sync</code>.`;
        if (name === 'VOTE') return `${head}The vote unit looks at all ${exe} lanes at once and combines one predicate bit from each: ${asm}. Result: ${d.vmode === 2 ? 'mask 0b' + (c.v[lanesList(c.exe, WS)[0] || 0] >>> 0).toString(2).padStart(WS, '0') : (bit(c.pv, lanesList(c.exe, WS)[0] || 0) ? 'true' : 'false')}.`;
        if (d.isMem) {
          const a = lanesList(c.exe, WS).map(l => c.addr[l]);
          return `${head}Each of the ${exe} lanes computes its own address in its ALU (Arithmetic Logic Unit): ${a.slice(0, 8).join(', ')}. Next the load/store unit decides how many memory ${d.isShared ? 'bank passes' : 'transactions'} that takes.`;
        }
        const first = lanesList(c.exe, WS)[0];
        const ex = first === undefined ? '' : c.wr ? ` Lane ${first} gets ${s32(c.v[first])}.` : c.pw ? ` Lane ${first} gets ${bit(c.pv, first) ? 'true' : 'false'}.` : '';
        return `${head}${exe} ALUs run ${asm} at the same time, each on its own thread's registers.${ex}${exe < WS ? ` ${WS - exe} lane slots do no useful work this cycle.` : ''}`;
      }
      case 4: {
        const plan = memPlan(c, m);
        if (d.isShared) {
          const k = Math.min(T - c.st[4], plan.n);
          if (k >= plan.n) return `${head}All shared-memory passes are done; moving to writeback.`;
          const inf = plan.info[k];
          let t = `${head}Shared memory is split into ${m.smemBanks} banks and each bank serves one word per cycle. Pass ${k + 1} of ${plan.n} serves lanes ${inf.lanes.join(', ')}.`;
          if (plan.n > 1 && !d.isAtom) t += ` Lanes that hit the same bank at different addresses must wait: a ${plan.n}-way <em>bank conflict</em>.`;
          else if (plan.n === 1) t += ' No bank conflicts: one cycle for the whole warp.';
          if (d.isAtom) t += ' Atomics go one lane at a time so no update is lost.';
          return t;
        }
        const g = R.mreqs.filter(e => e.sm === s && e.t >= c.st[4] && e.t <= T);
        const k = Math.max(0, Math.min(g.length - 1, plan.n - 1));
        const inf = plan.info[k];
        const req = g[g.length - 1];
        let t = `${head}The load/store unit groups lanes by ${m.lineWords}-word cache line: ${exe} lanes need ${plural(plan.n, d.isAtom ? 'atomic request' : 'transaction')}.`;
        if (plan.n === 1 && exe > 1 && !d.isAtom) t += ' Fully <em>coalesced</em>.';
        if (plan.n === exe && exe > 1 && !d.isAtom) t += ' Every lane needs its own line: <em>uncoalesced</em>, the slowest pattern.';
        if (inf) t += ` Request ${k + 1} (${d.isAtom ? 'address' : 'line'} ${inf.line}, lanes ${inf.lanes.join(', ')}) `;
        t += req ? (T <= req.t + m.lat + 1 ? `is in DRAM for ${m.lat} cycles. The whole warp waits; a real GPU would switch to another warp here to hide the latency.` : 'has returned.') : 'is waiting for the arbiter.';
        return t;
      }
      default: {
        const tgt = c.wr ? `R${c.rd}` : c.pw ? `P${c.rd & 3}` : null;
        const npcs = [...new Set(lanesList(c.act, WS).map(l => c.lpc[l]))];
        return `${head}${tgt ? `Results go into ${tgt} of ${exe} lanes.` : 'Nothing to write back.'} Each active lane's PC moves to ${npcs.join(' or ')}. The instruction took ${c.st[5] - c.st[0] + 1} cycles from schedule to writeback${c.mcyc ? `, ${c.mcyc} of them in memory` : ''}.`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------------
  const app = {
    index: [], examples: window.PS_EXAMPLES || [], rtlAvailable: false,
    R: null, T: 0, playing: false, smViews: [], mem: null, codeRows: [], pcToLine: [],
    inspSm: 0, inspWarp: 0, zoom: 1, lastFrame: 0, acc: 0,
  };
  const hexMode = () => $('hexChk').checked;

  function kernelKey(ex) { const m = /^\.kernel\s+(\S+)/m.exec(ex.src); return m ? m[1] : ex.file.replace(/\.psa$/, ''); }

  async function init() {
    // theme
    const saved = (() => { try { return localStorage.getItem('ps-theme'); } catch (e) { return null; } })();
    const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(dark ? 'dark' : 'light');
    $('themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

    // kernels
    const sel = $('kernelSel');
    app.examples.forEach((ex, i) => { const o = h('option', { value: i }, sel, `${ex.file.slice(0, 2)}  ${kernelKey(ex).replace(/_/g, ' ')}`); o.value = i; });
    try {
      const r = await fetch('traces/index.json', { cache: 'no-cache' });
      if (r.ok) { app.index = await r.json(); app.rtlAvailable = app.index.length > 0; }
    } catch (e) { app.rtlAvailable = false; }
    if (!app.rtlAvailable) {
      $('sourceSel').value = 'sim';
      $('sourceSel').querySelector('option[value=rtl]').textContent = 'RTL simulation (run: make traces)';
    }
    sel.onchange = () => loadKernel(+sel.value);
    $('sourceSel').onchange = () => loadKernel(+sel.value);
    $('traceFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { setTrace(JSON.parse(await f.text())); } catch (err) { alert('That file is not a Pixelstorm trace: ' + err.message); }
    };

    // tabs
    document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
    });
    buildIsa();
    initFramebufferHover();
    $('runBtn').onclick = runEditor;

    // transport
    $('playBtn').onclick = togglePlay;
    $('stepBtn').onclick = () => { stop(); seek(app.T + 1); };
    $('backBtn').onclick = () => { stop(); seek(app.T - 1); };
    $('startBtn').onclick = () => { stop(); seek(0); };
    $('nextBtn').onclick = () => { stop(); nextCommit(); };
    $('scrub').oninput = (e) => { stop(); seek(+e.target.value); };
    $('zoom').oninput = (e) => { app.zoom = +e.target.value; drawTimeline(); };
    $('hexChk').onchange = () => render();
    $('followChk').onchange = () => render();
    $('inspSm').onchange = (e) => { app.inspSm = +e.target.value; $('followChk').checked = false; render(); };
    $('inspWarp').onchange = (e) => { app.inspWarp = +e.target.value; $('followChk').checked = false; render(); };
    $('timeline').addEventListener('click', onTimelineClick);
    window.addEventListener('resize', () => drawTimeline());
    document.addEventListener('keydown', onKey);

    const want = (/[?&]k=([\w]+)/.exec(location.search) || [])[1] || 'vector_add';
    const start = app.examples.findIndex(ex => kernelKey(ex) === want);
    sel.value = start >= 0 ? start : 0;
    await loadKernel(+sel.value);
    initTour();
  }

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
    try { localStorage.setItem('ps-theme', t); } catch (e) { /* storage blocked */ }
    drawTimeline();
  }

  async function loadKernel(i) {
    stop();
    const ex = app.examples[i]; if (!ex) return;
    $('editor').value = ex.src;
    const name = kernelKey(ex);
    if ($('sourceSel').value === 'rtl' && app.rtlAvailable) {
      const ent = app.index.find(e => e.name === name);
      if (ent) {
        try {
          const r = await fetch('traces/' + ent.file);
          if (r.ok) { setTrace(await r.json()); return; }
        } catch (e) { /* fall through to the in-browser model */ }
      }
    }
    try { setTrace(W.buildTrace(ex.src)); } catch (e) { showAsmMsg(e.message, true); }
  }

  function runEditor() {
    stop();
    const src = $('editor').value;
    try {
      const t = W.buildTrace(src, { numSms: +$('smsSel').value, lat: +$('latIn').value });
      const dn = t.events.find(e => e.ev === 'done');
      showAsmMsg(`Assembled ${t.meta.program.length} instructions. Ran in ${t.meta.cycles} cycles${dn && !dn.ok ? ' — TIMEOUT: missing EXIT or a barrier that never releases?' : ''}.`, dn && !dn.ok);
      setTrace(t);
    } catch (e) {
      showAsmMsg(e.message, true);
      if (e.line) {
        const ta = $('editor'); const lines = ta.value.split('\n');
        const start = lines.slice(0, e.line - 1).join('\n').length + (e.line > 1 ? 1 : 0);
        ta.focus(); ta.setSelectionRange(start, start + (lines[e.line - 1] || '').length);
      }
    }
  }
  function showAsmMsg(msg, err) { const el = $('asmMsg'); el.textContent = msg; el.className = 'asm-msg ' + (err ? 'err' : 'ok'); }

  function setTrace(trace) {
    app.R = new Replay(trace);
    const m = app.R.meta;
    app.T = 0;
    // header
    $('kernelTitle').textContent = m.kernel.replace(/_/g, ' ');
    $('kernelLaunch').textContent = `<<<${m.grid}, ${m.block}>>>  ${m.numSms} SM${m.numSms > 1 ? 's' : ''}, warp ${m.warpSize}, ${m.source === 'rtl' ? 'recorded from the Verilog RTL' : 'golden model in browser'}`;
    // code view
    buildCode(m);
    // SM views
    const host = $('smHost'); host.innerHTML = '';
    app.smViews = [];
    for (let s = 0; s < m.numSms; s++) app.smViews.push(new SmView(host, s, m));
    app.mem = new MemView($('memsys'), m);
    // inspector selectors
    const ss = $('inspSm'); ss.innerHTML = '';
    for (let s = 0; s < m.numSms; s++) h('option', { value: s }, ss, `SM ${s}`);
    const ws = $('inspWarp'); ws.innerHTML = '';
    for (let w = 0; w < m.numWarps; w++) h('option', { value: w }, ws, `warp ${w}`);
    app.inspSm = 0; app.inspWarp = 0;
    $('scrub').max = app.R.end; $('cycleMax').textContent = app.R.end;
    seek(firstInteresting());
  }
  function firstInteresting() { const c = app.R.commits[0]; return c ? c.st[0] : 0; }

  function buildCode(m) {
    const ol = $('codeView'); ol.innerHTML = '';
    app.codeRows = [];
    const lineToPc = {}; app.pcToLine = [];
    for (const p of m.program) { lineToPc[p.line] = p.pc; app.pcToLine[p.pc] = p.line; }
    m.src.forEach((text, i) => {
      const ln = i + 1;
      const li = h('li', {}, ol);
      h('span', { class: 'pc' }, li, ln in lineToPc ? String(lineToPc[ln]) : '');
      const mk = h('span', { class: 'mk' }, li);
      const t = h('span', { class: 't' }, li);
      t.innerHTML = highlight(text);
      app.codeRows.push({ li, mk });
    });
  }
  function highlight(line) {
    const ci = line.search(/;|\/\/|#/);
    const code = ci >= 0 ? line.slice(0, ci) : line; const cm = ci >= 0 ? line.slice(ci) : '';
    let out = esc(code)
      .replace(/^(\s*)(\.[a-z]+)/i, '$1<span class="dv">$2</span>')
      .replace(/^(\s*)([A-Za-z_]\w*:)/, '$1<span class="lb">$2</span>')
      .replace(/(^|\s)(@!?P[0-3])/, '$1<span class="pr">$2</span>')
      .replace(/\b(P[0-3])\b/g, '<span class="pr">$1</span>')
      .replace(/\b(R1[0-5]|R[0-9])\b/g, '<span class="rg">$1</span>');
    out = out.replace(/^((?:\s|<span class="(?:pr|lb)">[^<]*<\/span>)*\s*)([A-Z][A-Z0-9]*)((?:\.[A-Z]+)*)/, (all, pre, mn, suf) => {
      const e = W.BY_NAME[mn];
      if (!e) return all;
      return `${pre}<span class="mn" title="${esc(e.desc + '  |  CUDA: ' + e.cuda)}">${mn}${suf}</span>`;
    });
    return out + (cm ? `<span class="cm">${esc(cm)}</span>` : '');
  }
  function buildIsa() {
    const host = $('isaTable'); host.innerHTML = '';
    for (const e of W.ISA) {
      const row = h('div', { class: 'row' }, host);
      const left = h('div', { class: 'stripe' }, row);
      left.style.borderLeftColor = `var(${GROUP_VAR[e.group] || '--slate'})`;
      h('div', { class: 'mn' }, left, e.name);
      h('div', { class: 'grp' }, left, `0x${e.code.toString(16).padStart(2, '0')} ${e.group}`);
      h('div', {}, row, e.desc);
      h('div', { class: 'cu' }, row, e.cuda);
    }
  }

  // ---------------------------------------------------------------------------
  // playback
  // ---------------------------------------------------------------------------
  function seek(T) {
    if (!app.R) return;
    app.T = Math.max(0, Math.min(app.R.end, Math.round(T)));
    app.R.seek(app.T);
    render();
  }
  function nextCommit() {
    const t = app.R.nextCommitAfter(app.T);
    seek(isFinite(t) ? t : app.R.end);
  }
  function togglePlay() { app.playing ? stop() : play(); }
  function play() {
    if (app.T >= app.R.end) seek(0);
    app.playing = true; $('playBtn').textContent = 'Pause'; app.lastFrame = performance.now(); app.acc = 0;
    requestAnimationFrame(tick);
  }
  function stop() { app.playing = false; $('playBtn').textContent = 'Play'; }
  function tick(now) {
    if (!app.playing) return;
    const speed = +$('speedSel').value;
    app.acc += (now - app.lastFrame) / 1000 * speed; app.lastFrame = now;
    const steps = Math.floor(app.acc);
    if (steps > 0) {
      app.acc -= steps;
      seek(app.T + steps);
      if (app.T >= app.R.end) { stop(); return; }
    }
    requestAnimationFrame(tick);
  }
  function onKey(e) {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stop(); e.shiftKey ? nextCommit() : seek(app.T + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); seek(app.T - 1); }
    else if (e.key === 'n' || e.key === 'N') { stop(); nextCommit(); }
    else if (e.key === 'Home') { stop(); seek(0); }
    else if (e.key === 'End') { stop(); seek(app.R.end); }
  }

  // ---------------------------------------------------------------------------
  // render everything for cycle T
  // ---------------------------------------------------------------------------
  function render() {
    const R = app.R; if (!R) return; const T = app.T; const m = R.meta;
    $('cycleOut').textContent = T; $('scrub').value = T;
    app.smViews.forEach(v => v.render(R, T));
    app.mem.render(R, T);

    // instruction strip + code markers
    const strip = $('instStrip'); strip.innerHTML = '';
    app.codeRows.forEach(r => { r.li.classList.remove('cur'); r.mk.innerHTML = ''; });
    let firstLine = null;
    for (let s = 0; s < m.numSms; s++) {
      const c = R.inflight(s, T);
      const one = h('div', { class: 'one' }, strip);
      if (c) {
        const st = stageOf(c, T);
        h('div', { class: 'who' }, one, `SM ${s}, block ${c.blk}, warp ${c.w}, PC ${c.pc}, ${STAGE_NAMES[st].toLowerCase()} stage, ${popc(c.exe)}/${m.warpSize} lanes`);
        h('div', { class: 'asm' }, one, W.disasm(c.ir));
        h('div', { class: 'cuda' }, one, c.d.e ? 'CUDA / PTX / SASS: ' + c.d.e.cuda : '');
        const line = app.pcToLine[c.pc];
        if (line && app.codeRows[line - 1]) {
          const row = app.codeRows[line - 1];
          row.li.classList.add('cur');
          h('b', { class: 's' + s, title: `SM ${s}` }, row.mk, String(s));
          if (firstLine === null || s === app.inspSm) firstLine = line;
        }
      } else {
        h('div', { class: 'who' }, one, `SM ${s}`);
        h('div', { class: 'asm idle' }, one, R.sms[s].busy ? 'between instructions' : 'idle');
      }
    }
    if (firstLine && app.playing) {
      const li = app.codeRows[firstLine - 1].li; const pane = $('tab-src');
      const top = li.offsetTop - pane.clientHeight / 2;
      if (Math.abs(pane.scrollTop - top) > pane.clientHeight / 3) pane.scrollTop = top;
    }

    // narration
    const nar = $('narration'); let html = '';
    for (let s = 0; s < m.numSms; s++) html += `<p class="n-sm">${narrate(R, s, T)}</p>`;
    nar.innerHTML = html;

    // stats
    const st = R.stats;
    const eff = st.slots ? (100 * st.laneOps / st.slots).toFixed(0) + '%' : '-';
    $('stats').innerHTML = `<span>warp instructions <b>${st.instr}</b></span><span>SIMD efficiency <b>${eff}</b></span><span>memory transactions/passes <b>${st.txns}</b></span><span>divergent issues <b>${st.divergent}</b></span><span>IPC (Instructions Per Cycle) <b>${T ? (st.instr / T).toFixed(3) : '0'}</b></span>`;

    renderFramebuffer(R, T);
    renderInspector(R, T);
    drawTimeline();
  }


  // ---------------------------------------------------------------------------
  // framebuffer: draw the kernel's image straight from replayed global memory
  // ---------------------------------------------------------------------------
  let fbHover = null;
  function renderFramebuffer(R, T) {
    const fb = R.meta.fb; const wrap = $('fbWrap');
    if (!fb) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const cv = $('fbCanvas'); const S = Math.max(4, Math.floor(512 / Math.max(fb.width, fb.height)));
    if (cv.width !== fb.width * S || cv.height !== fb.height * S) { cv.width = fb.width * S; cv.height = fb.height * S; }
    const ctx = cv.getContext('2d');
    let written = 0, fresh = [];
    for (let y = 0; y < fb.height; y++) for (let x = 0; x < fb.width; x++) {
      const a = fb.addr + y * fb.width + x; const t = R.gTouch.get(a);
      if (t === undefined) {                                   // not painted yet: checkerboard
        ctx.fillStyle = ((x + y) & 1) ? '#C9D1DA' : '#E3E8EE';
        ctx.fillRect(x * S, y * S, S, S);
        continue;
      }
      written++;
      const v = R.gmem.get(a) >>> 0;
      ctx.fillStyle = '#' + (v & 0xffffff).toString(16).padStart(6, '0');
      ctx.fillRect(x * S, y * S, S, S);
      if (T - t <= 12) fresh.push([x, y]);
    }
    ctx.lineWidth = Math.max(1, S / 6); ctx.strokeStyle = '#FFFFFF';
    for (const [x, y] of fresh) ctx.strokeRect(x * S + 1, y * S + 1, S - 2, S - 2);
    const total = fb.width * fb.height;
    $('fbInfo').textContent = `${fb.width} x ${fb.height}, ${Math.round(100 * written / total)}% painted`;
    if (!fbHover) $('fbCap').textContent = written === total ? 'Finished. Hover a pixel for its address and color.' :
      'Checkerboard = not written yet. Outlined pixels were stored in the last few cycles.';
  }
  function initFramebufferHover() {
    const cv = $('fbCanvas');
    cv.addEventListener('mousemove', (e) => {
      const fb = app.R && app.R.meta.fb; if (!fb) return;
      const r = cv.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * fb.width), y = Math.floor((e.clientY - r.top) / r.height * fb.height);
      if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) return;
      const a = fb.addr + y * fb.width + x; const t = app.R.gTouch.get(a);
      fbHover = [x, y];
      $('fbCap').textContent = t === undefined ? `pixel (${x}, ${y}) at address 0x${a.toString(16)}: not written yet` :
        `pixel (${x}, ${y}) at address 0x${a.toString(16)} = 0x${(app.R.gmem.get(a) >>> 0).toString(16).padStart(6, '0')}, stored at cycle ${t}`;
    });
    cv.addEventListener('mouseleave', () => { fbHover = null; render(); });
  }

  function renderInspector(R, T) {
    const m = R.meta, WS = m.warpSize, NR = m.numRegs;
    if ($('followChk').checked) {
      let c = R.inflight(app.inspSm, T);
      if (!c) for (let s = 0; s < m.numSms && !c; s++) { c = R.inflight(s, T); if (c) app.inspSm = s; }
      if (c) app.inspWarp = c.w;
    }
    $('inspSm').value = app.inspSm; $('inspWarp').value = app.inspWarp;
    const sm = R.sms[app.inspSm]; const w = app.inspWarp;
    const c = R.inflight(app.inspSm, T);
    const lastW = sm.last && sm.last.w === w ? sm.last : null;
    const hex = hexMode();
    let html = '<thead><tr><th class="nm">reg</th>';
    for (let l = 0; l < WS; l++) html += `<th>L${l}</th>`;
    html += '</tr></thead><tbody>';
    const state = [];
    for (let l = 0; l < WS; l++) {
      const tid = w * WS + l;
      state.push(tid >= m.block || !sm.busy ? 'none' : sm.ldone[tid] ? 'exit' : (c && c.w === w && bit(c.act, l)) ? 'run' : 'wait');
    }
    html += '<tr class="st"><td class="nm">state</td>' + state.map(s => `<td>${s}</td>`).join('') + '</tr>';
    html += '<tr class="pcs"><td class="nm">PC</td>';
    for (let l = 0; l < WS; l++) html += `<td>${state[l] === 'none' || state[l] === 'exit' ? '-' : sm.lpc[w * WS + l]}</td>`;
    html += '</tr><tr><td class="nm">P3..P0</td>';
    for (let l = 0; l < WS; l++) html += `<td>${sm.preds[w * WS + l].toString(2).padStart(4, '0')}</td>`;
    html += '</tr>';
    for (let r = 0; r < NR; r++) {
      html += `<tr><td class="nm">R${r}</td>`;
      for (let l = 0; l < WS; l++) {
        const tid = w * WS + l; const v = sm.rf[tid * NR + r];
        const wr = lastW && lastW.wr && lastW.rd === r && bit(lastW.exe, l) && T - lastW.t <= 6;
        html += `<td class="${wr ? 'wr' : v === 0 ? 'x' : ''}">${fmtVal(v, hex)}</td>`;
      }
      html += '</tr>';
    }
    $('regTable').innerHTML = html + '</tbody>';

    // global memory regions
    const gv = $('gmemView'); let g = '';
    const regions = m.dump && m.dump.length ? m.dump : [];
    for (const dmp of regions) {
      g += `<div class="region"><div class="rlabel">0x${dmp.addr.toString(16)} [${dmp.count}] ${esc(dmp.label || '')}</div><div class="grid">`;
      for (let i = 0; i < dmp.count; i++) {
        const a = dmp.addr + i; const v = R.gmem.get(a) || 0; const t = R.gTouch.get(a);
        const cls = t === undefined ? '' : T - t <= 3 ? 'fresh' : 'new';
        g += `<div class="c ${cls} ${v === 0 && !cls ? 'z' : ''}" title="address ${a}">${fmtVal(v, hex)}</div>`;
      }
      g += '</div></div>';
    }
    gv.innerHTML = g || (m.fb ? '<p class="muted">This kernel\'s output is the framebuffer at the top of this panel.</p>' : '<p class="muted">No .dump region declared in this kernel.</p>');

    // shared memory of selected SM
    const used = Math.min(R.smemUsed[app.inspSm], 128);
    $('smemWhich').textContent = `(SM ${app.inspSm})`;
    const sv = $('smemView');
    if (!used) { sv.innerHTML = '<p class="muted">This kernel does not use shared memory.</p>'; return; }
    const rows = Math.ceil(used / m.smemBanks);
    let s = '<div class="grid">';
    for (let b = 0; b < m.smemBanks; b++) s += `<div class="bk">bank ${b}</div>`;
    for (let i = 0; i < rows * m.smemBanks; i++) {
      const v = sm.smem[i]; const t = sm.sTouch.get(i);
      const cls = t === undefined ? '' : T - t <= 3 ? 'fresh' : 'new';
      s += `<div class="c ${cls} ${v === 0 && !cls ? 'z' : ''}" title="shared[${i}]">${fmtVal(v, hex)}</div>`;
    }
    sv.innerHTML = s + '</div>';
  }

  // ---------------------------------------------------------------------------
  // timeline
  // ---------------------------------------------------------------------------
  function tlWindow() {
    const R = app.R; const total = Math.max(1, R.end + 1);
    const span = Math.max(20, total / app.zoom);
    let x0 = app.T - span / 2; x0 = Math.max(0, Math.min(total - span, x0));
    return { x0, span };
  }
  const TL_LABEL = 58;
  function drawTimeline() {
    const R = app.R; const cv = $('timeline'); if (!R || !cv) return;
    const m = R.meta; const dpr = window.devicePixelRatio || 1;
    const rows = m.numSms * m.numWarps;
    const cssH = Math.max(80, Math.min(160, rows * 14 + 10));
    cv.style.height = cssH + 'px';
    const Wd = cv.clientWidth; const Ht = cssH;
    if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Ht * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Ht * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wd, Ht);
    const { x0, span } = tlWindow();
    const plotW = Wd - TL_LABEL - 8; const rh = (Ht - 10) / rows;
    const X = (t) => TL_LABEL + (t - x0) / span * plotW;
    const col = { alu: cssVar('--green'), memory: cssVar('--amber'), control: cssVar('--blue'), warp: cssVar('--violet'), data: cssVar('--slate'), predicate: cssVar('--slate') };
    const ink2 = cssVar('--ink2'), line = cssVar('--line'), mag = cssVar('--magenta'), ink = cssVar('--ink');
    ctx.font = '11px ' + cssVar('--f-cond');
    for (let s = 0; s < m.numSms; s++) for (let w = 0; w < m.numWarps; w++) {
      const y = 5 + (s * m.numWarps + w) * rh;
      ctx.fillStyle = ink2; ctx.textBaseline = 'middle';
      ctx.fillText(`SM${s} W${w}`, 6, y + rh / 2);
      ctx.fillStyle = line; ctx.fillRect(TL_LABEL, y + rh - 1, plotW, 1);
    }
    for (const c of R.commits) {
      const x1 = X(c.st[0]), x2 = X(c.st[5] + 1);
      if (x2 < TL_LABEL || x1 > Wd) continue;
      const y = 5 + (c.sm * m.numWarps + c.w) * rh;
      ctx.fillStyle = col[c.d.e ? c.d.e.group : 'data'] || col.data;
      ctx.globalAlpha = popc(c.exe) ? 0.35 + 0.65 * popc(c.exe) / m.warpSize : 0.25;
      ctx.fillRect(Math.max(TL_LABEL, x1), y + 1, Math.max(1, x2 - Math.max(TL_LABEL, x1) - (plotW / span > 3 ? 1 : 0)), rh - 3);
      ctx.globalAlpha = 1;
      if (c.div) { ctx.fillStyle = mag; ctx.fillRect(Math.max(TL_LABEL, x1), y, Math.max(2, x2 - Math.max(TL_LABEL, x1)), 3); }
    }
    for (const b of R.bars) { const x = X(b.t); if (x >= TL_LABEL && x <= Wd) { ctx.fillStyle = mag; ctx.fillRect(x, 5 + b.sm * m.numWarps * rh, 1.5, m.numWarps * rh); } }
    // cursor
    const cx = X(app.T);
    ctx.fillStyle = ink; ctx.fillRect(cx - 1, 0, 2, Ht);
  }
  function onTimelineClick(e) {
    const cv = $('timeline'); const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left; if (x < TL_LABEL) return;
    const { x0, span } = tlWindow(); const plotW = cv.clientWidth - TL_LABEL - 8;
    stop(); seek(x0 + (x - TL_LABEL) / plotW * span);
  }


  // ---------------------------------------------------------------------------
  // guided tour: each stop finds its moment in whatever trace is loaded
  // ---------------------------------------------------------------------------
  const first = (R, f) => R.commits.find(f);
  const TOUR = [
    { k: 'vector_add', title: 'Meet the machine', at: (R) => first(R, c => c.sm === 0).st[0],
      text: 'Two Streaming Multiprocessors (SMs) sit side by side, each with a warp scheduler, 8 execution lanes, a load/store unit and shared memory. The block dispatcher has just handed block 0 to SM 0 and block 1 to SM 1. Every box you see is a module or register in <code>rtl/ps_sm.v</code>.' },
    { k: 'vector_add', title: 'One instruction, eight threads', at: (R) => first(R, c => c.sm === 0 && c.d.name === 'MAD').st[3],
      text: '<code>MAD R3, R0, R1, R2</code> computes <code>i = blockIdx.x * blockDim.x + threadIdx.x</code>. It was fetched and decoded once, and now all 8 lanes execute it on their own registers. That sharing is SIMT (Single Instruction, Multiple Threads). Check the register table on the right: R3 differs per lane.' },
    { k: 'vector_add', title: 'Coalescing and DRAM latency', at: (R) => first(R, c => c.sm === 0 && c.d.name === 'LDG').st[4] + 4,
      text: 'The 8 lanes want 8 consecutive words. The load/store unit groups them by 4-word line: 2 transactions instead of 8. The DRAM (Dynamic Random-Access Memory) box shows the request in flight, and the other SM queues behind it at the arbiter. The whole warp waits here; a real GPU would switch to another warp.' },
    { k: 'divergence', title: 'The warp splits', at: (R) => first(R, c => c.d.isBranch && c.exe && c.exe !== c.act).st[3],
      text: '<code>@!P0 BRA even</code>: even lanes take the branch, odd lanes fall through. One warp now has two program counters. Watch the dots in the warp scheduler turn magenta for lanes that are not at the lowest PC.' },
    { k: 'divergence', title: 'Min-PC picks who runs', at: (R) => first(R, c => c.d.name === 'SHRI').st[0],
      text: 'The scheduler always issues the lowest PC among a warp\'s live lanes. The odd path already finished, so now the even lanes run <code>SHRI</code> while the odd lanes wait (dashed magenta). At the join point both halves have the same PC and run together again.' },
    { k: 'bank_conflicts', title: 'An 8-way bank conflict', at: (R) => first(R, c => c.d.name === 'LDS' && c.txn === 8).st[4] + 2,
      text: 'Every lane reads <code>s[8t]</code>: all 8 addresses live in bank 0. A bank delivers one word per cycle, so the load takes 8 passes. The bank row shows the lane being served and how many are queued. Compare the next <code>LDS</code>, which is a single-pass broadcast.' },
    { k: 'reduction_shared', title: 'A barrier releases', at: (R) => R.bars[0].t,
      text: '<code>BAR</code> is <code>__syncthreads()</code>. Each warp that reached it was parked (magenta row in the scheduler). The last warp just arrived, so all four are released in one cycle. The timeline marks every release with a magenta line.' },
    { k: 'reduction_shuffle', title: 'Registers move between lanes', at: (R) => first(R, c => c.d.name === 'SHFL').st[3],
      text: '<code>SHFL.DOWN R6, R5, 4</code>: lane l reads R5 of lane l+4 through the shuffle crossbar, with no memory access at all. Three shuffles and three adds sum a whole warp. CUDA calls this <code>__shfl_down_sync</code>.' },
    { k: 'vote_ballot', title: 'The warp votes', at: (R) => first(R, c => c.d.name === 'VOTE').st[3],
      text: '<code>VOTE.BALLOT</code> collects one predicate bit from every lane into an 8-bit mask in a single instruction: this is <code>__ballot_sync</code>. Followed by <code>POPC</code> it counts how many threads said yes.' },
    { k: 'triangle_raster', title: 'Rasterizing a triangle', at: (R) => { const n = R.commits.filter(c => c.d.name === 'STG'); return n[Math.floor(n.length * 0.55)].t; },
      text: 'This is how every 3D frame is drawn: one thread per pixel evaluates three <em>edge functions</em>. All three non-negative means the pixel center is inside the triangle, and the three values, divided by the area, are the barycentric weights that blend red, green and blue. Inside or outside is a predicate (<code>@!P0 MOV</code>), not a branch, so warps never diverge. Watch the framebuffer fill in row by row.' },
    { k: 'mandelbrot', title: 'A storm of pixels, and divergence', at: (R) => { const n = R.commits.filter(c => c.div); return n[Math.floor(n.length * 0.5)].st[3]; },
      text: 'Each pixel iterates <code>z = z*z + c</code> until it escapes, and neighbouring pixels need very different iteration counts. A warp keeps looping until its slowest lane is done, with the finished lanes parked at <code>done:</code> (dashed magenta). The whole-kernel SIMD efficiency is about 73%. The Pixels and warps lab shows how the shape of a warp changes that number.' },
    { k: 'matmul', title: 'The big picture', at: (R) => R.end,
      text: 'Matrix multiply, the core of deep learning, finished. The timeline shows every warp instruction on both SMs: long amber bars are memory waits. Look at the stats: IPC (Instructions Per Cycle) is far below 1. Pipelining, latency hiding and caches, the exercises in <code>docs/12-make-it-better.md</code>, are how real GPUs close that gap. Try them in the Labs page.' },
  ];
  let tourIdx = -1;
  async function goTour(i) {
    tourIdx = Math.max(0, Math.min(TOUR.length - 1, i));
    const s = TOUR[tourIdx];
    stop();
    const ki = app.examples.findIndex(ex => kernelKey(ex) === s.k);
    if (ki >= 0 && (!app.R || app.R.meta.kernel !== s.k)) { $('kernelSel').value = ki; await loadKernel(ki); }
    let t = 0; try { t = s.at(app.R); } catch (e) { t = 0; }
    $('followChk').checked = true;
    seek(t);
    $('tour').hidden = false;
    $('tourStep').textContent = `${tourIdx + 1} / ${TOUR.length}`;
    $('tourTitle').textContent = s.title;
    $('tourText').innerHTML = s.text;
    $('tourPrev').disabled = tourIdx === 0;
    $('tourNext').textContent = tourIdx === TOUR.length - 1 ? 'Finish' : 'Next stop';
    $('tour').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function initTour() {
    $('tourBtn').onclick = () => goTour(0);
    $('tourNext').onclick = () => { if (tourIdx >= TOUR.length - 1) { $('tour').hidden = true; tourIdx = -1; } else goTour(tourIdx + 1); };
    $('tourPrev').onclick = () => goTour(tourIdx - 1);
    $('tourClose').onclick = () => { $('tour').hidden = true; tourIdx = -1; };
    if (/[?&]tour/.test(location.search)) goTour(0);
  }

  window.PSAPP = { app, seek, Replay, memPlan, goTour, TOUR };
  document.addEventListener('DOMContentLoaded', init);
})();
