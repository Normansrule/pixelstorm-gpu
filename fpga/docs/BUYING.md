# Which board to buy

Pixelstorm-F runs on three boards. All three are verified the same way: the whole board design is simulated (`make fpga-sim`) and every pixel on the captured video frame is checked against the golden model. Prices are approximate and change; check the listing.

| | **Sipeed Tang Nano 20K** | **Digilent Basys 3** | **Digilent Nexys A7-100T** |
|---|---|---|---|
| Typical price | **about $25 to $40** | about $150 to $200 | about $300 to $350 |
| Where | Amazon: <https://www.amazon.com/dp/B0C5XJV83K> | Amazon: <https://www.amazon.com/dp/B00NUE1WOG> | Digilent: <https://digilent.com/reference/programmable-logic/nexys-a7/start> (store link on the page) |
| FPGA | Gowin GW2AR-18 (20,736 LUT4, 15,552 flip-flops) | AMD Artix-7 XC7A35T (20,800 LUT6) | AMD Artix-7 XC7A100T (63,400 LUT6) |
| Pixelstorm build | 1 SM, 16 warps x 2 lanes | 1 SM, 8 warps x 4 lanes | 1 SM, 4 warps x 8 lanes |
| Video out | **HDMI** (DVI 640x480) | VGA | VGA |
| Controls | 2 buttons, 6 LEDs | 16 switches, 5 buttons, 16 LEDs, 4-digit display | 16 switches, buttons, 16 LEDs, 8-digit display |
| Toolchain | **fully open source** (OSS CAD Suite) or Gowin EDA Education (free) | Vivado ML Standard (free) | Vivado ML Standard (free) |
| Mandelbrot kernel | 154,252 cycles, 6.1 ms | 81,661 cycles, 3.3 ms | 46,216 cycles, 1.8 ms |
| Best for | anyone: cheapest, no licences, plugs into a TV (tightest fit: check the utilisation report from `make fpga-tang`) | university labs that use Vivado | the full-width GPU and room to grow (a second SM) |

**Also needed:** a USB-C cable (Tang Nano) or micro-USB cable (Basys 3, Nexys A7), and a monitor with HDMI (Tang Nano) or VGA. Most monitors and TVs accept 640x480. A VGA-to-HDMI adapter works for the Digilent boards if your screen has no VGA input.

**Not recommended for Pixelstorm:** the Tang Nano 9K and smaller iCE40 boards. They are too small for even the 2-lane GPU (the Tang Nano 9K has 8,640 LUT4).

## Official documentation (authoritative for anything electrical)

| Board | Documentation |
|---|---|
| Tang Nano 20K | wiki and schematic: <https://wiki.sipeed.com/hardware/en/tang/tang-nano-20k/nano-20k.html>; examples and constraint files: <https://github.com/sipeed/TangNano-20K-example> |
| Basys 3 | <https://digilent.com/reference/programmable-logic/basys-3/reference-manual> |
| Nexys A7 | <https://digilent.com/reference/programmable-logic/nexys-a7/reference-manual> |
| Gowin GW2A family | data sheet DS102 and user guides on <https://www.gowinsemi.com> (documentation section) |
| AMD Artix-7 | data sheets DS180, DS181 on <https://docs.amd.com> |
