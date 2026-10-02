#!/usr/bin/env python3
"""
fpga/docs/datasheet.py — build fpga/docs/pixelstorm-fpga-datasheet.pdf

A datasheet for the Pixelstorm FPGA edition, in the style of a chip datasheet.
Every table is generated from the repository so it cannot drift:
  fpga/gen/slots.json          ROM slots (kernels, launch sizes, framebuffers)
  fpga/docs/verification.json  cycle counts and pixel checks from make fpga-sim
  fpga/docs/resources.json     FPGA resource estimate (Yosys synth_xilinx)
  fpga/boards/*/*.xdc          pin assignments
The board vendors' own datasheets stay authoritative for electrical data; this
document links to them.
"""
import json, os, re, datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether)
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, 'pixelstorm-fpga-datasheet.pdf')
slots = json.load(open(os.path.join(ROOT, 'fpga', 'gen', 'slots.json')))
ver = json.load(open(os.path.join(HERE, 'verification.json')))
res = json.load(open(os.path.join(HERE, 'resources.json')))
VERSION = ver.get('version', '1.5')

INK, BLUE, GREY, LIGHT = colors.HexColor('#101826'), colors.HexColor('#2F5BEA'), colors.HexColor('#5A6678'), colors.HexColor('#EEF2F8')
ss = getSampleStyleSheet()
H1 = ParagraphStyle('h1', parent=ss['Heading1'], fontName='Helvetica-Bold', fontSize=15, textColor=INK, spaceBefore=10, spaceAfter=6)
H2 = ParagraphStyle('h2', parent=ss['Heading2'], fontName='Helvetica-Bold', fontSize=11.5, textColor=BLUE, spaceBefore=8, spaceAfter=4)
P = ParagraphStyle('p', parent=ss['BodyText'], fontName='Helvetica', fontSize=9, leading=12.2, textColor=INK)
SM = ParagraphStyle('sm', parent=P, fontSize=7.8, leading=10, textColor=GREY)
B = ParagraphStyle('b', parent=P, leftIndent=10, bulletIndent=0)
CELL = ParagraphStyle('cell', parent=P, fontSize=8, leading=10)

HEAD = ParagraphStyle('hc', parent=CELL, textColor=colors.white, fontName='Helvetica-Bold')
def table(rows, widths, head=True, zebra=True):
    data = [[Paragraph(str(c), HEAD if (head and i == 0) else CELL) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    st = [('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#C9D2E0')), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
          ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4), ('TOPPADDING', (0, 0), (-1, -1), 2.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5)]
    if head: st += [('BACKGROUND', (0, 0), (-1, 0), INK), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white)]
    if zebra:
        for i in range(1 if head else 0, len(rows)):
            if i % 2 == 0: st.append(('BACKGROUND', (0, i), (-1, i), LIGHT))
    t.setStyle(TableStyle(st))
    return t

def block_diagram():
    d = Drawing(7.2 * inch, 2.75 * inch)
    def box(x, y, w, h, title, sub='', fill='#EEF2F8', stroke='#2F5BEA'):
        d.add(Rect(x, y, w, h, fillColor=colors.HexColor(fill), strokeColor=colors.HexColor(stroke), strokeWidth=1, rx=4, ry=4))
        d.add(String(x + 6, y + h - 13, title, fontName='Helvetica-Bold', fontSize=8.5, fillColor=INK))
        for i, line in enumerate(sub.split('\n') if sub else []):
            d.add(String(x + 6, y + h - 25 - i * 10, line, fontName='Helvetica', fontSize=7, fillColor=GREY))
    def arrow(x1, y1, x2, y2):
        d.add(Line(x1, y1, x2, y2, strokeColor=GREY, strokeWidth=1))
        import math; a = math.atan2(y2 - y1, x2 - x1); s = 4
        d.add(Polygon([x2, y2, x2 - s * math.cos(a - 0.4), y2 - s * math.sin(a - 0.4), x2 - s * math.cos(a + 0.4), y2 - s * math.sin(a + 0.4)], fillColor=GREY, strokeColor=GREY))
    box(4, 150, 92, 46, '100 MHz osc', 'board clock')
    box(4, 88, 92, 50, 'MMCM + BUFGCE', '25 MHz pixel clock\ngated GPU clock')
    box(4, 20, 92, 56, 'Buttons, switches', 'start, reset\nkernel select\nspeed (slow motion)')
    box(120, 20, 106, 176, 'Loader (ps_loader)', 'kernel ROM, 4 slots\nclears framebuffer\nwrites imem + constants\npulses launch, waits done', '#F4EEFF', '#7A4FD6')
    box(250, 96, 196, 100, 'Pixelstorm GPU core', 'ps_gpu_top: 1 SM, 4 warps x 8 lanes\nscheduler, 8 ALUs (DSP48E1)\nper-lane register banks (LUTRAM)\n8 shared-memory banks\nmemory arbiter', '#E9FBF3', '#18A077')
    box(250, 20, 196, 64, 'Global memory (ps_bram_mem)', '8K words in block RAM, 4 banks\nport A: GPU   port B: video', '#FFF6E6', '#D99A1E')
    box(470, 136, 84, 60, 'Video (ps_vga)', '640x480 @ 60 Hz\nVGA, or HDMI via\nps_tmds_enc', '#EAF6FF', '#1D8FD6')
    box(470, 70, 84, 54, 'UART (ps_uart_tx)', '115200 8N1\nstatus line')
    box(470, 12, 84, 46, '7-seg + LEDs', 'cycle count, state')
    arrow(50, 150, 50, 138); arrow(96, 48, 120, 48); arrow(96, 113, 120, 113); arrow(226, 146, 250, 146); arrow(226, 52, 250, 52)
    arrow(348, 96, 348, 84); arrow(446, 60, 470, 160); arrow(446, 150, 470, 100); arrow(446, 120, 470, 40)
    return d

def pins(xdc, names):
    s = open(xdc).read(); out = []
    for pin, port in re.findall(r'PACKAGE_PIN (\w+)\s+IOSTANDARD \w+\} \[get_ports \{?([\w\[\]]+)\}?\]', s):
        base = re.sub(r'\[\d+\]', '', port)
        if base in names: out.append((port, pin))
    return out

def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK); canvas.rect(0, letter[1] - 0.42 * inch, letter[0], 0.42 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white); canvas.setFont('Helvetica-Bold', 10)
    canvas.drawString(0.6 * inch, letter[1] - 0.27 * inch, 'PIXELSTORM-F')
    canvas.setFont('Helvetica', 8.5); canvas.drawRightString(letter[0] - 0.6 * inch, letter[1] - 0.27 * inch, f'FPGA GPU  |  Datasheet v{VERSION}')
    canvas.setFillColor(GREY); canvas.setFont('Helvetica', 7.5)
    canvas.drawString(0.6 * inch, 0.4 * inch, 'Open-source educational design, MIT license. github.com/Normansrule/pixelstorm-gpu')
    canvas.drawRightString(letter[0] - 0.6 * inch, 0.4 * inch, f'Page {doc.page}')
    canvas.restoreState()

story = []
story.append(Paragraph('Pixelstorm-F: an open-source SIMT GPU for FPGA boards from $30', ParagraphStyle('t', parent=H1, fontSize=18, spaceBefore=6)))
story.append(Paragraph('<b>Reference test board: Digilent Basys 3</b> (amazon.com/dp/B00NUE1WOG). Verilog GPU with a CUDA-style instruction set, block-RAM global memory, live VGA or HDMI framebuffer with an on-screen status line, and an on-board kernel loader. Runs on the Sipeed Tang Nano 20K (Gowin GW2AR-18, open-source tools), the Digilent Basys 3 and the Nexys A7-100T. Verified pixel for pixel against a cycle-exact golden model.', P))
story.append(Spacer(1, 6))
feat = [
    'SIMT GPU core: 1 Streaming Multiprocessor with 32-thread blocks as 4 warps x 8 lanes (Nexys A7), 8 x 4 (Basys 3) or 16 x 2 (Tang Nano 20K)',
    '40-instruction PS-ISA: integer and Q16.16 arithmetic, predicates, shuffles, votes, barriers, atomics, shared memory',
    'Per-lane register banks (16 x 32-bit registers per thread) mapped to distributed RAM; 8 shared-memory banks',
    '32 KB global memory in block RAM with a second read port for video scan-out',
    'Hardware loader: 4 kernels in ROM (gradient shader, triangle rasterizer, Mandelbrot, Mandelbrot zoom); one button launches',
    '640 x 480 @ 60 Hz video drawing the framebuffer live, 12x magnified: VGA (Digilent boards) or HDMI/DVI with an in-house TMDS encoder (Tang Nano 20K)',
    'On-screen status line: kernel name and the cycle count in decimal (font ROM and hardware binary-to-decimal converter)',
    'Slow-motion GPU clock on the Digilent boards (1/64, 1/1024, 1/16384); cycle count on the 7-segment display and a UART status line on all boards',
    'Kernel upload over the USB serial port: run new kernels without a new bitstream (./pixelstorm upload)',
    'Fully open-source build for the Tang Nano 20K (Yosys, nextpnr-himbaechel, gowin_pack, openFPGALoader); Vivado scripts for the Artix-7 boards',
    'Same RTL as the simulated and SkyWater 130 nm versions; every kernel verified cycle for cycle against the golden model',
]
for f in feat: story.append(Paragraph(f, B, bulletText='\u2022'))
story.append(Paragraph('Block diagram', H2))
story.append(block_diagram())
story.append(Paragraph('Figure 1. Pixelstorm-F top level (fpga/rtl/ps_fpga_top.v and a board wrapper).', SM))
story.append(Paragraph('General description', H2))
story.append(Paragraph('Pixelstorm-F puts the Pixelstorm GPU on an FPGA evaluation board. A small hardware loader plays the role of a host driver: '
    'it clears the framebuffer in global memory, copies the selected kernel\'s instructions and arguments into the GPU, and launches it. '
    'The GPU writes 0x00RRGGBB pixels to a framebuffer in block RAM while the VGA controller reads the same memory through a second port, so the image '
    'appears on the monitor as the warps compute it. The GPU core is the unmodified ps_gpu_top from the main repository, configured by parameters.', P))

story.append(PageBreak())
story.append(Paragraph('Configurations and resources', H1))
story.append(table([
    ['Parameter', 'Tang Nano 20K', 'Basys 3', 'Nexys A7-100T'],
    ['FPGA', 'GW2AR-LV18QN88C8/I7', 'XC7A35T-1CPG236C', 'XC7A100T-1CSG324C'],
    ['Approximate price', 'about $30', 'about $150 to $200', 'about $300 to $350'],
    ['Warps x lanes (1 SM)', '16 x 2', '8 x 4', '4 x 8'],
    ['Registers per thread', '16 x 32 bit', '16 x 32 bit', '16 x 32 bit'],
    ['Shared memory', '256 words, 2 banks', '256 words, 4 banks', '256 words, 8 banks'],
    ['Global memory', '8K words block SRAM', '8K words block RAM', '8K words block RAM'],
    ['Video', 'HDMI (DVI) 640x480', 'VGA 640x480', 'VGA 640x480'],
    ['Clocks', '27 MHz -> 126 MHz TMDS, 25.2 MHz GPU', '100 MHz -> 25 MHz', '100 MHz -> 25 MHz'],
    ['Toolchain', 'open source or Gowin EDA', 'Vivado ML Standard', 'Vivado ML Standard'],
], [1.5 * inch, 1.8 * inch, 1.75 * inch, 1.75 * inch]))
story.append(Spacer(1, 8))
story.append(Paragraph('Resource estimate', H2))
rows = [['Resource', 'Nexys A7 core', 'of XC7A100T', 'Basys 3 core', 'of XC7A35T']]
capN = {'LUT': 63400, 'FF': 126800, 'DSP48E1': 240, 'BRAM36': 135}; capB = {'LUT': 20800, 'FF': 41600, 'DSP48E1': 90, 'BRAM36': 50}
for k in ['LUT', 'FF', 'DSP48E1', 'BRAM36']:
    a = res['core_nexys'].get(k); b = res['core_basys'].get(k)
    rows.append([k, f'{a:,}', f'{100 * a / capN[k]:.0f}% of {capN[k]:,}', f'{b:,}', f'{100 * b / capB[k]:.0f}% of {capB[k]:,}'])
story.append(table(rows, [1.1 * inch, 1.2 * inch, 1.6 * inch, 1.2 * inch, 1.7 * inch]))
if res.get('core_tang'):
    T = res['core_tang']
    story.append(Spacer(1, 4))
    story.append(table([['Tang Nano 20K core (GW2AR-18)', 'Estimate', 'Available', 'Use'],
        ['LUT4 (logic + shadow RAM)', f"{T['LUT4']:,}", '20,736', f"{100 * T['LUT4'] / 20736:.0f}%"],
        ['Flip-flops', f"{T['FF']:,}", '15,552', f"{100 * T['FF'] / 15552:.0f}%"],
        ['Multiplier blocks', f"{T['MULT']:,}", 'see DS102', ''],
        ['Block SRAM', f"{T['BSRAM']:,}", '46', f"{100 * T['BSRAM'] / 46:.0f}%"]], [2.4 * inch, 1.3 * inch, 1.5 * inch, 1.6 * inch]))
story.append(Paragraph(res.get('note', ''), SM))
if res.get('tang_note'): story.append(Paragraph(res['tang_note'], SM))
story.append(Paragraph('Memory map (global memory, word addresses)', H2))
story.append(table([['Range', 'Contents'], ['0x0000 - 0x0FFF', 'free for kernel data'], ['0x1000 - 0x13FF', 'framebuffer, one 0x00RRGGBB word per pixel (32 x 32 or 32 x 16)'], ['0x1400 - 0x1FFF', 'free']], [1.6 * inch, 5.2 * inch]))
story.append(Paragraph('Kernel ROM', H2))
rows = [['Slot', 'Kernel', 'Instr.', 'Launch', 'Basys 3 (8 x 4)', 'Nexys A7 (4 x 8)', 'Tang Nano (16 x 2)']]
for s in slots:
    cy = lambda key: next((x.get('cycles') for x in ver.get(key, []) if x['slot'] == s['slot']), None)
    fmt = lambda c, mhz: f'{c:,} ({c / (mhz * 1e3):.2f} ms)' if c else '-'
    rows.append([s['slot'], s['name'], s['instructions'], f"<<<{s['grid']}, {s['block']}>>>", fmt(cy('runs_basys'), 25), fmt(cy('runs'), 25), fmt(cy('runs_tang'), 25.2)])
story.append(table(rows, [0.4 * inch, 1.15 * inch, 0.45 * inch, 0.85 * inch, 1.3 * inch, 1.3 * inch, 1.35 * inch]))
story.append(Paragraph('Slot 3 runs the same instructions as slot 2 with different kernel arguments in the constant bank: the view zooms onto the top bulb of the set.', SM))

story.append(PageBreak())
story.append(Paragraph('Pin functions', H1))
for title, xdc, names, notes in [
    ('Basys 3 (reference board)', 'fpga/boards/basys3/basys3.xdc', {'clk', 'btnC', 'btnU', 'sw', 'vgaRed', 'vgaGreen', 'vgaBlue', 'Hsync', 'Vsync', 'RsTx', 'RsRx', 'led'},
     {'clk': '100 MHz input', 'btnU': 'reset', 'btnC': 'start kernel', 'sw': 'sw1..0 kernel, sw15..14 speed', 'vgaRed': 'VGA red', 'vgaGreen': 'VGA green', 'vgaBlue': 'VGA blue', 'Hsync': 'horizontal sync', 'Vsync': 'vertical sync', 'RsTx': 'status line to PC', 'RsRx': 'kernel upload from PC', 'led': 'led15 busy, led14 done, led11 upload OK'}),
    ('Nexys A7-100T', 'fpga/boards/nexys_a7/nexys_a7.xdc', {'CLK100MHZ', 'CPU_RESETN', 'BTNC', 'SW', 'VGA_R', 'VGA_G', 'VGA_B', 'VGA_HS', 'VGA_VS', 'UART_RXD_OUT', 'LED'},
     {'CLK100MHZ': '100 MHz input', 'CPU_RESETN': 'reset, active low', 'BTNC': 'start kernel', 'SW': 'SW1..0 kernel, SW15..14 speed', 'VGA_R': 'VGA red', 'VGA_G': 'VGA green', 'VGA_B': 'VGA blue', 'VGA_HS': 'horizontal sync', 'VGA_VS': 'vertical sync', 'UART_RXD_OUT': 'status line to PC', 'LED': 'LED15 busy, LED14 done'})
]:
    story.append(Paragraph(title, H2))
    groups = {}
    for port, pin in pins(os.path.join(ROOT, xdc), names):
        base = re.sub(r'\[\d+\]', '', port); groups.setdefault(base, []).append(f'{port}={pin}' if '[' in port else pin)
    rows = [['Signal', 'Package pin(s)', 'Function']]
    for base, lst in groups.items():
        if base in ('SW', 'sw'): lst = [x for x in lst if re.search(r'\[(0|1|14|15)\]', x)]
        if base in ('LED', 'led'): lst = [x for x in lst if re.search(r'\[(14|15)\]', x)]
        rows.append([base, ', '.join(lst), notes.get(base, '')])
    story.append(table(rows, [1.2 * inch, 3.6 * inch, 2.0 * inch]))
story.append(Paragraph('Tang Nano 20K', H2))
cst = open(os.path.join(ROOT, 'fpga/boards/tangnano20k/tangnano20k.cst')).read()
fn = {'I_clk': '27 MHz crystal', 'I_s1': 'S1: start kernel', 'I_s2': 'S2: next kernel', 'O_uart_tx': 'status line to PC', 'O_led': 'kernel, busy, done (active low)',
      'O_tmds_clk_p': 'HDMI TMDS clock pair', 'O_tmds_data_p': 'HDMI TMDS data pairs 0, 1, 2 (blue, green, red)'}
groups = {}
for name, pin in re.findall(r'IO_LOC "([\w\[\]]+)" ([\d,]+);', cst):
    base = re.sub(r'\[\d+\]', '', name); groups.setdefault(base, []).append((name + '=' if '[' in name else '') + pin.replace(',', '/'))
story.append(table([['Signal', 'Package pin(s)', 'Function']] + [[k, ', '.join(v), fn.get(k, '')] for k, v in groups.items()], [1.3 * inch, 3.0 * inch, 2.5 * inch]))
story.append(Paragraph('All listed pins are 3.3 V LVCMOS33 (Nexys A7 SW8 and SW9 are 1.8 V and unused). Pin data comes from the constraint files in this repository, which follow Digilent\'s master XDC files.', SM))
story.append(Paragraph('Operation', H1))
story.append(table([
    ['Step', 'What to do', 'What you see'],
    ['1', 'Program the bitstream (make fpga-prog or Vivado Hardware Manager)', 'VGA shows an empty blue frame'],
    ['2', 'Choose a kernel with the two lowest switches', 'LED13..12 show the choice after start'],
    ['3', 'Optional: slow motion with the two highest switches', '10 = about 2 s for Mandelbrot'],
    ['4', 'Press the centre button', 'amber bar; image paints in; LED15 on'],
    ['5', 'Wait for done', 'green bar; LED14 on; 7-segment shows cycles; UART prints a status line'],
], [0.5 * inch, 3.4 * inch, 2.9 * inch]))
story.append(Paragraph('Kernel upload', H2))
story.append(Paragraph('Slot 3 can be rewritten from the PC over the same serial port: <font face="Courier">./pixelstorm upload kernel.psa --port /dev/ttyUSB1</font>. The board launches the kernel as soon as the checksum matches; a bad packet is ignored and a pause of about 50 ms restarts the receiver.', P))
story.append(table([['Bytes', 'Field'], ['4', 'magic "PSK1"'], ['16', 'kernel name (shown on the status line)'], ['2 + 2', 'grid, block (little-endian)'],
    ['2 + 1 + 1', 'framebuffer address, width, height'], ['2', 'instruction count n (at most 256)'], ['4 n', 'instructions'], ['64', '16 kernel arguments (constant bank)'],
    ['1', 'checksum: sum of all bytes after the magic, mod 256']], [1.0 * inch, 5.8 * inch]))
if ver.get('upload'):
    U = ver['upload']; story.append(Paragraph(f"Verified in simulation on the Basys 3 shape: {U['kernel']} uploaded at 115200 baud, {U.get('cycles') or 0:,} GPU cycles, {U['uart']}, pixels {U['result']}. {U.get('corrupt', '')}", SM))
story.append(Paragraph('UART status line', H2))
story.append(Paragraph('115200 baud, 8 data bits, no parity, 1 stop bit. After every kernel: <font face="Courier">PIXELSTORM k=&lt;slot&gt; cycles=&lt;8 hex digits&gt;</font> followed by CR LF. Open it with any terminal program (PuTTY, screen, minicom) on the board\'s USB serial port.', P))
story.append(Paragraph('Video timing', H2))
story.append(table([['Parameter', 'Horizontal', 'Vertical'], ['Visible', '640 pixels', '480 lines'], ['Front porch / sync / back porch', '16 / 96 / 48', '10 / 2 / 33'], ['Total', '800 pixels', '525 lines'], ['Sync polarity', 'negative', 'negative'], ['Pixel clock', '25.0 MHz (VESA 25.175 MHz, accepted by monitors)', '59.5 Hz frame rate']], [2.2 * inch, 2.4 * inch, 2.2 * inch]))

story.append(Paragraph('Verification', H1))
story.append(Paragraph('Nexys A7 shape (4 warps x 8 lanes) first; the reference Basys 3 shape and the Tang Nano shape follow.', SM))
story.append(Paragraph('Before any hardware, the complete FPGA design (loader, GPU, block-RAM memory, VGA, UART) runs in Icarus Verilog (fpga/sim/tb_fpga.v). The testbench presses start, waits for done, captures one full VGA frame from the video pins, and fpga/sim/check.js compares every framebuffer pixel on screen, at its left edge, centre and right edge, with the golden model. The GPU core itself passes the repository\'s cycle-exact RTL-versus-model suite.', P))
rows = [['Kernel', 'GPU cycles', 'UART line (simulated)', 'Pixels checked', 'Result']]
for r in ver['runs']:
    rows.append([r['name'], f"{r['cycles']:,}", r['uart'], f"{r['pixels']:,}", r['result']])
story.append(table(rows, [1.3 * inch, 0.9 * inch, 2.6 * inch, 1.0 * inch, 1.0 * inch]))
if ver.get('runs_basys'):
    story.append(Paragraph('Reference board: the same kernels on the Basys 3 shape (8 warps x 4 lanes)', H2))
    rows = [['Kernel', 'GPU cycles', 'UART line (simulated)', 'Pixels checked', 'Result']]
    for r in ver['runs_basys']: rows.append([r['name'], f"{r['cycles']:,}" if r['cycles'] else '-', r['uart'], f"{r['pixels']:,}", r['result']])
    story.append(table(rows, [1.3 * inch, 0.9 * inch, 2.6 * inch, 1.0 * inch, 1.0 * inch]))
if ver.get('runs_tang'):
    story.append(Paragraph('Same kernels on the Tang Nano 20K shape (16 warps x 2 lanes)', H2))
    rows = [['Kernel', 'GPU cycles', 'UART line (simulated)', 'Pixels checked', 'Result']]
    for r in ver['runs_tang']: rows.append([r['name'], f"{r['cycles']:,}" if r['cycles'] else '-', r['uart'], f"{r['pixels']:,}", r['result']])
    story.append(table(rows, [1.3 * inch, 0.9 * inch, 2.6 * inch, 1.0 * inch, 1.0 * inch]))
if ver.get('tmds'):
    story.append(Paragraph('HDMI encoder: ' + ver['tmds'].replace('+/-', '\u00b1'), P))
img = os.path.join(ROOT, 'docs', 'img', 'fpga-vga-all.png')
if os.path.exists(img):
    story.append(Spacer(1, 6)); story.append(Image(img, width=5.4 * inch, height=4.05 * inch))
    story.append(Paragraph('Figure 2. VGA frames captured from the simulated board: what a monitor shows for slots 0 to 3.', SM))
story.append(Paragraph('Build and program', H1))
story.append(table([['Command', 'Result'],
    ['make fpga-sim', 'board simulation: all four kernels on both GPU shapes with pixel checks, plus the TMDS encoder'],
    ['make fpga-tang', 'Tang Nano 20K with the open-source flow (Yosys, nextpnr-himbaechel, gowin_pack) and load with openFPGALoader'],
    ['make fpga-bit BOARD=nexys_a7', 'bitstream with Vivado (ML Standard, free): build/fpga/nexys_a7/pixelstorm_nexys_a7.bit, utilization and timing reports'],
    ['make fpga-bit BOARD=basys3', 'the same for the Basys 3'],
    ['make fpga-prog BOARD=nexys_a7', 'load over USB with openFPGALoader (or vivado -source fpga/vivado/program.tcl)']], [2.3 * inch, 4.5 * inch]))
story.append(Paragraph('Where to buy', H2))
story.append(table([['Board', 'Link', 'Approximate price'],
    ['Sipeed Tang Nano 20K', 'amazon.com/dp/B0C5XJV83K', 'about $30'],
    ['Digilent Basys 3', 'amazon.com/dp/B00NUE1WOG', 'about $150 to $200'],
    ['Digilent Nexys A7-100T', 'digilent.com (Nexys A7 page)', 'about $300 to $350']], [2.0 * inch, 3.0 * inch, 1.8 * inch]))
story.append(Paragraph('Prices change; see fpga/docs/BUYING.md.', SM))
story.append(Paragraph('Reference documents', H2))
for t in ['Sipeed Tang Nano 20K wiki and schematic: wiki.sipeed.com/hardware/en/tang/tang-nano-20k/nano-20k.html; official examples and constraints: github.com/sipeed/TangNano-20K-example',
          'Gowin GW2A family data sheet and primitive user guides (rPLL, CLKDIV, OSER10, ELVDS_OBUF): gowinsemi.com',
          'Digilent Nexys A7 Reference Manual and schematic: digilent.com/reference/programmable-logic/nexys-a7/reference-manual',
          'Digilent Basys 3 Reference Manual and schematic: digilent.com/reference/programmable-logic/basys-3/reference-manual',
          'Digilent master constraint files: github.com/Digilent/digilent-xdc',
          'AMD 7 Series FPGAs Data Sheet: Overview (DS180); Artix-7 DC and AC Switching Characteristics (DS181): docs.amd.com',
          'AMD 7 Series user guides: CLB (UG474), Memory Resources (UG473), Clocking (UG472), DSP48E1 (UG479): docs.amd.com']:
    story.append(Paragraph(t, B, bulletText='\u2022'))
story.append(Paragraph('Status and limits', H2))
story.append(Paragraph('The design is verified in simulation and its resources are estimated with Yosys; timing closure and on-board behaviour must be confirmed with Vivado\'s reports and a physical board. Electrical characteristics, power and ratings are those of the evaluation board: see the vendor documents above.', P))
story.append(Paragraph(f'Revision {VERSION}, generated {datetime.date.today().isoformat()} by fpga/docs/datasheet.py.', SM))

doc = SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.6 * inch, rightMargin=0.6 * inch, topMargin=0.62 * inch, bottomMargin=0.6 * inch,
                        title='Pixelstorm-F datasheet', author='Pixelstorm project', subject='Open-source FPGA GPU')
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print('wrote', os.path.relpath(OUT, ROOT))
