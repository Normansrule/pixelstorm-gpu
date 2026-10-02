# Board reference: Sipeed Tang Nano 20K

The most affordable way to run Pixelstorm on real hardware: about $30, HDMI output, a USB-C cable for power, programming and the serial port, and a fully open-source toolchain. For anything electrical **Sipeed's documents are authoritative**:

| Document | Where |
|---|---|
| Tang Nano 20K wiki (specifications, schematic, pinout) | <https://wiki.sipeed.com/hardware/en/tang/tang-nano-20k/nano-20k.html> |
| Official examples and constraint files (pin numbers used here) | <https://github.com/sipeed/TangNano-20K-example> |
| Gowin GW2A data sheet and primitive user guides | <https://www.gowinsemi.com> |
| Buy | Amazon <https://www.amazon.com/dp/B0C5XJV83K> (also sold by Sipeed on AliExpress) |

## The board at a glance

| Item | Value |
|---|---|
| FPGA | Gowin **GW2AR-LV18QN88C8/I7** |
| Logic | 20,736 LUT4, 15,552 flip-flops |
| Memory | 828 Kb block SRAM (46 x 18 Kb); 64 Mb SDRAM in the package (unused by Pixelstorm) |
| DSP | 18 x 18 multipliers |
| Clocks | 27 MHz crystal on pin 4; 2 PLLs; MS5351 programmable clock generator |
| On-board debugger | BL616: JTAG programming, USB serial, USB-SPI |
| Video | HDMI connector (driven as DVI) |

## How Pixelstorm uses it

| Board item | Pin(s) | Pixelstorm function |
|---|---|---|
| 27 MHz crystal | 4 | rPLL x14/3 = 126 MHz TMDS bit clock; CLKDIV /5 = 25.2 MHz pixel and GPU clock |
| S1 button | 88 | **start** the selected kernel |
| S2 button | 87 | next kernel (gradient, triangle, Mandelbrot, Mandelbrot zoom) |
| LED0..LED5 | 15, 16, 17, 18, 19, 20 | kernel (0, 1), busy (2), done (3), heartbeat (5); active low |
| UART TX | 69 | `PIXELSTORM k=<n> cycles=<hex>` at 115200 8N1 on the USB serial port |
| HDMI TMDS clock | 33 / 34 | 10-bit clock pattern |
| HDMI TMDS data 0, 1, 2 | 35 / 36, 37 / 38, 39 / 40 | blue (+ syncs), green, red, from `fpga/rtl/ps_tmds_enc.v` |

## Build it

```bash
# once: install the OSS CAD Suite (Yosys, nextpnr-himbaechel, gowin_pack, openFPGALoader)
#   https://github.com/YosysHQ/oss-cad-suite-build/releases  -> extract, then: source oss-cad-suite/environment
make fpga-sim           # simulate first: every kernel on this board's GPU shape, pixel-checked
make fpga-tang          # synthesize, place and route, pack, load into the FPGA (SRAM)
bash fpga/boards/tangnano20k/build.sh --flash    # or write it to flash so it survives power-off
```

From WSL, openFPGALoader needs the board's USB device passed through (`usbipd attach`), or run the last step from Windows with the Windows build of openFPGALoader or the Gowin Programmer.

The Gowin EDA Education edition (free, no licence file) also works: create a project for GW2AR-LV18QN88C8/I7, add `rtl/ps_*.v`, `fpga/rtl/*.v` and `fpga/boards/tangnano20k/*`, set the top module to `pixelstorm_tangnano20k`, and run from the repository root so the ROM files in `fpga/gen/` are found.
