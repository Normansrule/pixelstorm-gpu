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

# README: every <!--s:key-->...<!--/s--> field comes from silicon.json too
import re
fields = {'cells': f"**{f(d['cells'])}** ({f(d['flops'])} flip-flops) plus {f(d['fillers'])} tap, decap and filler cells",
          'tr': f"**{f(d['transistors_logic'])}**, counted from the layout",
          'die': f"{d['die_um'][0]} x {d['die_um'][1]} µm = **{d['die_mm2']} mm²**, {round(d['utilization'] * 100, 1)}% utilization"}
rp = os.path.join(ROOT, 'README.md'); r = open(rp).read()
r = re.sub(r'<!--s:(\w+)-->.*?<!--/s-->', lambda m: f'<!--s:{m.group(1)}-->{fields.get(m.group(1), m.group(0))}<!--/s-->', r)
open(rp, 'w').write(r)
