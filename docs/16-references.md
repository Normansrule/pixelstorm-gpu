# 16. References

> **Appendix**, chapter 16 of 18. About 5 minutes.

---

Everything here is in English. Official documentation first, then open-source GPUs you can read next to Pixelstorm, then books, papers and videos.

## NVIDIA documentation (free)

| Resource | Why read it | Link |
|---|---|---|
| CUDA C++ Programming Guide | the programming model: grids, blocks, warps, memory spaces, SIMT architecture chapter | <https://docs.nvidia.com/cuda/cuda-c-programming-guide/> |
| PTX ISA (Parallel Thread Execution) | NVIDIA's virtual instruction set; compare with [03-isa.md](03-isa.md) | <https://docs.nvidia.com/cuda/parallel-thread-execution/> |
| CUDA Binary Utilities (`cuobjdump`, `nvdisasm`) | how to see real SASS for your own kernels | <https://docs.nvidia.com/cuda/cuda-binary-utilities/> |
| CUDA C++ Best Practices Guide | coalescing, occupancy, bank conflicts from the performance side | <https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/> |
| Architecture whitepapers: Tesla (G80), Fermi, Volta V100, Ampere A100, Hopper H100, Blackwell | each one explains what changed inside the SM and why; search the title on nvidia.com | titles only, URLs change often |

## Open-source GPUs and simulators

| Project | What it is | Link |
|---|---|---|
| tiny-gpu | minimal Verilog GPU for learning, very close in spirit to Pixelstorm | <https://github.com/adam-maj/tiny-gpu> |
| Vortex | full RISC-V-based GPGPU (General-Purpose GPU) that runs OpenCL on FPGAs (Field-Programmable Gate Arrays) | <https://github.com/vortexgpgpu/vortex> |
| GPGPU-Sim | cycle-level simulator of NVIDIA-like GPUs used in hundreds of research papers | <https://github.com/gpgpu-sim/gpgpu-sim_distribution> |
| MIAOW | open RTL implementation of an AMD Southern Islands compute unit | <https://github.com/VerticalResearchGroup/miaow> |
| Nyuzi | open GPU-style multicore processor with its own toolchain | <https://github.com/jbush001/NyuziProcessor> |

## Books

- Tor M. Aamodt, Wilson Wai Lun Fung, Timothy G. Rogers, *General-Purpose Graphics Processor Architectures*, Morgan & Claypool, 2018. The textbook for this repository: SIMT stacks, warp scheduling, memory systems.
- David B. Kirk, Wen-mei W. Hwu, Izzat El Hajj, *Programming Massively Parallel Processors*, 4th ed., Morgan Kaufmann, 2022. The standard CUDA textbook.
- John L. Hennessy, David A. Patterson, *Computer Architecture: A Quantitative Approach*, 6th ed., chapter 4 (data-level parallelism, vector, SIMD and GPU architectures).

## Papers

- E. Lindholm, J. Nickolls, S. Oberman, J. Montrym, "NVIDIA Tesla: A Unified Graphics and Computing Architecture", *IEEE Micro*, 2008. The first SIMT GPU.
- W. W. L. Fung, I. Sham, G. Yuan, T. M. Aamodt, "Dynamic Warp Formation and Scheduling for Efficient GPU Control Flow", MICRO 2007.
- G. Diamos et al., "SIMD Re-Convergence at Thread Frontiers", MICRO 2011.
- S. Collange, "Stack-less SIMT reconvergence at low cost", technical report, 2011.
- NVIDIA, "Volta" (V100) architecture whitepaper, 2017: Independent Thread Scheduling.
- V. Narasiman et al., "Improving GPU Performance via Large Warps and Two-Level Warp Scheduling", MICRO 2011.

## FPGA boards

| Resource | Why | Link |
|---|---|---|
| Digilent Nexys A7 reference manual and schematic | the primary Pixelstorm-F board | <https://digilent.com/reference/programmable-logic/nexys-a7/reference-manual> |
| Digilent Basys 3 reference manual and schematic | the smaller board | <https://digilent.com/reference/programmable-logic/basys-3/reference-manual> |
| Digilent master constraint (XDC) files | pin names used in `fpga/boards/` | <https://github.com/Digilent/digilent-xdc> |
| AMD 7 Series data sheets DS180 and DS181; user guides UG472, UG473, UG474, UG479 | clocking, block RAM, LUTs and distributed RAM, DSP slices | <https://docs.amd.com> |
| openFPGALoader | open-source tool that loads bitstreams over USB | <https://github.com/trabucayre/openFPGALoader> |

## Silicon and layout

| Resource | Why | Link |
|---|---|---|
| SkyWater SKY130 PDK documentation | the open 130 nm process Pixelstorm is placed in: layers, rules, cell libraries | <https://skywater-pdk.readthedocs.io> |
| KLayout | layout viewer and editor; its Python module renders every silicon picture in this repository | <https://www.klayout.de> |
| OpenROAD and OpenROAD-flow-scripts | open placement, clock-tree synthesis and routing; source of the sky130hd platform files `make silicon` downloads | <https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts> |
| OpenLane 2 | the complete open RTL-to-GDS flow | <https://openlane2.readthedocs.io> |
| Yosys | open synthesis, used for the sky130 netlist | <https://yosyshq.net/yosys/> |
| Tiny Tapeout | fabricate a small design on sky130; its GDS viewer shows real taped-out layouts | <https://tinytapeout.com> |
| Zero to ASIC course (Matt Venn) | an English video course through exactly this flow | <https://www.zerotoasiccourse.com> |
| TechPowerUp GPU Database | die photos and specifications of real GPUs | <https://www.techpowerup.com/gpu-specs/> |
| Neil H. E. Weste, David Money Harris, *CMOS VLSI Design*, 4th ed. | the standard textbook for standard cells, layout and physical design | |

## Videos (English; search the titles on YouTube)

- Branch Education, "How do Graphics Cards Work? Exploring GPU Architecture".
- Onur Mutlu, ETH Zürich "Computer Architecture" course, lectures on SIMD processors and GPUs.
- NVIDIA GTC talks titled "How GPU Computing Works" (Stephen Jones).
- Casey Muratori's and Asianometry's videos on GPU history and chip manufacturing, for context.

<!-- chapter-footer -->

---

[Previous: 15. Pixelstorm on an FPGA](15-fpga.md) | [Course map](00-start-here.md) | [Next: 17. Glossary](17-glossary.md)
