#!/usr/bin/env python3
"""Turn the VGA frames grabbed by fpga/sim/tb_fpga.v (RGB444 PPM) into PNGs:
docs/img/fpga-vga-<slot>.png and a 2x2 sheet docs/img/fpga-vga-all.png."""
import os, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ims = []
for s in range(4):
    p = os.path.join(ROOT, 'build', 'fpga', f'frame{s}.ppm')
    if not os.path.exists(p): continue
    tok = open(p).read().split(); w, h = int(tok[1]), int(tok[2]); v = list(map(int, tok[4:]))
    im = Image.frombytes('RGB', (w, h), bytes(min(255, x * 17) for x in v))
    im.save(os.path.join(ROOT, 'docs', 'img', f'fpga-vga-{s}.png'), optimize=True); ims.append(im)
if len(ims) == 4:
    sheet = Image.new('RGB', (1280, 960), (5, 7, 11))
    for i, im in enumerate(ims): sheet.paste(im, ((i % 2) * 640, (i // 2) * 480))
    sheet.save(os.path.join(ROOT, 'docs', 'img', 'fpga-vga-all.png'), optimize=True)
print(f'fpga: {len(ims)} VGA frames -> docs/img/fpga-vga-*.png')
