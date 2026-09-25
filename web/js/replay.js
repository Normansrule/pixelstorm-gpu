/* =============================================================================
 * replay.js — rebuild the GPU's architectural state at any cycle of a trace.
 * Shared by the 2D visualizer (app.js) and the 3D chip explorer (chip.js).
 *
 *   const R = new PSREPLAY.Replay(trace);   // trace = {meta, events}
 *   R.seek(cycle);                           // registers, predicates, PCs, memory
 *   R.inflight(sm, cycle);                   // the instruction occupying an SM
 *   PSREPLAY.stageOf(commit, cycle);         // 0..5 = SCHED FETCH DECODE EXEC MEM WB
 * ========================================================================== */
(function (root) {
  'use strict';
  const W = root.PIXELSTORM;
  const bit = (m, i) => (m >>> i) & 1;
  const popc = (m) => W.popcount(m >>> 0);
  const lanesList = (mask, n) => { const o = []; for (let i = 0; i < n; i++) if (bit(mask, i)) o.push(i); return o; };

  // ---------------------------------------------------------------------------
  // Replay: architectural state at any cycle
  // ---------------------------------------------------------------------------
  class Replay {
    constructor(trace) {
      this.meta = trace.meta;
      const m = this.meta;
      this.WS = m.warpSize; this.NW = m.numWarps; this.NR = m.numRegs; this.NT = this.WS * this.NW;
      // stable sort by time, SM
      this.events = trace.events.map((e, i) => [e, i]).sort((a, b) => (a[0].t - b[0].t) || ((a[0].sm || 0) - (b[0].sm || 0)) || (a[1] - b[1])).map(x => x[0]);
      this.commits = []; this.bySm = []; this.mreqs = []; this.bars = []; this.blks = [];
      for (let s = 0; s < m.numSms; s++) this.bySm.push([]);
      for (const e of this.events) {
        if (e.ev === 'commit') { e.d = W.decode(e.ir); this.commits.push(e); this.bySm[e.sm].push(e); }
        else if (e.ev === 'mreq') this.mreqs.push(e);
        else if (e.ev === 'bar') this.bars.push(e);
        else if (e.ev === 'blk') this.blks.push(e);
      }
      const done = this.events.find(e => e.ev === 'done');
      this.end = done ? done.t : (this.events.length ? this.events[this.events.length - 1].t + 1 : 0);
      // which shared-memory words ever get written (to keep the view compact)
      this.smemUsed = [];
      for (let s = 0; s < m.numSms; s++) this.smemUsed.push(0);
      for (const e of this.events) if (e.ev === 'sw') this.smemUsed[e.sm] = Math.max(this.smemUsed[e.sm], e.a + 1);
      this.reset();
      this.seek(this.end + 1);   // one full pass marks divergent issues for the timeline
      this.reset();
    }
    reset() {
      const m = this.meta;
      this.sms = [];
      for (let s = 0; s < m.numSms; s++) {
        this.sms.push({
          rf: new Uint32Array(this.NT * this.NR), preds: new Uint8Array(this.NT),
          lpc: new Int32Array(this.NT), ldone: new Uint8Array(this.NT).fill(1),
          wait: new Uint8Array(this.NW), blk: -1, busy: false, blocksDone: 0,
          smem: new Uint32Array(m.smemWords), sTouch: new Map(), last: null,
        });
      }
      this.gmem = new Map();
      for (const k in m.gmemInit) this.gmem.set(+k, m.gmemInit[k] >>> 0);
      this.gTouch = new Map();
      this.stats = { instr: 0, laneOps: 0, slots: 0, txns: 0, divergent: 0, blocksStarted: 0 };
      this.ptr = 0; this.T = 0;
    }
    seek(T) {
      if (T < this.T) this.reset();
      const ev = this.events;
      while (this.ptr < ev.length && ev[this.ptr].t < T) this.apply(ev[this.ptr++]);
      this.T = T;
    }
    apply(e) {
      const WS = this.WS, NR = this.NR;
      switch (e.ev) {
        case 'blk': {
          const sm = this.sms[e.sm];
          if (e.ph === 'start') {
            sm.blk = e.blk; sm.busy = true; this.stats.blocksStarted++;
            for (let i = 0; i < this.NT; i++) { sm.ldone[i] = i >= this.meta.block ? 1 : 0; sm.lpc[i] = 0; sm.preds[i] = 0; }
            sm.wait.fill(0);
          } else { sm.busy = false; sm.blocksDone++; }
          break;
        }
        case 'bar': this.sms[e.sm].wait.fill(0); break;
        case 'commit': {
          const sm = this.sms[e.sm]; const d = e.d; const w = e.w;
          let liveBefore = 0;
          for (let l = 0; l < WS; l++) if (!sm.ldone[w * WS + l]) liveBefore++;
          for (let l = 0; l < WS; l++) {
            const tid = w * WS + l;
            if (bit(e.exe, l) && e.wr) sm.rf[tid * NR + e.rd] = e.v[l] >>> 0;
            if (bit(e.exe, l) && e.pw) { const pb = e.rd & 3; sm.preds[tid] = (sm.preds[tid] & ~(1 << pb)) | (bit(e.pv, l) << pb); }
            sm.lpc[tid] = e.lpc[l]; sm.ldone[tid] = bit(e.done, l);
          }
          if (d.isBar) sm.wait[w] = 1;
          sm.last = e;
          this.stats.instr++; this.stats.laneOps += popc(e.exe); this.stats.slots += WS; this.stats.txns += e.txn || 0;
          e.div = popc(e.act) < liveBefore && !d.isExit;
          if (e.div) this.stats.divergent++;
          break;
        }
        case 'gw': this.gmem.set(e.a, e.v >>> 0); this.gTouch.set(e.a, e.t); break;
        case 'sw': { const sm = this.sms[e.sm]; sm.smem[e.a] = e.v >>> 0; sm.sTouch.set(e.a, e.t); break; }
        default: break;
      }
    }
    /** instruction occupying SM s at cycle T (or null) */
    inflight(s, T) {
      const arr = this.bySm[s];
      let lo = 0, hi = arr.length - 1, ans = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].st[5] >= T) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
      if (ans < 0) return null;
      const c = arr[ans];
      return c.st[0] <= T ? c : null;
    }
    nextCommitAfter(T) {
      let best = Infinity;
      for (const arr of this.bySm) {
        let lo = 0, hi = arr.length - 1, ans = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].t > T) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
        if (ans >= 0) best = Math.min(best, arr[ans].t);
      }
      return best;
    }
  }

  function stageOf(c, T) {
    const st = c.st;
    if (T >= st[5]) return 5;
    if (st[4] && T >= st[4]) return 4;
    if (T >= st[3]) return 3;
    if (T >= st[2]) return 2;
    if (T >= st[1]) return 1;
    return 0;
  }

  /** Recreate how the load/store unit splits the lanes into transactions / bank passes. */
  function memPlan(c, meta) {
    const d = c.d; const WS = meta.warpSize; const L = meta.lineWords; const NB = meta.smemBanks;
    const group = new Array(WS).fill(-1); const info = [];
    let pend = lanesList(c.exe, WS);
    let k = 0;
    while (pend.length && k < 64) {
      const leader = pend[0]; let serve;
      if (d.isShared) {
        if (d.isAtom) serve = [leader];
        else {
          const used = {}; serve = [];
          for (const l of pend) {
            const a = c.addr[l] & (meta.smemWords - 1); const b = a & (NB - 1);
            if (!(b in used)) { used[b] = a; serve.push(l); } else if (used[b] === a) serve.push(l);
          }
        }
        const banks = [...new Set(serve.map(l => c.addr[l] & (NB - 1)))];
        info.push({ lanes: serve, banks });
      } else {
        const line = (c.addr[leader] & ~(L - 1)) >>> 0;
        serve = d.isAtom ? [leader] : pend.filter(l => ((c.addr[l] & ~(L - 1)) >>> 0) === line);
        info.push({ lanes: serve, line: d.isAtom ? c.addr[leader] : line });
      }
      for (const l of serve) group[l] = k;
      pend = pend.filter(l => !serve.includes(l));
      k++;
    }
    return { group, info, n: info.length };
  }

  root.PSREPLAY = { Replay, stageOf, memPlan };
})(typeof window !== 'undefined' ? window : globalThis);
