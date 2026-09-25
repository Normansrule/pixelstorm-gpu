# 14. References

> **Appendix**, chapter 14 of 16. About 5 minutes.

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

## Videos (English; search the titles on YouTube)

- Branch Education, "How do Graphics Cards Work? Exploring GPU Architecture".
- Onur Mutlu, ETH Zürich "Computer Architecture" course, lectures on SIMD processors and GPUs.
- NVIDIA GTC talks titled "How GPU Computing Works" (Stephen Jones).
- Casey Muratori's and Asianometry's videos on GPU history and chip manufacturing, for context.

<!-- chapter-footer -->

---

[Previous: 13. From Pixelstorm to a real GPU](13-real-world-gpus.md) | [Course map](00-start-here.md) | [Next: 15. Glossary](15-glossary.md)
