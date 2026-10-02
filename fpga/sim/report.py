#!/usr/bin/env python3
"""Collect make fpga-sim results into fpga/docs/verification.json (used by the datasheet)."""
import json, os, re, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
slots = json.load(open(os.path.join(ROOT, 'fpga', 'gen', 'slots.json')))
def collect(prefix, shape):
    out = []
    for s in slots:
        log = os.path.join(ROOT, 'build', 'fpga', f"{prefix}{s['slot']}.log"); ppm = os.path.join(ROOT, 'build', 'fpga', ('frame' if prefix == 'sim' else prefix) + f"{s['slot']}.ppm")
        txt = open(log, errors='replace').read() if os.path.exists(log) else ''
        m = re.search(r'finished after (\d+) GPU cycles', txt); u = re.search(r'(PIXELSTORM k=\d cycles=[0-9A-F]{8})', txt)
        chk = subprocess.run(['node', os.path.join(ROOT, 'fpga', 'sim', 'check.js'), str(s['slot']), ppm] + shape, capture_output=True, text=True)
        out.append({'slot': s['slot'], 'name': s['name'], 'cycles': int(m.group(1)) if m else None, 'uart': u.group(1) if u else '',
                    'pixels': s['fb']['width'] * s['fb']['height'], 'result': 'PASS' if chk.returncode == 0 else 'FAIL'})
    return out
runs = collect('sim', []); runs_tang = collect('tn', ['16', '2'])
tl = os.path.join(ROOT, 'build', 'fpga', 'tmds.log'); tmds = next((l.strip() for l in open(tl) if l.startswith(('PASS', 'FAIL'))), '') if os.path.exists(tl) else ''
for s in []:
    log = os.path.join(ROOT, 'build', 'fpga', f"sim{s['slot']}.log")
    txt = open(log, errors='replace').read() if os.path.exists(log) else ''
    m = re.search(r'finished after (\d+) GPU cycles', txt); u = re.search(r'(PIXELSTORM k=\d cycles=[0-9A-F]{8})', txt)
    chk = subprocess.run(['node', os.path.join(ROOT, 'fpga', 'sim', 'check.js'), str(s['slot']), os.path.join(ROOT, 'build', 'fpga', f"frame{s['slot']}.ppm")], capture_output=True, text=True)
    runs.append({'slot': s['slot'], 'name': s['name'], 'cycles': int(m.group(1)) if m else None, 'uart': u.group(1) if u else '',
                 'pixels': s['fb']['width'] * s['fb']['height'], 'result': 'PASS' if chk.returncode == 0 else 'FAIL'})
json.dump({'version': '1.5', 'runs': runs, 'runs_tang': runs_tang, 'tmds': tmds}, open(os.path.join(ROOT, 'fpga', 'docs', 'verification.json'), 'w'), indent=1)
print('fpga/docs/verification.json:', ', '.join(f"{r['name']} {r['result']}" for r in runs), '| tang:', ', '.join(r['result'] for r in runs_tang), '|', tmds[:40])
