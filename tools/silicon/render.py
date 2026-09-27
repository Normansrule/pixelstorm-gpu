#!/usr/bin/env python3
"""
tools/silicon/render.py — pictures of the Pixelstorm layout, drawn by KLayout.

Renders build/silicon/ps_s130.gds with KLayout's own layout view (headless,
the same engine as the desktop app) using a sky130 colour scheme:

  docs/img/silicon-die.jpg            the whole die, every layer
  docs/img/silicon-blocks.jpg         the die with the block floorplan overlaid
  docs/img/silicon-zoom-<n>.jpg       a "powers of ten" dive from die to transistors
  docs/img/cell-<name>.png            single standard cells from the sky130 library
  web/data/silicon.json               stats + block rectangles for the website
  web/data/cells3d.json               polygons of standard cells for the 3D viewer
"""
import json, os, shutil
import klayout.db as db
import klayout.lay as lay
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'build', 'silicon')
IMG = os.path.join(ROOT, 'docs', 'img')
DATA = os.path.join(ROOT, 'web', 'data')
os.makedirs(DATA, exist_ok=True)
GDS = os.path.join(OUT, 'ps_s130.gds')
LIBGDS = os.path.join(ROOT, 'build', 'pdk', 'sky130_fd_sc_hd.gds')
rep = json.load(open(os.path.join(OUT, 'report.json')))

# sky130 layers (GDS layer/datatype), drawn bottom to top. Colours follow the
# familiar KLayout / Magic look: green diffusion, red poly, violet local
# interconnect, blue metal 1, then pink, teal, amber and orange upper metals.
LAYERS = [
    ('nwell',   64, 20, '#3B4A2F', 3, 'n-well'),
    ('diff',    65, 20, '#2EC27E', 0, 'diffusion (transistor source/drain)'),
    ('tap',     65, 44, '#1B7F5A', 2, 'substrate / well taps'),
    ('poly',    66, 20, '#FF3B3B', 0, 'polysilicon (transistor gates)'),
    ('licon',   66, 44, '#1A1A1A', 0, 'local interconnect contact'),
    ('li1',     67, 20, '#A77BFF', 5, 'local interconnect (li1)'),
    ('mcon',    67, 44, '#E8E8E8', 0, 'li1 to metal-1 contact'),
    ('met1',    68, 20, '#3D8BFF', 7, 'metal 1'),
    ('via',     68, 44, '#FFFFFF', 0, 'via 1'),
    ('met2',    69, 20, '#FF5EC4', 4, 'metal 2'),
    ('met3',    70, 20, '#2AD4D4', 8, 'metal 3 (pins)'),
    ('met4',    71, 20, '#FFB938', 9, 'metal 4 (power stripes)'),
    ('met5',    72, 20, '#FF7A3D', 10, 'metal 5 (power stripes)'),
    ('bound',  235, 4,  '#9DADC1', 1, 'die boundary'),
    ('text',    70, 5,  '#9DADC1', 1, 'pin labels'),
]

def view(gds, overlay=False, only=None, text=False):
    lv = lay.LayoutView()
    lv.load_layout(gds, True)
    lv.max_hier()
    lv.clear_layers()
    for key, l, d, col, dither, name in LAYERS:
        if only and key not in only: continue
        if key == 'text' and not text: continue
        n = lay.LayerPropertiesNode()
        n.source = f'{l}/{d}@1'; n.name = name
        c = int(col[1:], 16)
        n.fill_color = c; n.frame_color = c; n.dither_pattern = dither; n.width = 1
        n.transparent = False
        lv.insert_layer(lv.end_layers(), n)
    if overlay:
        n = lay.LayerPropertiesNode(); n.source = '250/0@1'; n.fill_color = 0xFFFFFF; n.frame_color = 0xFFFFFF; n.dither_pattern = 1; n.width = 3
        lv.insert_layer(lv.end_layers(), n)
    lv.set_config('background-color', '#05070b')
    lv.set_config('grid-visible', 'false')
    lv.set_config('text-visible', 'true' if text else 'false')
    lv.set_config('default-text-size', '0.6')
    lv.set_config('text-color', '#9DADC1')
    lv.set_config('bitmap-oversampling', '2')
    return lv

def save(lv, box, path, w, h, quality=88):
    lv.zoom_box(box)
    tmp = path + '.tmp.png'
    lv.save_image(tmp, w, h)
    im = Image.open(tmp).convert('RGB')
    if path.endswith('.jpg'): im.save(path, quality=quality, optimize=True, progressive=True)
    else: im.save(path, optimize=True)
    os.remove(tmp)
    print('wrote', os.path.relpath(path, ROOT))

die_w, die_h = rep['die_um']
full = db.DBox(-8, -8, die_w + 8, die_h + 8)

# 1. the whole die ------------------------------------------------------------
DIE_LAYERS = {'nwell', 'diff', 'tap', 'met3', 'met4', 'met5', 'bound'}   # at die scale poly, li1 and met1 merge into a solid carpet
lv = view(GDS, only=DIE_LAYERS)
save(lv, full, os.path.join(IMG, 'silicon-die.jpg'), 2000, round(2000 * (die_h + 16) / (die_w + 16)))
save(lv, full, os.path.join(ROOT, 'web', 'data', 'silicon-die-large.jpg'), 3200, round(3200 * (die_h + 16) / (die_w + 16)), quality=78)

# 2. floorplan overlay (drawn with PIL so the labels are readable) ------------
im = Image.open(os.path.join(IMG, 'silicon-die.jpg')).convert('RGBA')
W, H = im.size; sx = W / (die_w + 16); sy = H / (die_h + 16)
ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); dr = ImageDraw.Draw(ov)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30); small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
except OSError: font = small = ImageFont.load_default()
PAL = {'rf': (160, 125, 240), 'lane': (45, 212, 160), 'smem': (255, 185, 56), 'ctrl': (91, 132, 255), 'imem': (56, 214, 255), 'cmem': (56, 214, 255), 'arb': (255, 77, 141), 'disp': (91, 132, 255), 'top': (157, 173, 193)}
for b in rep['blocks']:
    x, y, w, h = b['rect_um']
    kind = b['id'].split('.')[-1]; kind = 'lane' if kind.startswith('lane') else kind
    col = PAL.get(kind, (200, 200, 200))
    X0, Y0 = (x + 8) * sx, H - (y + h + 8) * sy; X1, Y1 = (x + w + 8) * sx, H - (y + 8) * sy
    dr.rectangle([X0, Y0, X1, Y1], fill=col + (70,), outline=col + (255,), width=4)
    if h > 40:
        name = b['name'].replace('scheduler + LSU + control', 'control')
        f = font if dr.textlength(name, font=font) < X1 - X0 - 10 else small
        tw = dr.textlength(name, font=f)
        if tw < X1 - X0 - 6:
            dr.text(((X0 + X1) / 2 - tw / 2, (Y0 + Y1) / 2 - 30), name, font=f, fill=(255, 255, 255, 255))
            sub = f"{b['cells']:,} cells"
            dr.text(((X0 + X1) / 2 - dr.textlength(sub, font=small) / 2, (Y0 + Y1) / 2 + 8), sub, font=small, fill=(230, 236, 246, 255))
Image.alpha_composite(im, ov).convert('RGB').save(os.path.join(IMG, 'silicon-blocks.jpg'), quality=88, optimize=True)
print('wrote docs/img/silicon-blocks.jpg')

# 3. powers of ten: die -> block -> rows -> cells -> transistors ---------------
lane = next(b for b in rep['blocks'] if b['id'] == 'sm0.lane1')
cx = lane['rect_um'][0] + lane['rect_um'][2] * 0.52; cy = lane['rect_um'][1] + lane['rect_um'][3] * 0.61
widths = [die_w + 16, 600, 200, 70, 24, 9]
zooms = []
for i, wd in enumerate(widths):
    hd = wd * 10 / 16
    box = full if i == 0 else db.DBox(cx - wd / 2, cy - hd / 2, cx + wd / 2, cy + hd / 2)
    p = os.path.join(IMG, f'silicon-zoom-{i}.jpg')
    lv2 = view(GDS, text=(i >= 4), only=DIE_LAYERS if i == 0 else None)
    save(lv2, box, p, 1400, 875 if i else round(1400 * (die_h + 16) / (die_w + 16)), quality=80)
    zooms.append({'file': f'img/silicon-zoom-{i}.jpg', 'width_um': round(wd, 2)})

# 4. standard cells from the library -----------------------------------------
lib = db.Layout(); lib.read(LIBGDS)
CELLS = [('nand2_1', 'NAND2: two transistors in series, two in parallel'), ('dfxtp_1', 'D flip-flop: one bit of a register'),
         ('mux2_1', '2-to-1 multiplexer'), ('fa_1', 'full adder: one bit of an ALU adder'), ('inv_1', 'inverter: one NMOS, one PMOS')]
cells3d = {}
Z = {'nwell': (0, 0.02), 'diff': (0.0, 0.12), 'tap': (0.0, 0.12), 'poly': (0.14, 0.34), 'licon': (0.34, 0.62), 'li1': (0.62, 0.72),
     'mcon': (0.72, 0.98), 'met1': (0.98, 1.16), 'via': (1.16, 1.42), 'met2': (1.42, 1.60)}
for name, desc in CELLS:
    full_name = f'sky130_fd_sc_hd__{name}'
    c = lib.cell(full_name)
    if c is None: continue
    tmp = db.Layout(); tmp.dbu = lib.dbu
    tc = tmp.create_cell(full_name); tc.copy_tree(c)
    p = os.path.join(OUT, f'{name}.gds'); tmp.write(p)
    lv3 = view(p, only={'nwell', 'diff', 'tap', 'poly', 'licon', 'li1', 'mcon', 'met1', 'via'}, text=True)
    bb = c.dbbox()
    pad = 0.3
    box = db.DBox(bb.left - pad, bb.bottom - pad, bb.right + pad, bb.top + pad)
    wpx = 900; hpx = round(wpx * box.height() / box.width())
    save(lv3, box, os.path.join(IMG, f'cell-{name}.png'), wpx, hpx)
    # polygons for the 3D viewer
    layers = {}
    for key, l, d, *_ in LAYERS:
        if key not in Z: continue
        li = lib.find_layer(l, d)
        if li is None: continue
        reg = db.Region(c.begin_shapes_rec(li)).merged()
        polys = []
        for poly in reg.each():
            pts = [[round(pt.x * lib.dbu, 3), round(pt.y * lib.dbu, 3)] for pt in poly.each_point_hull()]
            if len(pts) >= 3: polys.append(pts)
        if polys: layers[key] = {'z': Z[key], 'polys': polys}
    cells3d[name] = {'desc': desc, 'w': round(bb.width(), 3), 'h': round(bb.height(), 3), 'layers': layers}
json.dump(cells3d, open(os.path.join(DATA, 'cells3d.json'), 'w'), separators=(',', ':'))
print('wrote web/data/cells3d.json', {k: len(v['layers']) for k, v in cells3d.items()})

# 5. transistors: every region where polysilicon crosses diffusion is one MOSFET
def transistors(cellname):
    c = lib.cell(cellname)
    if c is None: return 0
    poly = db.Region(c.begin_shapes_rec(lib.find_layer(66, 20))).merged()
    diff = db.Region(c.begin_shapes_rec(lib.find_layer(65, 20))).merged()
    return (poly & diff).count()
tcount = {k: transistors(k) for k in rep['cell_type_counts']}
logic_t = sum(tcount[k] * v for k, v in rep['cell_type_counts'].items())
fill_t = sum(transistors(k) * v for k, v in rep.get('filler_counts', {}).items())
rep['transistors_logic'] = logic_t; rep['transistors_total'] = logic_t + fill_t
rep['transistors_by_cell'] = {k.replace('sky130_fd_sc_hd__', ''): tcount[k] for k in list(rep['cell_type_counts'])[:0]}
for k in ('nand2_1', 'dfxtp_1', 'mux2_1', 'fa_1', 'inv_1'):
    if k in cells3d: cells3d[k]['transistors'] = transistors('sky130_fd_sc_hd__' + k)
json.dump(cells3d, open(os.path.join(DATA, 'cells3d.json'), 'w'), separators=(',', ':'))
print('transistors: logic', logic_t, 'with decaps', logic_t + fill_t, {k: v.get('transistors') for k, v in cells3d.items()})

# 6. website data -------------------------------------------------------------
site = {k: v for k, v in rep.items() if k not in ('cell_type_counts', 'filler_counts', 'transistors_by_cell')}; site['zooms'] = zooms
site['zoom_center_um'] = [round(cx + 8, 2), round(cy + 8, 2)]; site['frame_um'] = [die_w + 16, die_h + 16]   # frame = die plus the 8 um border of the renders
site['layers'] = [{'key': k, 'gds': f'{l}/{d}', 'color': col, 'name': nm} for k, l, d, col, _, nm in LAYERS if k != 'text']
json.dump(site, open(os.path.join(DATA, 'silicon.json'), 'w'), indent=1)
print('wrote web/data/silicon.json')
