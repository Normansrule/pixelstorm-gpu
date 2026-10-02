# Board reference: Digilent Nexys A7-100T

A concise reference for running Pixelstorm on this board. For anything electrical, **the official documents are authoritative**:

| Document | Where |
|---|---|
| Nexys A7 Reference Manual (board features, schematic, pinout) | <https://digilent.com/reference/programmable-logic/nexys-a7/reference-manual> |
| Master constraints file `Nexys-A7-100T-Master.xdc` | <https://github.com/Digilent/digilent-xdc> |
| AMD 7 Series FPGAs Data Sheet: Overview (DS180) | search `DS180` on <https://docs.amd.com> |
| AMD Artix-7 DC and AC Switching Characteristics (DS181) | search `DS181` on <https://docs.amd.com> |
| 7 Series CLB (UG474), Memory Resources (UG473), Clocking (UG472), DSP48E1 (UG479) | <https://docs.amd.com> |

## The board at a glance

| Item | Value |
|---|---|
| FPGA | AMD (Xilinx) Artix-7 **XC7A100T-1CSG324C** |
| Logic | 15,850 slices: 63,400 six-input LUTs, 126,800 flip-flops |
| Block RAM | 135 × 36 Kb (4,860 Kb) |
| DSP slices | 240 DSP48E1 |
| Clocking | 100 MHz oscillator on pin E3; 6 clock-management tiles (MMCM + PLL) |
| On-board memory | 128 MiB DDR2 (not used by Pixelstorm yet) |
| User I/O used here | 16 switches, 16 LEDs, centre button, CPU reset, 8-digit 7-segment, 12-bit VGA, USB-UART |
| Programming | USB (JTAG) through the on-board FTDI chip; Vivado Hardware Manager or openFPGALoader |

## How Pixelstorm uses it

| Board item | Pin(s) | Pixelstorm function |
|---|---|---|
| CLK100MHZ | E3 | MMCM makes the 25 MHz pixel and GPU clock |
| CPU_RESETN | C12 | reset (active low) |
| BTNC | N17 | **start** the selected kernel |
| SW1..SW0 | L16, J15 | kernel: 0 gradient, 1 triangle, 2 Mandelbrot, 3 Mandelbrot zoom |
| SW15..SW14 | V10, U11 | GPU speed: full, 1/64, 1/1024, 1/16384 |
| VGA R/G/B[3:0], HS, VS | A3 B4 C5 A4 / C6 A5 B6 A6 / B7 C7 D7 D8, B11, B12 | framebuffer, painting live |
| 7-segment CA..CG, AN[3:0] | T10 R10 K16 K13 P15 T11 L18, J17 J18 T9 J14 | cycle count (hex) |
| LED15, LED14, LED13..12 | V11, V12, V14 V15 | busy, done, kernel |
| UART_RXD_OUT | D4 | `PIXELSTORM k=<n> cycles=<hex>` at 115200 8N1 |

All pins above are 3.3 V (LVCMOS33). SW8 and SW9 sit in a 1.8 V bank on this board; the constraints file sets them to LVCMOS18.
