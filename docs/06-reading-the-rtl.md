# 6. Reading the RTL

> **Part 2: The hardware**, chapter 6 of 18. About 30 minutes.

**In this chapter you will learn**

- a recommended order for reading the 980 lines of Verilog
- where the active mask, the barrier and the coalescer are computed, with line numbers
- the coding conventions used throughout rtl/

**See it live:** Waveform of any kernel: ./pixelstorm rtl <kernel> --vcd; [SM internals figure with signal names](img/fig-sm-internals.svg)

---

The Verilog is about 980 lines in seven files. This chapter is a guided reading: which file to open first, which lines matter, and what each block is doing in hardware terms. Line numbers are generated from the current source by `tools/rtl_chapter.py`, so they stay correct when the code changes.

Keep the [SM internals figure](img/fig-sm-internals.svg) open beside the code; every arrow in it is a signal named below.

## Reading order

| Step | File | Lines | Read it for |
|---|---|---|---|
| 1 | `rtl/ps_defines.vh` | 106 | opcode numbers and field constants; the vocabulary for everything else |
| 2 | `rtl/ps_decoder.v` | 81 | how a 32-bit word becomes control signals (pure wiring plus one case statement) |
| 3 | `rtl/ps_alu.v` | 81 | one lane's arithmetic; the SM instantiates it 8 times |
| 4 | `rtl/ps_sm.v` | 590 | the Streaming Multiprocessor: the heart of the design, read in the order below |
| 5 | `rtl/ps_mem_arbiter.v` | 96 | how two SMs share one DRAM port |
| 6 | `rtl/ps_dispatcher.v` | 60 | how thread blocks are handed to idle SMs |
| 7 | `rtl/ps_gpu_top.v` | 167 | wiring, instruction memory and the constant bank |
| 8 | `sim/tb_gpu.v` | 174 | the testbench: host driver, DRAM model, trace and waveform switches |

## Conventions used in every file

- **One clocked block per module.** All registers change in a single `always @(posedge clk)`. Everything else is `always @*` (combinational logic) that computes what that block will latch. To find out what happens in a state, read one place.
- **Flattened arrays.** Verilog-2001 ports cannot be 2D, so per-lane values are packed into wide vectors: lane `j`'s 32-bit value is `x[j*32 +: 32]`, warp `i`'s PC is `w_minpc[i*IMEM_AW +: IMEM_AW]`.
- **Names describe hardware.** `w_` = per warp, `l` prefix (`lpc`, `ldone`, `lpend`) = per lane, `d_` = decoded field, `r_` = result registered after EXEC, `c` prefix (`cw`, `cpc`, `cact`, `cexe`) = the instruction currently in flight.
- **Simulation-only code is fenced** with `` `ifndef SYNTHESIS `` so Yosys and FPGA tools never see the `$display` trace printer.

## ps_sm.v, block by block

### 1. Architectural state ([`rtl/ps_sm.v` line 79](../rtl/ps_sm.v#L79))

Registers that survive between instructions: the register file `rf`, predicates `preds`, the private PC of every thread `lpc`, exit flags `ldone`, warp flags `w_valid` and `w_wait`, shared memory `smem`, and the round-robin pointer `rr_ptr`. Everything else in the SM is recomputed every cycle from these.

### 2. Decode ([`rtl/ps_sm.v` line 123](../rtl/ps_sm.v#L123))

An instance of `ps_decoder` turns the instruction register `ir` into `d_` signals: opcode, register numbers, immediates, and flags such as `d_load`, `d_store`, `d_shared`, `d_atom`.

### 3. Warp status and the scheduler ([`rtl/ps_sm.v` line 144](../rtl/ps_sm.v#L144))

This is where SIMT scheduling and divergence handling live. First, for every warp, the minimum PC over its live lanes:

```verilog
// rtl/ps_sm.v, lines 149-161
    always @* begin
        for (i = 0; i < NUM_WARPS; i = i + 1) begin
            w_done[i] = 1'b1;
            w_minpc[i*IMEM_AW +: IMEM_AW] = {IMEM_AW{1'b1}};
            for (j = 0; j < WARP_SIZE; j = j + 1) begin
                if (!ldone[i*WARP_SIZE+j]) begin
                    w_done[i] = 1'b0;
                    if (lpc[(i*WARP_SIZE+j)*IMEM_AW +: IMEM_AW] < w_minpc[i*IMEM_AW +: IMEM_AW])
                        w_minpc[i*IMEM_AW +: IMEM_AW] = lpc[(i*WARP_SIZE+j)*IMEM_AW +: IMEM_AW];
                end
            end
        end
    end
```

Then the barrier condition: some live warp is waiting, and no live warp is still running.

```verilog
// rtl/ps_sm.v, lines 165-165
    wire                 bar_release = (|(live & w_wait)) && ((live & ~w_wait) == {NUM_WARPS{1'b0}});
```

Finally the pick: the first eligible warp at or after `rr_ptr`, and its **active mask**, the lanes whose PC equals the warp's minimum PC. This one comparison is the whole min-PC reconvergence scheme ([chapter 7](07-divergence.md)).

```verilog
// rtl/ps_sm.v, lines 167-183
    reg            found;
    reg [WW-1:0]   pick;
    reg [WARP_SIZE-1:0] pick_act;
    always @* begin
        found = 1'b0;
        pick  = {WW{1'b0}};
        for (i = 0; i < NUM_WARPS; i = i + 1) begin
            k = (rr_ptr + i) % NUM_WARPS;
            if (!found && eligible[k]) begin
                found = 1'b1;
                pick  = k[WW-1:0];
            end
        end
        for (j = 0; j < WARP_SIZE; j = j + 1)
            pick_act[j] = !ldone[pick*WARP_SIZE+j] &&
                          (lpc[(pick*WARP_SIZE+j)*IMEM_AW +: IMEM_AW] == w_minpc[pick*IMEM_AW +: IMEM_AW]);
    end
```

### 4. The lanes ([`rtl/ps_sm.v` line 186](../rtl/ps_sm.v#L186))

A `generate` loop creates `WARP_SIZE` copies of the register read, guard evaluation, `ps_alu`, next-PC and address logic. Each lane sees the same decoded instruction and its own registers. The guard (`@P0`) turns the active mask into the **execution mask** `cexe`.

### 5. Cross-lane units ([`rtl/ps_sm.v` line 252](../rtl/ps_sm.v#L252) and [`rtl/ps_sm.v` line 271](../rtl/ps_sm.v#L271))

The only places where one lane reads another lane's data. `SHFL` is a multiplexer per lane choosing a source lane (`shfl_y`); `VOTE` reduces one predicate bit per lane into ANY, ALL or a BALLOT mask.

### 6. Load/store unit ([`rtl/ps_sm.v` line 289](../rtl/ps_sm.v#L289))

Coalescing in a few lines: take the lowest pending lane as the leader, compute its line, and serve every pending lane in the same line.

```verilog
// rtl/ps_sm.v, lines 314-321
        line_base = r_addr[leader*32 +: 32] & ~(LINE_WORDS - 1);
        g_wmask   = {LINE_WORDS{1'b0}};
        g_wdata   = {LINE_WORDS*32{1'b0}};
        for (j = 0; j < WARP_SIZE; j = j + 1) begin
            la = r_addr[j*32 +: 32];
            if (d_atom) g_serve[j] = lpend[j] && (j == leader);
            else        g_serve[j] = lpend[j] && ((la & ~(LINE_WORDS - 1)) == line_base);
            if (g_serve[j] && d_store) begin
```

Shared-memory bank resolution: at most one address per bank per cycle, except that lanes asking for the *same* word share it.

```verilog
// rtl/ps_sm.v, lines 327-342
        bank_used = {SMEM_BANKS{1'b0}};
        bank_addr = {SMEM_BANKS*SMEM_AW{1'b0}};
        for (j = 0; j < WARP_SIZE; j = j + 1) begin
            la = r_addr[j*32 +: 32];
            bk = la[BANK_LOG-1:0];
            s_sel[j] = 1'b0;
            if (lpend[j]) begin
                if (d_atom) begin
                    s_sel[j] = (j == leader);
                end else if (!bank_used[bk]) begin
                    s_sel[j]  = 1'b1;
                    bank_used[bk] = 1'b1;
                    bank_addr[bk*SMEM_AW +: SMEM_AW] = la[SMEM_AW-1:0];
                end else if (bank_addr[bk*SMEM_AW +: SMEM_AW] == la[SMEM_AW-1:0]) begin
                    s_sel[j] = 1'b1;                        // broadcast
                end
```

### 7. The control FSM ([`rtl/ps_sm.v` line 403](../rtl/ps_sm.v#L403))

One `case (state)`. Read the states in order; each is short:

| State | Line | What it latches |
|---|---|---|
| IDLE | 425 | on `blk_start`: block id, all lane PCs to 0, lanes beyond the block size marked done |
| SCHED | 444 | barrier release, block completion, or the picked warp: `cw`, `cpc`, `cact` |
| FETCH | 466 | `ir <= imem[cpc]` |
| DECODE | 472 | execution mask `cexe` from the guard |
| EXEC | 478 | every lane's result, address, store data and next PC into `r_` registers |
| MEM | 494 | one bank pass or one global transaction per visit, clearing bits of `lpend` |
| WB | 550 | registers, predicates, `lpc`, `ldone`, `w_wait` on `BAR`, advance `rr_ptr` |

## Exercises while reading

1. Find the line that would change if the scheduler picked the *oldest* warp instead of round robin.
2. In the MEM state, how many cycles does a global store with 2 lines take, and which signals prove it in GTKWave?
3. The coalescer compares `la & ~(LINE_WORDS - 1)`. What must be true of `LINE_WORDS` for this to work?
4. Add a counter of bank-conflict cycles as a new register, print it at the end of the trace, and check it against the bank lab.

<!-- chapter-footer -->

## Check yourself

<details>
<summary>Where is the active mask computed, and from what?</summary>

pick_act, in the combinational scheduler block of ps_sm.v. A lane is active if it is live and its private PC equals w_minpc of the picked warp.

</details>

<details>
<summary>Why are almost all blocks of ps_sm.v combinational (always @*) with a single clocked always block?</summary>

All state changes happen in one place, the FSM, so you can read what happens in each state top to bottom. The combinational blocks only compute what the FSM will latch next.

</details>


---

[Previous: 5. Life of one instruction](05-instruction-lifecycle.md) | [Course map](00-start-here.md) | [Next: 7. Divergence and reconvergence](07-divergence.md)
