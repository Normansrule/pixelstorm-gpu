#!/usr/bin/env python3
"""Applies the course template (part label, goals, see-it-live links, check-yourself
questions, previous/next navigation) to every chapter in docs/. Idempotent.
Run: python3 tools/course.py   (make docs runs it)"""
import os, re
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE='https://normansrule.github.io/pixelstorm-gpu'
V=SITE+'/visualizer.html'; LAB=SITE+'/labs.html'
CH = [
 # num, file, title, part, minutes, learn[], see[], qa[]
 (1,'01-what-is-a-gpu.md','What a GPU is',1,10,
  ['why a GPU spends its transistors on arithmetic instead of caches and prediction','the three ideas that explain every GPU: many threads, shared instruction streams, latency hiding','how Pixelstorm compares with a real data-center GPU'],
  [('Home page animation', SITE+'/'),('Guided tour, stop 1', V+'?tour')],
  [('A CPU core and a GPU Streaming Multiprocessor (SM) both have to wait 400 cycles for DRAM. What does each typically do meanwhile?','The CPU tries not to wait at all: large caches, prefetching and out-of-order execution. The GPU accepts the wait and runs another warp that is ready, which is why it keeps dozens of warps resident per SM.'),
   ('Why fetch and decode an instruction once for 8 (or 32) threads?','Fetch and decode cost energy and area. Sharing them across a warp leaves more of the chip for arithmetic units. The price is that all lanes of a warp must follow the same instruction, which is where divergence comes from.')]),
 (2,'02-simt-warps-blocks.md','SIMT: threads, warps and blocks',1,15,
  ['how a CUDA launch (grid, blocks, threads) maps onto warps and lanes','which Pixelstorm instruction reads threadIdx.x, blockIdx.x and blockDim.x','why predication (guarded instructions) often beats branching'],
  [('Guided tour, stop 2 (one instruction, eight threads)', V+'?tour'),('Thread hierarchy figure', 'img/fig-thread-hierarchy.svg')],
  [('vector_add is launched as <<<4, 16>>> on Pixelstorm (8 lanes per warp). How many warps does each block have, and how many in total?','16 / 8 = 2 warps per block, 4 x 2 = 8 warps in total. Each SM holds one block at a time, so each SM runs 2 warps at once.'),
   ('Which instruction gives a thread its blockIdx.x?','S2R Rd, CTAID. (CTA = Cooperative Thread Array, NVIDIA\'s formal name for a block.)'),
   ('Why does "@P0 EXIT" not leave the warp stuck?','Lanes whose guard is true retire and are removed from the live set. The remaining lanes all sit at the next PC, so the warp keeps going with a smaller active mask.')]),
 (3,'03-isa.md','The Pixelstorm instruction set',1,20,
  ['the 32-bit instruction format, field by field','all 40 instructions and the CUDA, PTX or SASS operation each one imitates','the assembler syntax used by every kernel in kernels/'],
  [('Instruction set tab in the visualizer', V),('Command line: ./pixelstorm explain LDG', None)],
  [('Decode 0x04000000.','Bits 31 to 26 are 000001 = opcode 0x01 = EXIT. Every other field is zero, so there is no guard: EXIT.'),
   ('Why does STG put its data register in the Rd field?','A store writes no register, so Rd is free. Reusing it keeps one format with three register fields plus an immediate, and keeps the decoder small.')]),
 (4,'04-microarchitecture.md','Microarchitecture: the block diagram',2,20,
  ['what every Verilog module does and how they connect','the state machine that moves one instruction through an SM','the parameters you can change and re-test'],
  [('3D chip explorer', SITE+'/chip.html'),('Visualizer: the SM diagrams are this chapter, animated', V),('Figures: top level, SM internals, FSM', 'img/fig-sm-internals.svg')],
  [('How many cycles does an ADD take? A shared-memory load with a 2-way bank conflict?','ADD: 5 (SCHED, FETCH, DECODE, EXEC, WB). The shared load: 4 cycles to reach MEM, 2 bank passes plus 1 cycle to finish MEM, then WB = 8 cycles.'),
   ('What stops both SMs from loading global memory at the same time?','There is one memory arbiter with one outstanding request. The second SM waits until the first request returns. Real GPUs have many memory channels and many requests in flight.')]),
 (5,'05-instruction-lifecycle.md','Life of one instruction',2,15,
  ['one real LDG followed through every clock cycle of the RTL simulation','where its 40 cycles actually go','how to find the same moment in GTKWave'],
  [('Guided tour, stop 3 (coalescing and DRAM latency)', V+'?tour'),('Waveform: make wave', None)],
  [('DRAM latency is 8 cycles, yet the LDG spent 35 cycles in MEM. Where did the rest go?','Two transactions of roughly 10 to 11 cycles each (arbiter grant, 8 cycles of DRAM, response), plus waiting while the other SM\'s requests used the single memory port.'),
   ('Which signal in ps_sm.v tells you the MEM stage is finished?','lpend, the mask of lanes still waiting for memory. When it reaches 0 the FSM moves to WB.')]),
 (6,'06-reading-the-rtl.md','Reading the RTL',2,30,
  ['a recommended order for reading the 980 lines of Verilog','where the active mask, the barrier and the coalescer are computed, with line numbers','the coding conventions used throughout rtl/'],
  [('Waveform of any kernel: ./pixelstorm rtl <kernel> --vcd', None),('SM internals figure with signal names', 'img/fig-sm-internals.svg')],
  [('Where is the active mask computed, and from what?','pick_act, in the combinational scheduler block of ps_sm.v. A lane is active if it is live and its private PC equals w_minpc of the picked warp.'),
   ('Why are almost all blocks of ps_sm.v combinational (always @*) with a single clocked always block?','All state changes happen in one place, the FSM, so you can read what happens in each state top to bottom. The combinational blocks only compute what the FSM will latch next.')]),
 (7,'07-divergence.md','Divergence and reconvergence',3,20,
  ['what happens when the lanes of one warp take different branches','how min-PC scheduling reconverges them, and how NVIDIA hardware does it','how to measure the cost (SIMD efficiency) and when to use predication instead'],
  [('Guided tour, stops 4 and 5', V+'?tour'),('Divergence lab', LAB+'#diverge')],
  [('Lanes 0 to 3 branch to PC 20; lanes 4 to 7 fall through to PC 5. Which lanes run next?','Lanes 4 to 7, because PC 5 is the minimum PC. Lanes 0 to 3 wait until the others reach PC 20 or beyond.'),
   ('When is predication cheaper than a branch?','When both sides are short. Predication issues both sides for every lane but saves the branch instructions; a branch only wins when the lanes agree (a uniform branch) or the bodies are long.')]),
 (8,'08-memory.md','Memory: coalescing and banks',3,25,
  ['the memory hierarchy, from registers to DRAM','how the load/store unit coalesces lanes into line-sized transactions','why shared memory has banks and how padding removes conflicts'],
  [('Coalescing lab', LAB+'#coalesce'),('Bank conflict lab', LAB+'#banks'),('Guided tour, stop 6', V+'?tour')],
  [('8 lanes load in[2*i] with 4-word lines. How many transactions?','Addresses 0, 2, 4, ..., 14 touch lines 0, 4, 8 and 12: 4 transactions, and half of every fetched line is wasted.'),
   ('8 lanes access s[4*t] with 8 banks. How many passes?','Addresses 0, 4, 8, ..., 28 fall in banks 0, 4, 0, 4, ...: bank 0 gets 4 different words, so 4 passes (a 4-way conflict).')]),
 (9,'09-synchronization.md','Synchronization: barriers, shuffles, votes, atomics',3,20,
  ['how threads cooperate at warp, block and grid scope','how BAR is implemented in hardware and why misuse is dangerous','three ways to write a reduction, and when each wins'],
  [('Guided tour, stops 7 to 9', V+'?tour')],
  [('Why does reduction_shuffle need no BAR?','All communication stays inside one warp and goes through registers (SHFL). The lanes of a warp execute in lockstep, so each shuffle sees the previous step\'s results.'),
   ('What goes wrong if two lanes update the same histogram bin with LDG, ADD, STG instead of ATOM?','Both read the old count, both add one, both store: one increment is lost. ATOM does the read-modify-write as one indivisible step.')]),
 (10,'10-applications.md','Applications: the 15 kernels',4,20,
  ['what each example kernel does and which hardware feature it exposes','how each kernel looks on the hardware (timelines from the RTL)','how to write, test and visualize your own kernel'],
  [('Visualizer: pick any kernel', V),('Command line: ./pixelstorm list', None)],
  [('Why is divergence exactly as fast on 2 SMs as on 1?','It launches a single block, and a block runs on one SM. The second SM has nothing to do.'),
   ('What are the steps to add your own kernel?','./pixelstorm new <name>, edit it, ./pixelstorm sim <name>, ./pixelstorm rtl <name>, add an answer check to tests/expected.js, then make traces to see it in the visualizer.')]),
 (11,'11-graphics.md','Graphics: pixels, triangles and fractals',4,30,
  ['why "one thread per pixel" is the reason GPUs exist','how a triangle is rasterized with three edge functions and colored with barycentric weights','why fractals and other data-dependent shaders diverge, and how warp shape changes the cost'],
  [('Guided tour, stops 10 and 11', V+'?tour'),('Pixels and warps lab', LAB+'#pixels'),('Visualizer: 15 mandelbrot, framebuffer panel', V)],
  [('The triangle kernel decides inside or outside with @!P0 MOV instead of a branch. Why does that matter?','A branch on inside/outside would split every warp that straddles an edge. The predicated MOV keeps all lanes on the same instruction stream, so the kernel runs at 99% SIMD efficiency.'),
   ('A warp of 8 pixels in a row needs 3, 3, 4, 12, 12, 12, 5, 3 Mandelbrot iterations. How many iterations does the warp issue, and what is its efficiency?','It issues 12 (its slowest lane) for all 8 lanes = 96 lane-iterations; useful work is 54, so 56%.'),
   ('Why do real GPUs group pixels into 2 x 2 quads and square-ish tiles instead of long rows?','Nearby pixels in 2D usually take similar paths and touch nearby texture memory, so compact warps diverge less and coalesce better. The pixels lab shows the effect.')]),
 (12,'12-make-it-better.md','Make it better',5,30,
  ['nine concrete improvements, each one a real idea in commercial GPUs','how to measure whether your change helped','open research questions you can explore with this code'],
  [('Latency hiding lab', LAB+'#latency'),('Occupancy lab', LAB+'#occupancy')],
  [('Memory latency is 24 cycles and each load is followed by 4 arithmetic instructions. About how many warps hide the latency?','Roughly latency / (instructions per load) + 1 = 24 / 5 + 1, so about 6 warps. Check it in the latency hiding lab.'),
   ('Which single exercise raises IPC (Instructions Per Cycle) most for arithmetic-heavy kernels?','Pipelining the SM (exercise 1): it moves from one instruction every 5 cycles toward one per cycle.')]),
 (13,'13-real-world-gpus.md','From Pixelstorm to a real GPU',5,15,
  ['how to recognize the parts on a real graphics card and in a die photo','how Pixelstorm\'s numbers compare with an NVIDIA H100','which profiler metrics match what you have seen here, and how to read real SASS'],
  [('Occupancy lab with real GPU limits', LAB+'#occupancy')],
  [('Which Nsight Compute metric corresponds to Pixelstorm\'s bank passes?','"Shared memory bank conflicts" (per instruction or per request).'),
   ('How many SMs does an H100 SXM5 have enabled, and how many lanes per warp?','132 SMs, 32 lanes per warp.')]),
 (14,'14-silicon.md','From Verilog to silicon',5,35,
  ['how the same Verilog becomes 145,800 real SkyWater 130 nm standard cells and 1.38 million transistors','what a standard cell, a placement row and a GDS layout are, and how to read one in KLayout','which steps of a real tapeout Pixelstorm runs, and how to finish the rest with OpenROAD'],
  [('Silicon page: die, zoom from die to transistor, 3D standard cells', SITE+'/silicon.html'),('Command line: make silicon && make gds', None)],
  [('Why does the tapeout configuration use 2 warps of 4 lanes and 8 registers instead of the simulated 4 x 8 x 16?','Every storage bit becomes a flip-flop (about 24 transistors) plus multiplexers to read it. A full-size register file with 24 read ports would be hundreds of thousands of cells. Real chips use dense SRAM macros for that; without them, the design has to shrink.'),
   ('In a standard cell, where exactly is a transistor?','Wherever a polysilicon line (red) crosses a diffusion region (green). The poly is the gate; the diffusion on either side is source and drain. Counting those crossings gives 4 for a NAND2 and 28 for a full adder.'),
   ('The layout has 145,607 extra tap, decap and filler cells. What are they for?','Taps tie the wells to power so the chip does not latch up; decaps are capacitors that steady the supply when many gates switch at once; fillers keep the rows continuous for manufacturing. A real flow inserts all three.')]),
 (15,'15-references.md','References',6,5,[],[],[]),
 (16,'16-glossary.md','Glossary',6,5,[],[],[]),
 (17,'17-troubleshooting.md','Troubleshooting',6,5,[],[],[]),
]
PART = {1:'Part 1: Concepts',2:'Part 2: The hardware',3:'Part 3: Performance',4:'Part 4: Applications and graphics',5:'Part 5: Build on it',6:'Appendix'}

def header(c):
    n,f,t,p,m,learn,see,qa=c
    h=f'# {n}. {t}\n\n> **{PART[p]}**, chapter {n} of {len(CH)}. About {m} minutes.\n'
    if learn:
        h+='\n**In this chapter you will learn**\n\n'+''.join(f'- {x}\n' for x in learn)
    if see:
        h+='\n**See it live:** '+'; '.join((f'[{a}]({b})' if b else a) for a,b in see)+'\n'
    return h+'\n---\n'
def footer(i):
    n,f,t,p,m,learn,see,qa=CH[i]
    s=''
    if qa:
        s+='\n## Check yourself\n\n'
        for q,a in qa: s+=f'<details>\n<summary>{q}</summary>\n\n{a}\n\n</details>\n\n'
    prev = CH[i-1] if i>0 else None; nxt = CH[i+1] if i<len(CH)-1 else None
    s+='\n---\n\n'
    s+= (f'[Previous: {prev[0]}. {prev[2]}]({prev[1]})' if prev else '[Previous: Course map](00-start-here.md)')
    s+=' | [Course map](00-start-here.md) | '
    s+= (f'[Next: {nxt[0]}. {nxt[2]}]({nxt[1]})' if nxt else '[Back to the start](00-start-here.md)')
    return s+'\n'
TEMPLATE_MARK='<!-- chapter-footer -->'
def apply(i, body):
    # strip existing H1 and any previous template
    # remove any previously generated header blocks, then the old footer
    while True:
        new = re.sub(r'^# .*\n', '', body, count=1).lstrip('\n')
        if new.startswith('> **') and '\n---\n' in new:
            new = new[new.index('\n---\n') + 5:].lstrip('\n')
        if new == body: break
        body = new
    if TEMPLATE_MARK in body: body=body[:body.index(TEMPLATE_MARK)]
    return header(CH[i])+'\n'+body.rstrip()+'\n\n'+TEMPLATE_MARK+'\n'+footer(i)



def write_map():
    rows = ''; cur = None
    for n, f, t, p, m, learn, see, qa in CH:
        if p != cur:
            cur = p
            rows += f'\n### {PART[p]}\n\n| Chapter | Time | You will learn |\n|---|---|---|\n'
        first = (learn[0][0].upper() + learn[0][1:]) if learn else ''
        rows += f'| [{n}. {t}]({f}) | {m} min | {first} |\n'
    total = sum(c[4] for c in CH)
    out = f"""# Pixelstorm: a GPU you can watch paint

> **Course map.** Start here. The whole course takes about {round(total / 60)} hours; after Part 1, each chapter stands on its own.

![Three images rendered by the Pixelstorm Verilog](img/fig-gallery.svg)

Pixelstorm is a small but complete GPU (Graphics Processing Unit) written in Verilog, and the three images above were computed by it, pixel by pixel, in a hardware simulation. The name is the job: a GPU runs the same little program on a storm of pixels at once, one thread per pixel, with the threads of each warp marching in lockstep. Almost every hard topic in GPU design is about what happens when that lockstep breaks (divergence) or stalls (memory), and Pixelstorm lets you watch both, one clock cycle at a time.

## Four ways to learn

| | Best for | Open |
|---|---|---|
| **3D chip explorer** | flying around the die while it runs a real simulation; click any block to learn what it does | [chip explorer]({SITE}/chip.html) |
| **Guided tour** | a 15-minute first look: twelve moments in real simulations, from one instruction to a rendered fractal | [visualizer, then press Guided tour]({V}?tour) |
| **Labs** | building intuition with sliders: coalescing, banks, divergence, latency hiding, occupancy, pixels and warps | [labs]({LAB}) |
| **This course** | understanding it properly, down to the Verilog | the chapters below |

![The 3D chip explorer replaying the Mandelbrot kernel](img/chip.gif)

## The chapters
{rows}
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
"""
    open('docs/00-start-here.md', 'w').write(out)

if __name__=='__main__':
    write_map()
    for i,c in enumerate(CH):
        p='docs/'+c[1]
        if not os.path.exists(p): continue
        text = open(p).read()          # read first: open(p,'w') would truncate
        open(p, 'w').write(apply(i, text))
    print('templated')
