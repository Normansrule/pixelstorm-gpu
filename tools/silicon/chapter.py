#!/usr/bin/env python3
"""Fill docs/14-silicon.md from tools/silicon/chapter_template.md with the numbers
of the latest silicon run (web/data/silicon.json). Run by make docs."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
d = json.load(open(os.path.join(ROOT, 'web', 'data', 'silicon.json')))
t = open(os.path.join(ROOT, 'tools', 'silicon', 'chapter_template.md')).read()
f = lambda n: f'{n:,}'
vals = dict(cells=f(d['cells']), flops=f(d['flops']), tr=f(d['transistors_logic']), ca=f(d['cell_area_um2']),
            dw=d['die_um'][0], dh=d['die_um'][1], dmm=d['die_mm2'], ut=round(d['utilization'] * 100, 1),
            fill=f(d['fillers']), io=d['io_pins'], ratio=f(int(round(80e9 / d['transistors_logic'], -3))))
for k, v in vals.items(): t = t.replace('{' + k + '}', str(v))
open(os.path.join(ROOT, 'docs', '14-silicon.md'), 'w').write(t)
print('docs/14-silicon.md', vals['cells'], 'cells', vals['tr'], 'transistors')
