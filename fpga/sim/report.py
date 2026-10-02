#!/usr/bin/env python3
"""Collect make fpga-sim results into fpga/docs/verification.json (used by the datasheet)."""
import json, os, re, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
slots = json.load(open(os.path.join(ROOT, 'fpga', 'gen', 'slots.json')))
def collect(prefix, shape):
    out = []
    for s in slots:
        log = os.path.join(ROOT, 'build', 'fpga', f"{prefix}-{s['slot']}.log"); ppm = os.path.join(ROOT, 'build', 'fpga', f"{prefix}-{s['slot']}.ppm")
        txt = open(log, errors='replace').read() if os.path.exists(log) else ''
        m = re.search(r'finished after (\d+) GPU cycles', txt); u = re.search(r'(PIXELSTORM k=\d cycles=[0-9A-F]{8})', txt)
        chk = subprocess.run(['node', os.path.join(ROOT, 'fpga', 'sim', 'check.js'), str(s['slot']), ppm] + shape + ['log=' + log], capture_output=True, text=True)
        pf = re.search(r'instr=([0-9A-F]{8}) lanes=([0-9A-F]{8}) mem=([0-9A-F]{8})', txt)
        perf = {'instr': int(pf.group(1), 16), 'lanes': int(pf.group(2), 16), 'mem': int(pf.group(3), 16)} if pf else {}
        if perf: perf['simd'] = round(100 * perf['lanes'] / (perf['instr'] * int(shape[1] if shape else 8)), 1)
        out.append({'slot': s['slot'], 'name': s['name'], 'cycles': int(m.group(1)) if m else None, 'uart': u.group(1) if u else '',
                    'perf': perf, 'pixels': s['fb']['width'] * s['fb']['height'], 'result': 'PASS' if chk.returncode == 0 else 'FAIL'})
    return out
runs_basys = collect('basys3', ['8', '4']); runs = collect('nexys_a7', ['4', '8']); runs_tang = collect('tangnano20k', ['16', '2'])
tl = os.path.join(ROOT, 'build', 'fpga', 'tmds.log'); tmds = next((l.strip() for l in open(tl) if l.startswith(('PASS', 'FAIL'))), '') if os.path.exists(tl) else ''
for s in []:
    log = os.path.join(ROOT, 'build', 'fpga', f"sim{s['slot']}.log")
    txt = open(log, errors='replace').read() if os.path.exists(log) else ''
    m = re.search(r'finished after (\d+) GPU cycles', txt); u = re.search(r'(PIXELSTORM k=\d cycles=[0-9A-F]{8})', txt)
    chk = subprocess.run(['node', os.path.join(ROOT, 'fpga', 'sim', 'check.js'), str(s['slot']), os.path.join(ROOT, 'build', 'fpga', f"frame{s['slot']}.ppm")], capture_output=True, text=True)
    runs.append({'slot': s['slot'], 'name': s['name'], 'cycles': int(m.group(1)) if m else None, 'uart': u.group(1) if u else '',
                 'pixels': s['fb']['width'] * s['fb']['height'], 'result': 'PASS' if chk.returncode == 0 else 'FAIL'})
ul = os.path.join(ROOT, 'build', 'fpga', 'upload.log'); utxt = open(ul, errors='replace').read() if os.path.exists(ul) else ''
uc = subprocess.run(['node', os.path.join(ROOT, 'fpga', 'sim', 'check.js'), 'k:' + os.path.join(ROOT, 'fpga', 'kernels', 'rings.psa'), os.path.join(ROOT, 'build', 'fpga', 'upload.ppm'), '8', '4'], capture_output=True, text=True)
um = re.search(r'finished after (\d+) GPU cycles', utxt); uu = re.search(r'(PIXELSTORM k=\d cycles=[0-9A-F]{8})', utxt)
cl = os.path.join(ROOT, 'build', 'fpga', 'corrupt.log'); corrupt = open(cl).read().strip() if os.path.exists(cl) else ''
al = os.path.join(ROOT, 'build', 'fpga', 'anim.log')
ac = subprocess.run(['node', os.path.join(ROOT, 'fpga', 'sim', 'check.js'), 'k:' + os.path.join(ROOT, 'fpga', 'kernels', 'rings.psa'), os.path.join(ROOT, 'build', 'fpga', 'anim.ppm'), '8', '4', 'p14=100', 'p15=2', 'log=' + al], capture_output=True, text=True)
anim = {'frames': 3, 'switches': 100, 'result': 'PASS' if ac.returncode == 0 else 'FAIL', 'detail': ac.stdout.strip().splitlines()[0] if ac.stdout.strip() else ''}
upload = {'kernel': 'rings (fpga/kernels/rings.psa)', 'cycles': int(um.group(1)) if um else None, 'uart': uu.group(1) if uu else '', 'result': 'PASS' if uc.returncode == 0 else 'FAIL', 'corrupt': corrupt}
json.dump({'version': '1.7', 'reference_board': 'Digilent Basys 3', 'animation': anim, 'runs_basys': runs_basys, 'runs': runs, 'runs_tang': runs_tang, 'tmds': tmds, 'upload': upload}, open(os.path.join(ROOT, 'fpga', 'docs', 'verification.json'), 'w'), indent=1)
print('fpga/docs/verification.json: basys3', ', '.join(r['result'] for r in runs_basys), '| nexys_a7', ', '.join(r['result'] for r in runs), '| tang', ', '.join(r['result'] for r in runs_tang), '| upload', upload['result'], '| animation', anim['result'], '|', corrupt[:20])
