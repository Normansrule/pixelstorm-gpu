# Basys 3 quick start: Pixelstorm on the reference board

The **Digilent Basys 3** is Pixelstorm's reference test board: every release is simulated on its exact GPU shape, and these steps take it from the box to a GPU drawing on your monitor.

**Board:** Digilent Basys 3 Artix-7 FPGA Trainer Board, <https://www.amazon.com/dp/B00NUE1WOG>
**Official manual and schematic:** <https://digilent.com/reference/programmable-logic/basys-3/reference-manual>

## What you need

| Item | Notes |
|---|---|
| Digilent Basys 3 | AMD Artix-7 XC7A35T-1CPG236C |
| Micro-USB cable | power, programming (JTAG) and the serial port, all on one cable; not included with the board |
| VGA monitor, or a VGA-to-HDMI adapter | 640 x 480 at 60 Hz; almost every monitor accepts it |
| Vivado ML Standard | free from AMD (supports the XC7A35T); about 50 GB installed |
| A serial terminal | PuTTY or Tera Term on Windows, `screen` or `minicom` on Linux |

## 1. Simulate first (no hardware needed)

```bash
make fpga-sim
```

This simulates the **whole Basys 3 design** (the 8-warp x 4-lane GPU, loader, block-RAM memory, VGA, UART) for every kernel, captures a full VGA frame from the video pins, and checks every pixel against the golden model. It also uploads `fpga/kernels/rings.psa` over the simulated serial pin and confirms a corrupted upload is rejected. If anything here fails, the board will not work either.

## 2. Build the bitstream

```bash
source /tools/Xilinx/Vivado/<version>/settings64.sh      # wherever Vivado is installed
make fpga-bit                                             # BOARD=basys3 is the default
```

Before programming, read the two reports in `build/fpga/basys3/`:

| Report | What to check |
|---|---|
| `utilization.rpt` | LUTs under 100% (the GPU core alone is estimated at 72% of the XC7A35T) |
| `timing.rpt` | **WNS (worst negative slack) is not negative** at 25 MHz. If it is, the design cannot run at 25 MHz as built: see chapter 12, exercise 1 (pipelining) |

Prefer the GUI? Create an RTL project for part `xc7a35tcpg236-1`, add `rtl/ps_*.v`, `fpga/rtl/*.v`, `fpga/boards/clocking_xc7.v` and `fpga/boards/basys3/pixelstorm_basys3.v` as sources, `fpga/boards/basys3/basys3.xdc` as constraints and `fpga/gen/*.hex` as memory files, set `pixelstorm_basys3` as top and add the define `SYNTHESIS`. Keep the project in the repository root so the ROM paths `fpga/gen/...` resolve.

## 3. Program the board

Plug in the USB cable, set the power switch to ON and the mode jumper (JP1) to JTAG, then:

```bash
make fpga-prog                                            # openFPGALoader, or:
vivado -mode batch -source fpga/vivado/program.tcl -tclargs basys3
```

On Windows, Vivado's Hardware Manager (Open Target, Auto Connect, Program Device) is usually simplest.

## 4. What you should see

| Do this | You should see |
|---|---|
| Programming finishes | the monitor shows a dark screen with a blue frame and **PRESS START** in the status line |
| Set sw1..sw0 = 10 (Mandelbrot), press **btnC** | an amber bar, LED15 on, the Mandelbrot set appears almost at once |
| When it finishes | a green bar, LED14 on, the status line reads **MANDELBROT 81660 CYCLES**, the 7-segment display shows **3EFC** (the low 16 bits of the count in hex), the serial port prints `PIXELSTORM k=2 cycles=00013EFC` |
| Set sw15..sw14 = 10 (1/1024 speed), press btnC again | the image clears and paints in over about three seconds: you are watching warps take turns |
| Try the other kernels (sw1..sw0 = 00, 01, 11) | gradient, triangle, Mandelbrot zoom |
| Press **btnU** | reset |
| Look at the second status row after any run | **INSTR**, **SIMD** and **MEM**: the GPU's own performance counters (see step 7) |

Expected readings on the Basys 3 for every kernel (from `make fpga-sim`, also in `fpga/docs/verification.json`). Real hardware runs the same circuit, so it should show exactly these numbers:

| sw1..sw0 | Kernel | Status line | 7-segment | Serial port |
|---|---|---|---|---|
| 00 | gradient shader | GRADIENT_SHADER 28000 CYCLES | 6D60 | `PIXELSTORM k=0 cycles=00006D60` |
| 01 | triangle rasterizer | TRIANGLE_RASTER 61280 CYCLES | EF60 | `PIXELSTORM k=1 cycles=0000EF60` |
| 10 | Mandelbrot set | MANDELBROT 81660 CYCLES | 3EFC | `PIXELSTORM k=2 cycles=00013EFC` |
| 11 | Mandelbrot zoom | MANDELBROT_ZOOM 138885 CYCLES | 1E85 | `PIXELSTORM k=3 cycles=00021E85` |

## 5. Read the serial port

The Basys 3's USB cable also carries a serial port (the second interface of its FTDI chip). Settings: **115200 baud, 8 data bits, no parity, 1 stop bit**.

- Windows: Device Manager shows it as a COM port (for example COM5); open it in PuTTY.
- Linux: usually `/dev/ttyUSB1`: `screen /dev/ttyUSB1 115200`.
- WSL: attach the board first with `usbipd` (`usbipd list`, then `usbipd bind` and `usbipd attach --wsl --busid <id>`).

## 6. Run your own kernels, no new bitstream

Write a kernel with a `.fb` framebuffer (like `fpga/kernels/rings.psa`), then:

```bash
./pixelstorm sim fpga/kernels/rings.psa                          # check it on the golden model first
./pixelstorm upload fpga/kernels/rings.psa --port /dev/ttyUSB1   # Linux or WSL with usbipd
./pixelstorm upload fpga/kernels/rings.psa --param 1=40 --port /dev/ttyUSB1   # change a kernel argument
```

From Windows without WSL USB access, write the packet to a file and send it with PowerShell:

```bash
./pixelstorm upload fpga/kernels/rings.psa --out rings.bin
```
```powershell
$p = New-Object System.IO.Ports.SerialPort COM5,115200,None,8,One; $p.Open()
$b = [IO.File]::ReadAllBytes("rings.bin"); $p.Write($b, 0, $b.Length); $p.Close()
```

The board stores the kernel in slot 3, runs it immediately, shows its name in the status line and lights **LED11** if the checksum was good. Limits: at most 256 instructions, 32 threads per block, a framebuffer in the first 32 KB.

## 7. Read the GPU's performance counters

After every kernel the second status row shows three hardware counters, the same metrics a GPU profiler such as NVIDIA Nsight Compute reports:

| Counter | Meaning |
|---|---|
| INSTR | warp instructions retired |
| SIMD | lane-operations / (INSTR x 4 lanes): how much of the GPU did useful work. Divergence lowers it |
| MEM | memory transactions the arbiter granted (after coalescing) |

The serial line carries them too: `... instr=<hex> lanes=<hex> mem=<hex>`. `make fpga-sim` checks every counter against the golden model, so the board's numbers are exact, not estimates. Try it: the gradient shader has no branches (100% SIMD), the Mandelbrot set diverges at its edge (well below 100%).

Expected second-row readings on the Basys 3 (measured in `make fpga-sim`; the board should show exactly these):

| Kernel | INSTR | SIMD | MEM |
|---|---|---|---|
| gradient_shader | 5,120 | 100% | 256 |
| triangle_raster | 11,776 | 99% | 256 |
| mandelbrot | 16,092 | 81% | 128 |
| mandelbrot_zoom | 27,537 | 76% | 128 |

## 8. Animation and live arguments

| Switch | Effect |
|---|---|
| sw2 = 1 | **animation**: the board re-runs the kernel continuously, writing the frame number into constant `c[15]` before every run |
| sw13..sw3 | a live 11-bit argument, written into constant `c[14]` at every launch |

Kernels that read `c[15]` or `c[14]` animate or respond to the switches. Try it with the uploaded rings:

```bash
./pixelstorm upload fpga/kernels/rings.psa --port /dev/ttyUSB1
```

then set **sw2 = 1**: the rings flow outward. Flip sw13..sw3 and the colours shift while it runs. The four ROM kernels ignore `c[14]` and `c[15]`, so they look the same each frame. Set sw2 back to 0 to stop on the current frame.

## Troubleshooting

| Symptom | Check |
|---|---|
| Monitor says "no signal" | the VGA cable; that programming finished; press btnU to reset |
| Image but nothing happens on btnC | LED15 should light: if not, check the build used `basys3.xdc` |
| Wrong colours or a shifted image | compare `basys3.xdc` with Digilent's `Basys-3-Master.xdc` for your board revision |
| No serial output | the second COM port, not the first; 115200 8N1 |
| Upload does nothing, LED11 off | the checksum failed or the packet was cut: resend; check `./pixelstorm upload` printed the byte count |
| `timing.rpt` shows negative slack | reduce the GPU clock (MMCM `CLKOUT0_DIVIDE_F` in `fpga/boards/clocking_xc7.v`) and the VGA timing will need a matching clock, or pipeline the SM |
