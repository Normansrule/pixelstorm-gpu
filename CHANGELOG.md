# Changelog

## v1.6.0
- **Reference test board: Digilent Basys 3** (amazon.com/dp/B00NUE1WOG). Its exact GPU shape (8 warps x 4 lanes) is now simulated on every run, builds default to it (`make fpga-bit`, `make fpga-prog`), and `fpga/docs/BASYS3-QUICKSTART.md` takes it from the box to a running GPU with the readings you should see.
- **Kernel upload over USB serial.** `./pixelstorm upload K --port ...` sends any kernel (up to 256 instructions, with its arguments) to the board, which stores it in slot 3, shows its name and runs it: no new bitstream. New `ps_uart_rx.v` and `ps_uploader.v` (checksummed packet, timeout resync); works on all three boards (Basys 3 RsRx B18, Nexys A7 C4, Tang Nano pin 70).
- New demo kernel `fpga/kernels/rings.psa` (not in ROM), uploaded and pixel-checked in simulation; a corrupted upload is verified to be rejected.
- `make fpga-sim` covers all three GPU shapes (12 board runs), the upload and the TMDS encoder; LED11 shows a good upload.

## v1.5.0
- **Tang Nano 20K (about $30 on Amazon).** New board: Sipeed Tang Nano 20K (Gowin GW2AR-18) with a 16-warp x 2-lane GPU, **HDMI output**, two-button control and a fully open-source build (`make fpga-tang`: Yosys, nextpnr-himbaechel, gowin_pack, openFPGALoader). Pins from Sipeed's official examples.
- **TMDS encoder** (`fpga/rtl/ps_tmds_enc.v`) for DVI/HDMI, verified symbol by symbol against a reference decoder.
- **On-screen status line** on every board: kernel name, RUNNING, then the cycle count in decimal (font ROM from the public-domain font8x8, hardware double-dabble converter).
- `make fpga-sim` now checks every kernel on both GPU shapes plus the TMDS encoder; buying guide (`fpga/docs/BUYING.md`) with Amazon links; Tang Nano board reference; datasheet covers all three boards.
- ROM file paths are repository-relative, so Vivado, Yosys and Gowin EDA all find them when run from the repository root.

## v1.4.0
- **FPGA edition (Pixelstorm-F).** `fpga/`: block-RAM global memory with a video port, hardware kernel loader with four ROM slots, 640x480 VGA framebuffer output, UART status line, 7-segment cycle counter, slow-motion GPU clock. Board wrappers and constraints for the Digilent Nexys A7-100T and Basys 3; Vivado build and program scripts; `make fpga-sim`, `fpga-bit`, `fpga-prog`.
- **Board simulation.** The whole FPGA design runs in Icarus Verilog; one VGA frame per kernel is captured and every framebuffer pixel is checked against the golden model. Runs in CI.
- **Banked register file and shared memory.** One register bank per lane and one RAM per shared-memory bank: identical behaviour (all 46 runs cycle-exact), and the FPGA core shrinks from 164,482 to 30,508 LUTs.
- **Datasheet.** `fpga/docs/pixelstorm-fpga-datasheet.pdf`, generated from the repository; board references linking to the vendors' manuals.
- Chapter 15, "Pixelstorm on an FPGA"; appendix renumbered to 16 to 18.
- Note: the committed SkyWater 130 nm numbers and GDS (chapter 14) come from the v1.3 RTL. Run `make silicon` to refresh them for the banked register file (synthesis now takes longer: Yosys maps many small memories); the `silicon` release workflow rebuilds the GDS automatically.

## v1.3.0
- **A real cache.** `rtl/ps_cache.v`: shared, direct-mapped, write-through cache between the memory arbiter and DRAM, mirrored cycle for cycle in the golden model. `CACHE_LINES = 0` (the default) is plain wiring, so every earlier result is unchanged.
- `.cache N` directive and `--cache N` option; kernel 16 `matmul_cached` (3,567 to 2,687 cycles, 80% hits).
- `./pixelstorm test` now also runs every kernel on the cached GPU and checks the hit/miss sequence against the model (45 runs).
- 3D explorer: the cache becomes solid when a cached kernel runs; hits flash green and turn around at the cache. New tour stop, "A real cache". New figure and section in chapter 8.

## v1.2.0
- 14-stop zooming 3D tour: where instructions come from, registers, shared memory, DRAM versus caches, rasterization, the framebuffer; memory-hierarchy ladder.
- Silicon numbers single-sourced from `web/data/silicon.json`; CI prints stale files.

## v1.1.0
- SkyWater 130 nm silicon: Yosys synthesis, placed GDS, KLayout renders, silicon page, chapter 14.

## v1.0.0
- Pixelstorm: Verilog GPU, 15 kernels verified cycle for cycle, 3D explorer, visualizer, labs, course.
