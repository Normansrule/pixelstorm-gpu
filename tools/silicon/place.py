#!/usr/bin/env python3
"""
tools/silicon/place.py — turn the synthesized Pixelstorm netlist into a real
SkyWater 130 nm layout (GDS) you can open in KLayout.

    make silicon        # fetch PDK, synthesize, place, render
    klayout build/silicon/ps_s130.gds

What it does (the first half of a real physical-design flow):
  1. flatten      walk the Yosys JSON hierarchy; give every standard cell a
                  global instance with its nets, and attribute it to a block
                  (register file, shared memory, lanes, control, ...)
  2. floorplan    size a rectangle for every block at a target utilization
                  and slice the die into them
  3. global place a few rounds of force-directed placement (each cell moves
                  toward the centroid of the nets it touches) with spreading
  4. legalize     snap cells into real sky130 rows (0.46 um sites, 2.72 um
                  rows, alternating N / FS orientation), then fill every gap
                  with tap, decap and filler cells, as a real flow does
  5. write GDS    instances of the real sky130_fd_sc_hd cell layouts, plus a
                  die boundary, power ring and stripes, and I/O pins

What it does NOT do: routing, clock-tree synthesis, timing closure, DRC/LVS.
Those are what OpenROAD / OpenLane do next (docs/14-silicon.md).
"""
import json, math, os, random, re, sys, time
from collections import defaultdict, Counter
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = os.path.join(ROOT, 'build')
PDK = os.path.join(B, 'pdk')
OUT = os.path.join(B, 'silicon')
SITE, ROW = 0.46, 2.72
UTIL = 0.58
random.seed(7); np.random.seed(7)
t0 = time.time()
def log(*a): print(f'[{time.time() - t0:6.1f}s]', *a, flush=True)

# ---------------------------------------------------------------------------- LEF sizes
size = {}
cur = None
for line in open(os.path.join(PDK, 'sky130_fd_sc_hd_merged.lef')):
    m = re.match(r'\s*MACRO\s+(\S+)', line)
    if m: cur = m.group(1); continue
    m = re.match(r'\s*SIZE\s+([\d.]+)\s+BY\s+([\d.]+)', line)
    if m and cur: size[cur] = (float(m.group(1)), float(m.group(2))); cur = None
log(f'{len(size)} cell sizes from LEF')

# ---------------------------------------------------------------------------- 1. flatten
d = json.load(open(os.path.join(OUT, 'ps_s130.json')))
mods = d['modules']
names_cache = {}
def bitnames(mn):
    if mn not in names_cache:
        bn = {}
        for n, v in mods[mn]['netnames'].items():
            for b in v['bits']:
                if isinstance(b, int) and (b not in bn or (bn[b].startswith('$') and not n.startswith('$'))): bn[b] = n
        names_cache[mn] = bn
    return names_cache[mn]
inst_type, inst_group, inst_nets, inst_path = [], [], [], []
nid = [0]
def new_net(): nid[0] += 1; return nid[0]
def flatten(mn, bitmap, path, ctx):
    m = mods[mn]
    def g(b):
        if isinstance(b, str): return None
        if b not in bitmap: bitmap[b] = new_net()
        return bitmap[b]
    bn = bitnames(mn)
    for cname, c in m['cells'].items():
        t = c['type']
        if t in mods:
            sub = mods[t]; sb = {}
            for pname, bits in c['connections'].items():
                for s, b in zip(sub['ports'][pname]['bits'], bits):
                    gid = g(b)
                    if gid is not None and isinstance(s, int): sb[s] = gid
            c2 = dict(ctx)
            mm = re.match(r'g_sm\[(\d+)\]\.u_sm', cname)
            if mm: c2['sm'] = int(mm.group(1))
            mm = re.match(r'lane\[(\d+)\]\.u_alu', cname)
            if mm: c2['lane'] = int(mm.group(1))
            if cname == 'u_arb': c2['blk'] = 'arb'
            if cname == 'u_disp': c2['blk'] = 'disp'
            if cname == 'u_dec': c2['blk'] = 'ctrl'
            flatten(t, sb, path + [cname], c2)
            continue
        nets = [g(b) for p, bits in c['connections'].items() for b in bits]
        nets = [n for n in nets if n is not None]
        # --- which block does this cell belong to?
        grp = None
        if 'lane' in ctx: grp = f"sm{ctx['sm']}.lane{ctx['lane']}"
        elif ctx.get('blk') in ('arb', 'disp'): grp = ctx['blk']
        elif ctx.get('blk') == 'ctrl': grp = f"sm{ctx['sm']}.ctrl"
        elif 'dfxtp' in t or 'dfrtp' in t or 'dfstp' in t or 'edfxtp' in t or 'dfbbp' in t or 'dlxtp' in t:
            q = c['connections'].get('Q', [None])[0]
            nm = bn.get(q, '') if isinstance(q, int) else ''
            if 'sm' in ctx:
                grp = f"sm{ctx['sm']}." + ('rf' if nm.startswith('rf') else 'smem' if 'smem' in nm else 'ctrl')
            else:
                grp = 'imem' if 'imem' in nm else 'cmem' if 'cmem' in nm else 'top'
        inst_type.append(t); inst_group.append(grp); inst_nets.append(nets)
        inst_path.append('.'.join(path + [cname]) if len(inst_path) < 0 else None)
        if grp is None: inst_group[-1] = ('?sm%d' % ctx['sm']) if 'sm' in ctx else '?top'

top = d['modules']['ps_s130_top']
flatten('ps_s130_top', {}, [], {})
N = len(inst_type)
log(f'{N} standard cells, {nid[0]} nets')

# ---------------------------------------------------------------------------- pins, net degrees
pin_cell = np.fromiter((i for i, ns in enumerate(inst_nets) for _ in ns), dtype=np.int64)
pin_net = np.fromiter((n for ns in inst_nets for n in ns), dtype=np.int64)
deg = np.bincount(pin_net, minlength=nid[0] + 1)
keep = (deg[pin_net] >= 2) & (deg[pin_net] <= 48)          # ignore huge nets (clock, reset) in placement
pc, pn = pin_cell[keep], pin_net[keep]

# resolve unattributed logic by majority vote of neighbours (a few passes)
grp = np.array(inst_group, dtype=object)
for it in range(4):
    unknown = np.array([g.startswith('?') for g in grp])
    if not unknown.any(): break
    net_votes = defaultdict(Counter)
    for c, n in zip(pc, pn):
        g_ = grp[c]
        if not g_.startswith('?'): net_votes[n][g_] += 1
    cell_votes = defaultdict(Counter)
    for c, n in zip(pc, pn):
        if unknown[c] and n in net_votes: cell_votes[c].update(net_votes[n])
    for c in np.nonzero(unknown)[0]:
        scope = grp[c][1:]
        cv = cell_votes.get(c)
        if cv:
            opts = [(k, v) for k, v in cv.items() if (scope == 'top' and not k.startswith('sm')) or k.startswith(scope + '.')]
            if opts: grp[c] = max(opts, key=lambda kv: kv[1])[0]; continue
        if it == 3: grp[c] = (scope + '.ctrl') if scope.startswith('sm') else 'top'
log('block attribution:', dict(Counter(grp)))

w_cell = np.array([size.get(t, (1.38, ROW))[0] for t in inst_type])
area = defaultdict(float)
for g_, w in zip(grp, w_cell): area[g_] += w * ROW

# ---------------------------------------------------------------------------- 2. floorplan (slicing)
def rows_for(a, width): return max(2, math.ceil(a / UTIL / width / ROW))
sm_blocks = ['rf', 'lane0', 'lane1', 'lane2', 'lane3', 'smem', 'ctrl']
sm_area = [sum(area.get(f'sm{s}.{b}', 0) for b in sm_blocks) for s in (0, 1)]
total = sum(area.values()) / UTIL
core_w = math.ceil(math.sqrt(total) * 1.08 / SITE) * SITE
sm_w = math.floor(core_w / 2 / SITE) * SITE
rects = {}
y = 0.0
bottom = [('arb', area['arb']), ('top', area['top']), ('disp', area['disp'])]
h = rows_for(sum(a for _, a in bottom), core_w) * ROW
x = 0.0
for i, (k, a) in enumerate(bottom):
    ww = core_w - x if i == len(bottom) - 1 else math.floor(core_w * a / sum(v for _, v in bottom) / SITE) * SITE
    rects[k] = (x, y, ww, h); x += ww
y += h
sm_y0 = y; sm_h = 0
for s in (0, 1):
    x0 = s * sm_w; yy = sm_y0
    ww = sm_w if s == 0 else core_w - sm_w
    hb = rows_for(area[f'sm{s}.smem'] + area[f'sm{s}.ctrl'], ww) * ROW
    fr = area[f'sm{s}.smem'] / (area[f'sm{s}.smem'] + area[f'sm{s}.ctrl'])
    sw = math.floor(ww * fr / SITE) * SITE
    rects[f'sm{s}.smem'] = (x0, yy, sw, hb); rects[f'sm{s}.ctrl'] = (x0 + sw, yy, ww - sw, hb); yy += hb
    la = sum(area[f'sm{s}.lane{l}'] for l in range(4)); hl = rows_for(la, ww) * ROW
    lw = math.floor(ww / 4 / SITE) * SITE
    for l in range(4): rects[f'sm{s}.lane{l}'] = (x0 + l * lw, yy, lw if l < 3 else ww - 3 * lw, hl)
    yy += hl
    hr = rows_for(area[f'sm{s}.rf'], ww) * ROW
    rects[f'sm{s}.rf'] = (x0, yy, ww, hr); yy += hr
    sm_h = max(sm_h, yy - sm_y0)
for s in (0, 1):                                   # make both SMs the same height: grow the register file band
    x0, y0, ww, hh = rects[f'sm{s}.rf']; rects[f'sm{s}.rf'] = (x0, y0, ww, sm_y0 + sm_h - y0)
y = sm_y0 + sm_h
topb = [('imem', area['imem']), ('cmem', area['cmem'])]
h = rows_for(sum(a for _, a in topb), core_w) * ROW
fr = area['imem'] / (area['imem'] + area['cmem'])
iw = math.floor(core_w * fr / SITE) * SITE
rects['imem'] = (0, y, iw, h); rects['cmem'] = (iw, y, core_w - iw, h); y += h
core_h = y
MARGIN = 60.0
die_w, die_h = core_w + 2 * MARGIN, core_h + 2 * MARGIN
log(f'core {core_w:.1f} x {core_h:.1f} um, die {die_w:.1f} x {die_h:.1f} um')

# ---------------------------------------------------------------------------- 3. global placement
gi = {g_: i for i, g_ in enumerate(sorted(rects))}
cg = np.array([gi[g_] for g_ in grp])
R = np.array([rects[g_] for g_ in sorted(rects)])
rx0, ry0, rw, rh = R[cg, 0], R[cg, 1], R[cg, 2], R[cg, 3]
px = rx0 + np.random.rand(N) * rw
py = ry0 + np.random.rand(N) * rh
cnt = np.bincount(pn, minlength=nid[0] + 1).astype(float); cnt[cnt == 0] = 1
cdeg = np.bincount(pc, minlength=N).astype(float); has = cdeg > 0; cdeg[~has] = 1
order_by_group = [np.nonzero(cg == k)[0] for k in range(len(gi))]
for it in range(10):
    cx = np.bincount(pn, weights=px[pc], minlength=nid[0] + 1) / cnt
    cy = np.bincount(pn, weights=py[pc], minlength=nid[0] + 1) / cnt
    tx = np.bincount(pc, weights=cx[pn], minlength=N) / cdeg
    ty = np.bincount(pc, weights=cy[pn], minlength=N) / cdeg
    tx = np.where(has, tx, px); ty = np.where(has, ty, py)
    px = np.clip(0.5 * px + 0.5 * tx, rx0, rx0 + rw); py = np.clip(0.5 * py + 0.5 * ty, ry0, ry0 + rh)
    for idx in order_by_group:                    # spreading: keep order, even out density
        if len(idx) < 2: continue
        n = len(idx); u = (np.arange(n) + 0.5) / n
        ox = np.empty(n); ox[np.argsort(px[idx])] = u
        oy = np.empty(n); oy[np.argsort(py[idx])] = u
        k = 0.6
        px[idx] = (1 - k) * px[idx] + k * (rx0[idx] + ox * rw[idx])
        py[idx] = (1 - k) * py[idx] + k * (ry0[idx] + oy * rh[idx])
log('global placement done')

# ---------------------------------------------------------------------------- 4. legalize + fill
placed = []                     # (cell_type, x, y, flipped)
FILL = sorted([(size[c][0], c) for c in ['sky130_fd_sc_hd__decap_12', 'sky130_fd_sc_hd__decap_8', 'sky130_fd_sc_hd__decap_6', 'sky130_fd_sc_hd__decap_4', 'sky130_fd_sc_hd__decap_3', 'sky130_fd_sc_hd__fill_2', 'sky130_fd_sc_hd__fill_1'] if c in size], reverse=True)
TAP = 'sky130_fd_sc_hd__tapvpwrvgnd_1'; TAPW = size[TAP][0]; TAP_PITCH = 13.8
fillers = Counter()
def fill_gap(x, x_end, yy, fl, last_tap):
    while x_end - x > 1e-6:
        if x - last_tap >= TAP_PITCH and x_end - x >= TAPW - 1e-6:
            placed.append((TAP, x, yy, fl)); fillers[TAP] += 1; last_tap = x; x += TAPW; continue
        for w, c in FILL:
            if w <= x_end - x + 1e-6: placed.append((c, x, yy, fl)); fillers[c] += 1; x += w; break
        else: break
    return last_tap
snap = lambda v: round(v / SITE) * SITE
for k, idx in enumerate(order_by_group):
    x0, y0, ww, hh = R[k]; nrows = int(round(hh / ROW))
    if len(idx) == 0:
        for r in range(nrows): fill_gap(x0, x0 + ww, y0 + r * ROW, int(round((y0 + r * ROW) / ROW)) % 2 == 1, x0 - TAP_PITCH)
        continue
    idx = idx[np.argsort(py[idx])]
    widths = w_cell[idx]; total_w = widths.sum()
    cap = total_w / nrows
    rows = [[] for _ in range(nrows)]; acc = 0.0
    for i, c in enumerate(idx):
        r = min(nrows - 1, int(acc / cap)); rows[r].append(c); acc += widths[i]
    for r, cells in enumerate(rows):
        yy = y0 + r * ROW; fl = int(round(yy / ROW)) % 2 == 1
        cells = sorted(cells, key=lambda c: px[c])
        remaining = sum(w_cell[c] for c in cells) + TAPW * math.ceil(ww / TAP_PITCH)
        x = x0; last_tap = x0 - TAP_PITCH
        for c in cells:
            want = snap(min(max(px[c], x), x0 + ww - remaining))
            want = max(want, x)
            if want > x: last_tap = fill_gap(x, want, yy, fl, last_tap); x = want
            if x - last_tap >= TAP_PITCH:
                placed.append((TAP, x, yy, fl)); fillers[TAP] += 1; last_tap = x; x += TAPW; remaining -= TAPW
            placed.append((inst_type[c], x, yy, fl)); x += w_cell[c]; remaining -= w_cell[c]
        fill_gap(x, x0 + ww, yy, fl, last_tap)
log(f'legalized: {N} logic cells + {sum(fillers.values())} tap/decap/fill cells')

# ---------------------------------------------------------------------------- 5. GDS
import klayout.db as db
ly = db.Layout()
ly.read(os.path.join(PDK, 'sky130_fd_sc_hd.gds'))
ly.dbu = ly.dbu
lib = {ly.cell(ci).name: ci for ci in range(ly.cells())}
topc = ly.create_cell('ps_s130_top')
missing = Counter()
for (t, x, yy, fl) in placed:
    ci = lib.get(t)
    if ci is None: missing[t] += 1; continue
    X, Y = x + MARGIN, yy + MARGIN
    tr = db.DCplxTrans(1, 0, True, X, Y + ROW) if fl else db.DCplxTrans(1, 0, False, X, Y)
    topc.insert(db.DCellInstArray(ci, tr))
if missing: log('missing cell layouts:', dict(missing))
L = lambda l, dt: ly.layer(l, dt)
topc.shapes(L(235, 4)).insert(db.DBox(0, 0, die_w, die_h))                      # prBoundary
m4, m5, m3, m3p, txt = L(71, 20), L(72, 20), L(70, 20), L(70, 16), L(70, 5)
cx0, cy0, cx1, cy1 = MARGIN, MARGIN, MARGIN + core_w, MARGIN + core_h
RING = 5.0
for off, lay in ((8, m4), (16, m5)):                                            # power ring (VDD / VSS)
    for o in (off, off + RING + 2):
        topc.shapes(lay).insert(db.DBox(cx0 - o - RING, cy0 - o - RING, cx1 + o + RING, cy0 - o))
        topc.shapes(lay).insert(db.DBox(cx0 - o - RING, cy1 + o, cx1 + o + RING, cy1 + o + RING))
        topc.shapes(lay).insert(db.DBox(cx0 - o - RING, cy0 - o, cx0 - o, cy1 + o))
        topc.shapes(lay).insert(db.DBox(cx1 + o, cy0 - o, cx1 + o + RING, cy1 + o))
x = cx0 + 20
while x < cx1 - 5: topc.shapes(m4).insert(db.DBox(x, cy0 - 20, x + 1.6, cy1 + 20)); topc.shapes(m4).insert(db.DBox(x + 5, cy0 - 20, x + 6.6, cy1 + 20)); x += 55
y = cy0 + 25
while y < cy1 - 5: topc.shapes(m5).insert(db.DBox(cx0 - 28, y, cx1 + 28, y + 1.6)); topc.shapes(m5).insert(db.DBox(cx0 - 28, y + 5, cx1 + 28, y + 6.6)); y += 60
# I/O pins around the edge, named after the top-level ports
ports = [(p, i) for p, v in top['ports'].items() for i in range(len(v['bits']))]
per_side = math.ceil(len(ports) / 4)
for k, (p, i) in enumerate(ports):
    side, j = divmod(k, per_side); f = (j + 0.5) / per_side
    if side == 0: bx = db.DBox(MARGIN + f * core_w - 0.3, 0, MARGIN + f * core_w + 0.3, 2.0)
    elif side == 1: bx = db.DBox(die_w - 2.0, MARGIN + f * core_h - 0.3, die_w, MARGIN + f * core_h + 0.3)
    elif side == 2: bx = db.DBox(MARGIN + (1 - f) * core_w - 0.3, die_h - 2.0, MARGIN + (1 - f) * core_w + 0.3, die_h)
    else: bx = db.DBox(0, MARGIN + (1 - f) * core_h - 0.3, 2.0, MARGIN + (1 - f) * core_h + 0.3)
    topc.shapes(m3).insert(bx); topc.shapes(m3p).insert(bx)
    topc.shapes(txt).insert(db.DText(f'{p}[{i}]' if len(top['ports'][p]['bits']) > 1 else p, bx.center().x, bx.center().y))
# block overlay on a documentation layer (250/0) + labels (250/1): hidden in the default view
LABEL = {'rf': 'register file', 'smem': 'shared memory', 'ctrl': 'scheduler + LSU + control', 'imem': 'instruction memory', 'cmem': 'constants', 'arb': 'memory arbiter', 'disp': 'dispatcher', 'top': 'top-level'}
ov, ovt = L(250, 0), L(250, 1)
for g_, (x0, y0, ww, hh) in rects.items():
    topc.shapes(ov).insert(db.DBox(x0 + MARGIN, y0 + MARGIN, x0 + MARGIN + ww, y0 + MARGIN + hh))
    nm = g_.split('.')[-1]; nm = ('lane ' + nm[4:]) if nm.startswith('lane') else LABEL.get(nm, nm)
    pre = (g_.split('.')[0].upper().replace('SM', 'SM ') + ' ') if g_.startswith('sm') else ''
    topc.shapes(ovt).insert(db.DText(pre + nm, x0 + MARGIN + ww / 2, y0 + MARGIN + hh / 2))
for c in list(ly.top_cells()):                                   # drop library cells nothing uses
    if c.cell_index() != topc.cell_index(): ly.delete_cell_rec(c.cell_index())
gds = os.path.join(OUT, 'ps_s130.gds')
opt = db.SaveLayoutOptions(); opt.gds2_max_cellname_length = 64
ly.write(gds)
log(f'wrote {gds} ({os.path.getsize(gds) / 1e6:.1f} MB)')

# ---------------------------------------------------------------------------- report
stat = open(os.path.join(OUT, 'stat.txt')).read()
m = re.search(r"Chip area for top module '\\\\ps_s130_top': ([\d.]+)", stat)
cell_area = float(m.group(1)) if m else float(sum(area.values()))
types = Counter(inst_type)
flops = sum(v for k, v in types.items() if re.search(r'df|dl', k))
def pretty(g_):
    nm = g_.split('.')[-1]; nm = ('lane ' + nm[4:]) if nm.startswith('lane') else LABEL.get(nm, nm)
    return ((g_.split('.')[0].upper().replace('SM', 'SM ') + ' ') if g_.startswith('sm') else '') + nm
rep = {
    'config': 'ps_s130: 2 SMs, 2 warps x 4 lanes, 8 registers, 32-word shared memory, 64-instruction memory',
    'process': 'SkyWater 130 nm, sky130_fd_sc_hd (high density) standard cells, typical corner 25 C 1.80 V',
    'cells': N, 'flops': flops, 'fillers': sum(fillers.values()),
    'cell_area_um2': round(cell_area), 'core_um': [round(core_w, 2), round(core_h, 2)], 'die_um': [round(die_w, 2), round(die_h, 2)],
    'die_mm2': round(die_w * die_h / 1e6, 3), 'utilization': round(cell_area / (core_w * core_h), 3),
    'blocks': [{'id': g_, 'name': pretty(g_), 'cells': int((grp == g_).sum()), 'area_um2': round(area[g_]),
                'rect_um': [round(v + (MARGIN if i < 2 else 0), 2) for i, v in enumerate(rects[g_])]} for g_ in sorted(rects)],
    'top_cell_types': [[k.replace('sky130_fd_sc_hd__', ''), v] for k, v in types.most_common(16)],
    'filler_types': [[k.replace('sky130_fd_sc_hd__', ''), v] for k, v in fillers.most_common()],
    'cell_type_counts': {k: v for k, v in types.items()}, 'filler_counts': dict(fillers),
    'io_pins': len(ports), 'gds_mb': round(os.path.getsize(gds) / 1e6, 1),
}
json.dump(rep, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
log('report:', {k: rep[k] for k in ('cells', 'flops', 'die_um', 'die_mm2', 'utilization')})
