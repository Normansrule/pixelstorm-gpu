# Board reference: Digilent Basys 3 (Pixelstorm's reference test board)

Buy: <https://www.amazon.com/dp/B00NUE1WOG>. Step-by-step bring-up: [BASYS3-QUICKSTART.md](BASYS3-QUICKSTART.md).

A concise reference for running Pixelstorm on this board. For anything electrical, **the official documents are authoritative**:

| Document | Where |
|---|---|
| Basys 3 Reference Manual (board features, schematic, pinout) | <https://digilent.com/reference/programmable-logic/basys-3/reference-manual> |
| Master constraints file `Basys-3-Master.xdc` | <https://github.com/Digilent/digilent-xdc> |
| AMD 7 Series FPGAs Data Sheet: Overview (DS180) and Artix-7 switching characteristics (DS181) | <https://docs.amd.com> |

## The board at a glance

| Item | Value |
|---|---|
| FPGA | AMD (Xilinx) Artix-7 **XC7A35T-1CPG236C** |
| Logic | 5,200 slices: 20,800 six-input LUTs, 41,600 flip-flops |
| Block RAM | 50 × 36 Kb (1,800 Kb) |
| DSP slices | 90 DSP48E1 |
| Clocking | 100 MHz oscillator on pin W5; 5 clock-management tiles |
| User I/O used here | 16 switches, 16 LEDs, 5 buttons, 4-digit 7-segment, 12-bit VGA, USB-UART |
| Programming | USB (JTAG); Vivado Hardware Manager or openFPGALoader (`-b basys3`) |

## How Pixelstorm uses it

| Board item | Pin(s) | Pixelstorm function |
|---|---|---|
| clk | W5 | MMCM makes the 25 MHz pixel and GPU clock |
| btnU | T18 | reset |
| btnC | U18 | **start** the selected kernel |
| sw1..sw0 | V16, V17 | kernel: 0 gradient, 1 triangle, 2 Mandelbrot, 3 Mandelbrot zoom |
| sw15..sw14 | R2, T1 | GPU speed: full, 1/64, 1/1024, 1/16384 |
| vgaRed/Green/Blue[3:0], Hsync, Vsync | G19 H19 J19 N19 / J17 H17 G17 D17 / N18 L18 K18 J18, P19, R19 | framebuffer |
| seg[6:0], an[3:0] | W7 W6 U8 V8 U5 V5 U7, U2 U4 V4 W4 | cycle count (hex) |
| led15, led14 | L1, P1 | busy, done |
| RsTx | A18 | status line at 115200 8N1 |
| RsRx | B18 | kernel upload from the PC (`./pixelstorm upload`) |
| led11 | U3 | last upload received with a good checksum |

The Basys 3 build uses a leaner GPU (1 SM, 8 warps × 4 lanes, 4 shared-memory banks) so it fits the smaller FPGA; every demo kernel still runs unchanged because blocks are still 32 threads.
