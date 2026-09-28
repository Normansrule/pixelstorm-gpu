# Pixelstorm: a GPU you can watch paint

> **Course map.** Start here. The whole course takes about 5 hours; after Part 1, each chapter stands on its own.

![Three images rendered by the Pixelstorm Verilog](img/fig-gallery.svg)

Pixelstorm is a small but complete GPU (Graphics Processing Unit) written in Verilog, and the three images above were computed by it, pixel by pixel, in a hardware simulation. The name is the job: a GPU runs the same little program on a storm of pixels at once, one thread per pixel, with the threads of each warp marching in lockstep. Almost every hard topic in GPU design is about what happens when that lockstep breaks (divergence) or stalls (memory), and Pixelstorm lets you watch both, one clock cycle at a time.

## Four ways to learn

| | Best for | Open |
|---|---|---|
| **3D chip explorer** | flying around the die while it runs a real simulation; click any block to learn what it does | [chip explorer](https://normansrule.github.io/pixelstorm-gpu/chip.html) |
| **Guided tour** | a 15-minute first look: twelve moments in real simulations, from one instruction to a rendered fractal | [visualizer, then press Guided tour](https://normansrule.github.io/pixelstorm-gpu/visualizer.html?tour) |
| **Labs** | building intuition with sliders: coalescing, banks, divergence, latency hiding, occupancy, pixels and warps | [labs](https://normansrule.github.io/pixelstorm-gpu/labs.html) |
| **This course** | understanding it properly, down to the Verilog | the chapters below |

![The 3D chip explorer replaying the Mandelbrot kernel](img/chip.gif)

## The chapters

### Part 1: Concepts

| Chapter | Time | You will learn |
|---|---|---|
| [1. What a GPU is](01-what-is-a-gpu.md) | 10 min | Why a GPU spends its transistors on arithmetic instead of caches and prediction |
| [2. SIMT: threads, warps and blocks](02-simt-warps-blocks.md) | 15 min | How a CUDA launch (grid, blocks, threads) maps onto warps and lanes |
| [3. The Pixelstorm instruction set](03-isa.md) | 20 min | The 32-bit instruction format, field by field |

### Part 2: The hardware

| Chapter | Time | You will learn |
|---|---|---|
| [4. Microarchitecture: the block diagram](04-microarchitecture.md) | 20 min | What every Verilog module does and how they connect |
| [5. Life of one instruction](05-instruction-lifecycle.md) | 15 min | One real LDG followed through every clock cycle of the RTL simulation |
| [6. Reading the RTL](06-reading-the-rtl.md) | 30 min | A recommended order for reading the 980 lines of Verilog |

### Part 3: Performance

| Chapter | Time | You will learn |
|---|---|---|
| [7. Divergence and reconvergence](07-divergence.md) | 20 min | What happens when the lanes of one warp take different branches |
| [8. Memory: coalescing and banks](08-memory.md) | 25 min | The memory hierarchy, from registers to DRAM |
| [9. Synchronization: barriers, shuffles, votes, atomics](09-synchronization.md) | 20 min | How threads cooperate at warp, block and grid scope |

### Part 4: Applications and graphics

| Chapter | Time | You will learn |
|---|---|---|
| [10. Applications: the 15 kernels](10-applications.md) | 20 min | What each example kernel does and which hardware feature it exposes |
| [11. Graphics: pixels, triangles and fractals](11-graphics.md) | 30 min | Why "one thread per pixel" is the reason GPUs exist |

### Part 5: Build on it

| Chapter | Time | You will learn |
|---|---|---|
| [12. Make it better](12-make-it-better.md) | 30 min | Nine concrete improvements, each one a real idea in commercial GPUs |
| [13. From Pixelstorm to a real GPU](13-real-world-gpus.md) | 15 min | How to recognize the parts on a real graphics card and in a die photo |
| [14. From Verilog to silicon](14-silicon.md) | 35 min | How the same Verilog becomes {cells} real SkyWater 130 nm standard cells and {mtr} million transistors |

### Appendix

| Chapter | Time | You will learn |
|---|---|---|
| [15. References](15-references.md) | 5 min |  |
| [16. Glossary](16-glossary.md) | 5 min |  |
| [17. Troubleshooting](17-troubleshooting.md) | 5 min |  |

## How each chapter is laid out

Every chapter opens with what you will learn and where to see it live, uses figures drawn from real simulation traces, and ends with **Check yourself** questions (click a question to reveal the answer) and links to the previous and next chapter.

## Before you start

Nothing needs installing for the tour, the labs or the course. To run the Verilog yourself on Ubuntu or WSL2 (Windows Subsystem for Linux):

```bash
git clone https://github.com/Normansrule/pixelstorm-gpu.git && cd pixelstorm-gpu
bash scripts/setup_ubuntu.sh        # Icarus Verilog, Verilator, GTKWave, Yosys, Node.js
./pixelstorm test                     # every kernel: RTL == golden model, cycle for cycle
./pixelstorm help                     # everything else
```

## How correctness is checked

`./pixelstorm test` runs every kernel on the Register-Transfer Level (RTL) Verilog with one SM (Streaming Multiprocessor) and with two, and compares three things: the final contents of all 65,536 words of global memory against the golden model; the exact sequence of instruction commits (same cycle, SM, warp, PC and active mask); and the answer itself, computed independently in `tests/expected.js`. A hardware change passes only when all three agree.

---

[Next: 1. What a GPU is](01-what-is-a-gpu.md)
