#!/usr/bin/env python3
"""Generates docs/06-reading-the-rtl.md with code excerpts and line numbers
taken from the current Verilog, so the chapter never drifts from the source.
Run: python3 tools/rtl_chapter.py   (make docs runs it for you)"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def lines(f): return open(os.path.join(ROOT, f)).read().split('\n')
def find(f, pat, start=0):
    L = lines(f)
    for i in range(start, len(L)):
        if re.search(pat, L[i]): return i + 1
    raise SystemExit(f'pattern not found in {f}: {pat}')
def excerpt(f, a, b):
    L = lines(f)
    body = '\n'.join(L[a-1:b])
    return f'```verilog\n// {f}, lines {a}-{b}\n{body}\n```\n'
def link(f, a, b=None): return f'[`{f}` line {a}{"-"+str(b) if b else ""}](../{f}#L{a}{"-L"+str(b) if b else ""})'

SM = 'rtl/ps_sm.v'
n_state = find(SM, r'// Architectural state')
n_dec = find(SM, r'// Decode \(combinational')
n_sched = find(SM, r'// Warp status \+ scheduler')
n_minpc_a = find(SM, r'always @\* begin', n_sched)
n_minpc_b = find(SM, r'^    end$', n_minpc_a)
n_bar = find(SM, r'wire\s+bar_release')
n_pick_a = find(SM, r'reg\s+found;')
n_pick_b = find(SM, r'^    end$', n_pick_a + 3)
n_lanes = find(SM, r'// The lanes:')
n_shfl = find(SM, r'// ---- cross-lane unit: SHFL')
n_vote = find(SM, r'// ---- cross-lane unit: VOTE')
n_lsu = find(SM, r'// Load/Store Unit \(LSU\)')
n_serve_a = find(SM, r'line_base = r_addr')
n_serve_b = find(SM, r'g_wdata\[la', n_serve_a) - 2
n_bank_a = find(SM, r'bank_used = \{SMEM_BANKS')
n_bank_b = find(SM, r'// broadcast', n_bank_a) + 1
n_fsm = find(SM, r'// Main control Finite State Machine')
st = {s: find(SM, rf'^\s+S_{s}(: begin|: if)') for s in ['IDLE', 'SCHED', 'FETCH', 'DECODE', 'EXEC', 'MEM', 'WB']}
n_end = len(lines(SM))

out = f'''# 6. Reading the RTL

The Verilog is about 980 lines in seven files. This chapter is a guided reading: which file to open first, which lines matter, and what each block is doing in hardware terms. Line numbers are generated from the current source by `tools/rtl_chapter.py`, so they stay correct when the code changes.

Keep the [SM internals figure](img/fig-sm-internals.svg) open beside the code; every arrow in it is a signal named below.

## Reading order

| Step | File | Lines | Read it for |
|---|---|---|---|
| 1 | `rtl/ps_defines.vh` | {len(lines('rtl/ps_defines.vh'))} | opcode numbers and field constants; the vocabulary for everything else |
| 2 | `rtl/ps_decoder.v` | {len(lines('rtl/ps_decoder.v'))} | how a 32-bit word becomes control signals (pure wiring plus one case statement) |
| 3 | `rtl/ps_alu.v` | {len(lines('rtl/ps_alu.v'))} | one lane's arithmetic; the SM instantiates it 8 times |
| 4 | `rtl/ps_sm.v` | {n_end} | the Streaming Multiprocessor: the heart of the design, read in the order below |
| 5 | `rtl/ps_mem_arbiter.v` | {len(lines('rtl/ps_mem_arbiter.v'))} | how two SMs share one DRAM port |
| 6 | `rtl/ps_dispatcher.v` | {len(lines('rtl/ps_dispatcher.v'))} | how thread blocks are handed to idle SMs |
| 7 | `rtl/ps_gpu_top.v` | {len(lines('rtl/ps_gpu_top.v'))} | wiring, instruction memory and the constant bank |
| 8 | `sim/tb_gpu.v` | {len(lines('sim/tb_gpu.v'))} | the testbench: host driver, DRAM model, trace and waveform switches |

## Conventions used in every file

- **One clocked block per module.** All registers change in a single `always @(posedge clk)`. Everything else is `always @*` (combinational logic) that computes what that block will latch. To find out what happens in a state, read one place.
- **Flattened arrays.** Verilog-2001 ports cannot be 2D, so per-lane values are packed into wide vectors: lane `j`'s 32-bit value is `x[j*32 +: 32]`, warp `i`'s PC is `w_minpc[i*IMEM_AW +: IMEM_AW]`.
- **Names describe hardware.** `w_` = per warp, `l` prefix (`lpc`, `ldone`, `lpend`) = per lane, `d_` = decoded field, `r_` = result registered after EXEC, `c` prefix (`cw`, `cpc`, `cact`, `cexe`) = the instruction currently in flight.
- **Simulation-only code is fenced** with `` `ifndef SYNTHESIS `` so Yosys and FPGA tools never see the `$display` trace printer.

## ps_sm.v, block by block

### 1. Architectural state ({link(SM, n_state)})

Registers that survive between instructions: the register file `rf`, predicates `preds`, the private PC of every thread `lpc`, exit flags `ldone`, warp flags `w_valid` and `w_wait`, shared memory `smem`, and the round-robin pointer `rr_ptr`. Everything else in the SM is recomputed every cycle from these.

### 2. Decode ({link(SM, n_dec)})

An instance of `ps_decoder` turns the instruction register `ir` into `d_` signals: opcode, register numbers, immediates, and flags such as `d_load`, `d_store`, `d_shared`, `d_atom`.

### 3. Warp status and the scheduler ({link(SM, n_sched)})

This is where SIMT scheduling and divergence handling live. First, for every warp, the minimum PC over its live lanes:

{excerpt(SM, n_minpc_a, n_minpc_b)}
Then the barrier condition: some live warp is waiting, and no live warp is still running.

{excerpt(SM, n_bar, n_bar)}
Finally the pick: the first eligible warp at or after `rr_ptr`, and its **active mask**, the lanes whose PC equals the warp's minimum PC. This one comparison is the whole min-PC reconvergence scheme ([chapter 7](07-divergence.md)).

{excerpt(SM, n_pick_a, n_pick_b)}
### 4. The lanes ({link(SM, n_lanes)})

A `generate` loop creates `WARP_SIZE` copies of the register read, guard evaluation, `ps_alu`, next-PC and address logic. Each lane sees the same decoded instruction and its own registers. The guard (`@P0`) turns the active mask into the **execution mask** `cexe`.

### 5. Cross-lane units ({link(SM, n_shfl)} and {link(SM, n_vote)})

The only places where one lane reads another lane's data. `SHFL` is a multiplexer per lane choosing a source lane (`shfl_y`); `VOTE` reduces one predicate bit per lane into ANY, ALL or a BALLOT mask.

### 6. Load/store unit ({link(SM, n_lsu)})

Coalescing in a few lines: take the lowest pending lane as the leader, compute its line, and serve every pending lane in the same line.

{excerpt(SM, n_serve_a, n_serve_b)}
Shared-memory bank resolution: at most one address per bank per cycle, except that lanes asking for the *same* word share it.

{excerpt(SM, n_bank_a, n_bank_b)}
### 7. The control FSM ({link(SM, n_fsm)})

One `case (state)`. Read the states in order; each is short:

| State | Line | What it latches |
|---|---|---|
| IDLE | {st['IDLE']} | on `blk_start`: block id, all lane PCs to 0, lanes beyond the block size marked done |
| SCHED | {st['SCHED']} | barrier release, block completion, or the picked warp: `cw`, `cpc`, `cact` |
| FETCH | {st['FETCH']} | `ir <= imem[cpc]` |
| DECODE | {st['DECODE']} | execution mask `cexe` from the guard |
| EXEC | {st['EXEC']} | every lane's result, address, store data and next PC into `r_` registers |
| MEM | {st['MEM']} | one bank pass or one global transaction per visit, clearing bits of `lpend` |
| WB | {st['WB']} | registers, predicates, `lpc`, `ldone`, `w_wait` on `BAR`, advance `rr_ptr` |

## Exercises while reading

1. Find the line that would change if the scheduler picked the *oldest* warp instead of round robin.
2. In the MEM state, how many cycles does a global store with 2 lines take, and which signals prove it in GTKWave?
3. The coalescer compares `la & ~(LINE_WORDS - 1)`. What must be true of `LINE_WORDS` for this to work?
4. Add a counter of bank-conflict cycles as a new register, print it at the end of the trace, and check it against the bank lab.
'''
open(os.path.join(ROOT, 'docs', '06-reading-the-rtl.md'), 'w').write(out)
print('docs/06-reading-the-rtl.md')
