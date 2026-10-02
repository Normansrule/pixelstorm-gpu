# 17. Glossary

> **Appendix**, chapter 17 of 18. About 5 minutes.

---

Terms as they are used in this course. Where NVIDIA uses a different name, it is given in brackets.

| Term | Meaning | Where you see it |
|---|---|---|
| **Active mask** | The lanes of a warp that are at the PC being issued this time. Lanes at other PCs wait (divergence). | `cact` in `ps_sm.v`; green dots in the visualizer's scheduler |
| **ALU (Arithmetic Logic Unit)** | The circuit in each lane that adds, multiplies, compares. NVIDIA markets these as "CUDA cores". | `rtl/ps_alu.v` |
| **Arbiter** | Decides which requester uses a shared resource next. Pixelstorm's memory arbiter shares one DRAM port between SMs, round robin. | `rtl/ps_mem_arbiter.v` |
| **Atomic** | A read-modify-write that no other thread can interrupt, so no update is lost. | `ATOM`, `ATOMS`; kernel 06 |
| **Bank / bank conflict** | Shared memory is split into banks that each serve one word per cycle. Lanes hitting one bank at different words must take turns. | chapter 8; bank lab |
| **Barrier** | A point every warp of a block must reach before any continues. | `BAR` = `__syncthreads()`; chapter 9 |
| **Barycentric weights** | How much each corner of a triangle contributes at a pixel; the three edge-function values divided by the area. Used to blend colors, texture coordinates and depth. | chapter 11; `14_triangle_raster` |
| **Bitstream** | The configuration file that wires an FPGA into a particular circuit. | `make fpga-bit` |
| **Block** [CTA, Cooperative Thread Array] | A group of threads that runs on one SM and can share memory and barriers. | `.block`; chapter 2 |
| **Block RAM (BRAM)** | Dedicated memory blocks inside an FPGA (36 Kb each on Artix-7). | `fpga/rtl/ps_bram_mem.v` |
| **Broadcast** | Several lanes reading the same word get it in one access. | coalescing and bank figures |
| **Cache** | A small fast memory that keeps copies of recently used data so repeated reads skip DRAM. | `rtl/ps_cache.v`, chapter 8 |
| **Cache hit / miss** | A hit finds the line in the cache; a miss has to fetch it from the next level. | green and amber packets in the 3D explorer |
| **CMOS (Complementary Metal-Oxide-Semiconductor)** | Logic built from pairs of PMOS and NMOS transistors; every standard cell is CMOS. | chapter 14 |
| **Coalescing** | Combining the memory requests of many lanes into as few line-sized transactions as possible. | chapter 8; coalescing lab |
| **Constant bank** | Small read-only memory holding kernel arguments. | `LDC Rd, c[i]`, `.param` |
| **CUDA** | NVIDIA's programming platform for GPUs (C++ with kernels, grids and blocks). | CUDA versions in every kernel header |
| **Decap cell** | A standard cell that is only a capacitor, placed in gaps to steady the supply voltage. | chapter 14 |
| **Direct-mapped** | Each address can live in exactly one cache line, chosen by its index bits. | `rtl/ps_cache.v` |
| **Dispatcher** | Hands thread blocks to idle SMs. | `rtl/ps_dispatcher.v` |
| **Distributed RAM (LUTRAM)** | Small memories built from an FPGA's lookup tables; cheap multi-port storage. | the per-lane register banks |
| **Divergence** | Lanes of one warp needing different instructions (usually after a branch). The warp runs the paths one after another. | chapter 7; divergence lab |
| **DRAM (Dynamic Random-Access Memory)** | Large, slow off-chip memory; the GPU's global memory. GDDR and HBM (High Bandwidth Memory) are kinds of DRAM. | DRAM model in `sim/tb_gpu.v` |
| **DRC (Design Rule Checking)** | Verifying a layout obeys the foundry's geometric rules (widths, spacings, enclosures). | chapter 14 |
| **DVI (Digital Visual Interface)** | The digital video standard HDMI grew out of; an HDMI monitor accepts a plain DVI signal. | Tang Nano build |
| **Edge function** | A linear function that is zero on a triangle edge and positive on its inner side. Three of them decide whether a pixel is inside. | chapter 11 |
| **Execution mask** | Active mask AND the guard predicate: the lanes that really execute. | `cexe` |
| **FPGA (Field-Programmable Gate Array)** | A chip of lookup tables, flip-flops, RAMs and multipliers that can be configured into any circuit. | chapter 15 |
| **Framebuffer** | An image in memory, one word per pixel. Pixelstorm packs colors as `0x00RRGGBB`. | `.fb`; the framebuffer panel in the visualizer |
| **FSM (Finite State Machine)** | The control logic that steps an instruction through SCHED, FETCH, DECODE, EXEC, MEM, WB. | chapter 4 |
| **GDS (Graphic Design System)** | The file format of a chip layout: polygons on numbered layers. What a foundry manufactures from. | `build/silicon/ps_s130.gds` |
| **Global memory** | Memory visible to every thread of every block; lives in DRAM. | `LDG`, `STG` |
| **Golden model** | A simple, trusted reference implementation the hardware is compared against. Pixelstorm's is cycle-exact. | `web/js/pixelstorm.js`; `./pixelstorm test` |
| **Grid** | Every thread of one kernel launch. | `.grid` |
| **Guard / predicate** | A per-thread 1-bit condition (`P0` to `P3`) that can switch an instruction off for that thread. | `@P0`, `SETP` |
| **HDMI (High-Definition Multimedia Interface)** | Digital video and audio link; carries TMDS-encoded pixels on three data lanes plus a clock lane. | Tang Nano build |
| **IPC (Instructions Per Cycle)** | Warp instructions completed per clock cycle. A pipelined SM approaches 1. | stats bar in the visualizer |
| **Kernel** | A function that runs on the GPU, once per thread. | `kernels/*.psa` |
| **Lane** | One thread's slot in a warp; also the hardware (ALU plus register slice) serving it. | 8 per warp in Pixelstorm, 32 on NVIDIA |
| **Latency hiding** | Keeping the chip busy during slow memory accesses by running other warps. | latency lab; chapter 11 |
| **Line / sector** | The unit DRAM delivers: 4 words here, 32-byte sectors in 128-byte lines on NVIDIA. | `LINE_WORDS` |
| **LUT (Lookup Table)** | The basic FPGA logic element: a tiny memory that implements any function of its (six) inputs. | chapter 15 |
| **LVS (Layout Versus Schematic)** | Checking that the transistors and wires in the layout match the netlist. | chapter 14 |
| **Min-PC reconvergence** | Always issue the lowest PC among a warp's live lanes; diverged lanes rejoin when their PCs match. | chapter 7 |
| **MMCM (Mixed-Mode Clock Manager)** | The Xilinx 7-series block that makes new clock frequencies from an input clock. | `fpga/boards/clocking_xc7.v` |
| **Occupancy** | Resident warps per SM divided by the maximum. Limited by registers, shared memory, thread and block slots. | occupancy lab |
| **PC (Program Counter)** | Address of the next instruction. In Pixelstorm every thread has its own. | `lpc` |
| **PDK (Process Design Kit)** | Everything a foundry provides to design for its process: layers, rules, device models, standard cells. | SkyWater SKY130 |
| **Performance counter** | A hardware counter of events (instructions, active lanes, memory transactions) read after a run; what profilers report. | `perf_instr`, `perf_lanes`, `perf_mem` in `rtl/ps_gpu_top.v` |
| **Pixel shader** [fragment shader] | The small program run once per pixel to compute its color. | kernels 12 to 15 |
| **Placement** | Choosing a legal position for every standard cell in the rows of the core. | `tools/silicon/place.py` |
| **PTX (Parallel Thread Execution)** | NVIDIA's virtual instruction set; compiled to SASS by the driver. | ISA table, chapter 3 |
| **Quad** | A 2 x 2 block of pixels shaded together; GPUs pack quads into warps so nearby pixels share a warp. | pixels lab |
| **Rasterization** | Finding which pixels a triangle covers. | chapter 11 |
| **Register file** | Per-thread registers, all stored in one big on-chip array per SM. | `rf`; inspector panel |
| **ROP (Raster Operations Pipeline)** | Fixed-function unit that does depth testing and blending and writes the framebuffer. | chapter 11 |
| **Routing** | Drawing the metal wires that connect placed cells; the step after placement. | chapter 14, OpenROAD |
| **RTL (Register-Transfer Level)** | Hardware described as registers and the logic between them; here, Verilog. | `rtl/` |
| **SASS** | NVIDIA's native GPU machine code, shown by `cuobjdump -sass`. | chapter 12 |
| **Scoreboard** | Tracks registers with results still pending so a warp can keep issuing independent instructions. | exercise 2, chapter 11 |
| **Shared memory** | Fast on-SM scratchpad shared by the threads of one block. | `LDS`, `STS`; `__shared__` |
| **Shuffle** | Reading a register of another lane in the same warp, without memory. | `SHFL`; `__shfl_sync` |
| **SIMD (Single Instruction, Multiple Data)** | One instruction operating on many data elements. | |
| **SIMD efficiency** | Useful lane operations divided by lane slots issued. 100% means no lane was ever idle. | stats bar; "warp execution efficiency" in Nsight Compute |
| **SIMT (Single Instruction, Multiple Threads)** | NVIDIA's model: each lane is a real thread with its own registers and PC, but a warp shares one instruction stream. | chapter 2 |
| **SM (Streaming Multiprocessor)** [CU, Compute Unit, on AMD] | The GPU's core: scheduler, lanes, register file, shared memory, load/store unit. | `rtl/ps_sm.v` |
| **Standard cell** | A pre-drawn, pre-characterized gate of fixed height that tiles into rows. | chapter 14 |
| **Synthesis** | Translating Verilog into a netlist of standard cells. | Yosys, `make silicon` |
| **Tap cell** | A cell that ties the n-well and substrate to the supplies at regular intervals to prevent latch-up. | chapter 14 |
| **Tapeout** | Sending the final GDS to the foundry to be manufactured. | chapter 14 |
| **Tensor Core** | A unit that multiplies small matrices in one instruction. | exercise 5, chapter 11 |
| **Texture unit** | Fixed-function unit that fetches and filters image data for shaders. | chapter 11 |
| **Thread** | One instance of the kernel, with its own registers and index. | |
| **TMDS (Transition-Minimized Differential Signaling)** | The 8b/10b line code of DVI and HDMI: few bit transitions, DC balanced. | `fpga/rtl/ps_tmds_enc.v` |
| **Trace** | The event log of a run (every commit, memory request, barrier). Both RTL and model print the same format. | `web/traces/*.json` |
| **Transaction** | One DRAM request for one line. | load/store unit box |
| **VCD (Value Change Dump)** | Waveform file format written by the simulator, opened in GTKWave. | `./pixelstorm rtl <k> --vcd` |
| **VGA (Video Graphics Array)** | The analog video standard: red, green, blue and two sync signals; 640x480 at 60 Hz here. | `fpga/rtl/ps_vga.v` |
| **Vote** | Combining one predicate bit from every lane of a warp. | `VOTE`; `__ballot_sync` |
| **Warp** [wavefront on AMD] | Threads that share one instruction stream: 8 in Pixelstorm, 32 on NVIDIA, 32 or 64 on AMD. | everywhere |
| **Warp scheduler** | Chooses which warp issues next. | scheduler box, chapter 4 |
| **Write-through** | Every write goes on to memory immediately; the cache copy is updated too. | `rtl/ps_cache.v` |
| **Writeback** | The stage that stores results into registers and advances PCs. | WB state |

<!-- chapter-footer -->

---

[Previous: 16. References](16-references.md) | [Course map](00-start-here.md) | [Next: 18. Troubleshooting](18-troubleshooting.md)
