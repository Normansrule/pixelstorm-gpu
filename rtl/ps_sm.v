// =============================================================================
// ps_sm.v — one Streaming Multiprocessor (SM)
// -----------------------------------------------------------------------------
// The SM is the "core" of a GPU. It holds a thread block (CTA, Cooperative
// Thread Array) that has been split into warps of WARP_SIZE threads. Every
// instruction walks through the same stages:
//
//   SCHED  -> the warp scheduler picks a ready warp (round robin) and computes
//             its active mask (lanes whose private PC equals the warp's min PC)
//   FETCH  -> read the 32-bit instruction at that PC from instruction memory
//   DECODE -> ps_decoder splits the word into fields; guard predicate is
//             evaluated per lane to form the execution mask
//   EXEC   -> every lane reads its registers and its own ps_alu computes;
//             cross-lane units (SHFL, VOTE) look at all lanes at once
//   MEM    -> the Load/Store Unit (LSU) coalesces global accesses into
//             cache-line-sized transactions, or resolves shared-memory banks
//   WB     -> write back registers / predicates, advance per-lane PCs
//
// This is deliberately NOT pipelined so every stage is visible one cycle at a
// time in the waveform and in the web visualizer. docs/12-make-it-better.md
// explains how to pipeline it and hide memory latency.
//
// Divergence: every lane owns a PC. The warp always issues the MINIMUM PC of
// its live lanes ("min-PC" reconvergence, see Collange 2011 and the thread
// frontier papers). Lanes that branched ahead wait; lanes that are behind
// catch up; they naturally reconverge at the join point. NVIDIA Volta and
// later also track a PC per thread ("Independent Thread Scheduling").
// =============================================================================
`include "ps_defines.vh"

module ps_sm #(
    parameter SM_ID      = 0,
    parameter NUM_WARPS  = 4,
    parameter WARP_SIZE  = 8,
    parameter NUM_REGS   = 16,
    parameter LINE_WORDS = 4,
    parameter SMEM_WORDS = 256,
    parameter SMEM_BANKS = 8,
    parameter IMEM_AW    = 10,
    parameter CONST_AW   = 4
)(
    input  wire                     clk,
    input  wire                     rst,
    input  wire [31:0]              cycle,
    // ---- from the block dispatcher ----
    input  wire                     blk_start,
    input  wire [15:0]              blk_id,
    input  wire [15:0]              blk_dim,
    input  wire [15:0]              grid_dim,
    output reg                      busy,
    output wire                     perf_commit,     // one warp instruction retires this cycle
    output wire [7:0]               perf_lanes,      // ...with this many lanes executing it
    output reg                      blk_done,
    // ---- instruction + constant memory (shared by all SMs) ----
    output wire [IMEM_AW-1:0]       imem_addr,
    input  wire [31:0]              imem_data,
    output wire [CONST_AW-1:0]      cmem_addr,
    input  wire [31:0]              cmem_data,
    // ---- global memory port (goes through ps_mem_arbiter) ----
    output reg                      mreq_valid,
    output reg  [1:0]               mreq_op,
    output reg  [31:0]              mreq_addr,
    output reg  [LINE_WORDS-1:0]    mreq_wmask,
    output reg  [LINE_WORDS*32-1:0] mreq_wdata,
    input  wire                     mresp_valid,
    input  wire [LINE_WORDS*32-1:0] mresp_rdata
);
    localparam NT       = NUM_WARPS * WARP_SIZE;
    localparam WW       = (NUM_WARPS  > 1) ? $clog2(NUM_WARPS)  : 1;
    localparam LW       = (WARP_SIZE  > 1) ? $clog2(WARP_SIZE)  : 1;
    localparam LINE_LOG = (LINE_WORDS > 1) ? $clog2(LINE_WORDS) : 1;
    localparam SMEM_AW  = $clog2(SMEM_WORDS);
    localparam BANK_LOG = (SMEM_BANKS > 1) ? $clog2(SMEM_BANKS) : 1;

    localparam [2:0] S_IDLE = 3'd0, S_SCHED = 3'd1, S_FETCH = 3'd2, S_DECODE = 3'd3,
                     S_EXEC = 3'd4, S_MEM   = 3'd5, S_WB    = 3'd6;

    // -------------------------------------------------------------------------
    // Architectural state
    // -------------------------------------------------------------------------
    reg  [2:0]              state;
    reg  [15:0]             cur_blk, cur_bdim, cur_gdim;
    reg  [NUM_WARPS-1:0]    w_valid;            // warp holds threads of this block
    reg  [NUM_WARPS-1:0]    w_wait;             // warp is parked at a BAR
    reg  [NT*IMEM_AW-1:0]   lpc;                // one PC per thread (lane)
    reg  [NT-1:0]           ldone;              // thread has executed EXIT
    reg  [NT*4-1:0]         preds;              // P0..P3 per thread
    // register file: one bank per lane (lane g holds registers of threads w*WARP_SIZE+g),
    // declared inside the lane generate block below. Each bank is a small multi-read
    // RAM, which FPGAs build from distributed RAM and ASICs from register-file macros.
    // shared memory: SMEM_BANKS small RAMs (bank = address mod SMEM_BANKS), declared
    // after the bank resolver; a pass touches at most one word per bank.
    reg  [WW-1:0]           rr_ptr;             // round-robin pointer

    // current instruction bookkeeping
    reg  [WW-1:0]           cw;                 // current warp
    reg  [IMEM_AW-1:0]      cpc;                // current PC
    reg  [WARP_SIZE-1:0]    cact;               // active mask (lanes at cpc)
    reg  [WARP_SIZE-1:0]    cexe;               // execution mask (active & guard)
    reg  [31:0]             ir;                 // instruction register

    // results latched at the end of EXEC
    reg  [WARP_SIZE*32-1:0]      r_res;
    reg  [WARP_SIZE-1:0]         r_pres;
    reg  [WARP_SIZE*IMEM_AW-1:0] r_npc;
    reg  [WARP_SIZE-1:0]         r_ndone;
    reg  [WARP_SIZE*32-1:0]      r_addr;
    reg  [WARP_SIZE*32-1:0]      r_data;

    // load/store unit
    reg  [WARP_SIZE-1:0]    lpend;              // lanes still waiting for memory
    reg  [WARP_SIZE-1:0]    lserve;             // lanes served by in-flight request
    reg                     lwait;
    reg  [15:0]             txn_cnt;            // memory transactions (or smem cycles)
    reg  [15:0]             mem_cyc;

    // stage timestamps for the trace
    reg  [31:0]             t_s, t_f, t_d, t_e, t_m;

    assign imem_addr = cpc;

    // -------------------------------------------------------------------------
    // Decode (combinational, from the instruction register)
    // -------------------------------------------------------------------------
    wire [5:0]  d_op;   wire d_gen, d_gneg;  wire [1:0] d_gp;
    wire [3:0]  d_rd, d_rs1, d_rs2, d_rs3;
    wire [31:0] d_imm14, d_imm18;
    wire [2:0]  d_cmp;  wire [1:0] d_selp, d_smode, d_vmode; wire [4:0] d_sval;
    wire d_wrd, d_wpred, d_mem, d_shared, d_load, d_store, d_atom, d_br, d_exit, d_bar;

    ps_decoder u_dec (
        .ir(ir), .op(d_op), .g_en(d_gen), .g_neg(d_gneg), .g_p(d_gp),
        .rd(d_rd), .rs1(d_rs1), .rs2(d_rs2), .rs3(d_rs3),
        .imm14(d_imm14), .imm18(d_imm18), .cmp(d_cmp), .selp(d_selp),
        .shfl_mode(d_smode), .shfl_val(d_sval), .vote_mode(d_vmode),
        .writes_rd(d_wrd), .writes_pred(d_wpred), .is_mem(d_mem), .is_shared(d_shared),
        .is_load(d_load), .is_store(d_store), .is_atom(d_atom),
        .is_branch(d_br), .is_exit(d_exit), .is_bar(d_bar)
    );

    assign cmem_addr = d_imm14[CONST_AW-1:0];

    // -------------------------------------------------------------------------
    // Warp status + scheduler (combinational)
    // -------------------------------------------------------------------------
    reg  [NUM_WARPS-1:0]         w_done;
    reg  [NUM_WARPS*IMEM_AW-1:0] w_minpc;
    integer i, j, k;
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

    wire [NUM_WARPS-1:0] live     = w_valid & ~w_done;
    wire [NUM_WARPS-1:0] eligible = live & ~w_wait;
    wire                 bar_release = (|(live & w_wait)) && ((live & ~w_wait) == {NUM_WARPS{1'b0}});

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

    // -------------------------------------------------------------------------
    // The lanes: register read, guard, ALU, next-PC, address generation
    // -------------------------------------------------------------------------
    wire [WARP_SIZE*32-1:0]      a_flat;       // Rs1 values of all lanes (for SHFL)
    wire [WARP_SIZE-1:0]         guard_ok;
    wire [WARP_SIZE-1:0]         vote_bit;
    wire [WARP_SIZE*32-1:0]      alu_y;
    wire [WARP_SIZE-1:0]         alu_p;
    wire [WARP_SIZE*32-1:0]      lane_addr, lane_data;
    wire [WARP_SIZE*IMEM_AW-1:0] lane_npc;
    wire [WARP_SIZE-1:0]         lane_ndone;

    genvar g;
    generate
        for (g = 0; g < WARP_SIZE; g = g + 1) begin : lane
            wire [31:0] tidx  = cw * WARP_SIZE + g;           // thread index in block
            wire [31:0] rbase = tidx * NUM_REGS;
            reg  [31:0] rfl [0:NUM_WARPS*NUM_REGS-1];          // this lane's register bank
            wire [31:0] a     = rfl[cw * NUM_REGS + d_rs1];
            wire [31:0] b     = rfl[cw * NUM_REGS + d_rs2];
            wire [31:0] c     = rfl[cw * NUM_REGS + d_rs3];
            wire [31:0] dval  = rfl[cw * NUM_REGS + d_rd];      // store data lives in Rd
            always @(posedge clk)                               // writeback, one port per bank
                if (!rst && state == S_WB && cexe[g] && d_wrd) rfl[cw * NUM_REGS + d_rd] <= r_res[g*32 +: 32];
`ifndef SYNTHESIS
            integer zz;
            initial for (zz = 0; zz < NUM_WARPS*NUM_REGS; zz = zz + 1) rfl[zz] = 32'd0;
`endif
            wire [3:0]  pr    = preds[tidx*4 +: 4];
            reg  [31:0] srv;
            always @* begin
                case (d_imm14[2:0])
                    `SR_TID    : srv = tidx;
                    `SR_CTAID  : srv = {16'd0, cur_blk};
                    `SR_NTID   : srv = {16'd0, cur_bdim};
                    `SR_NCTAID : srv = {16'd0, cur_gdim};
                    `SR_LANEID : srv = g;
                    `SR_WARPID : srv = cw;
                    `SR_SMID   : srv = SM_ID;
                    default    : srv = cycle;
                endcase
            end
            assign a_flat[g*32 +: 32] = a;
            assign guard_ok[g] = !d_gen || (pr[d_gp] ^ d_gneg);
            assign vote_bit[g] = pr[d_rs1[1:0]];

            ps_alu u_alu (
                .op(d_op), .a(a), .b(b), .c(c), .imm14(d_imm14), .imm18(d_imm18),
                .cmp(d_cmp), .psel(pr[d_selp]), .srv(srv), .cval(cmem_data),
                .y(alu_y[g*32 +: 32]), .p(alu_p[g])
            );

            // next PC for this lane (only matters if it is active)
            wire [IMEM_AW-1:0] cur_lpc = lpc[tidx*IMEM_AW +: IMEM_AW];
            assign lane_npc[g*IMEM_AW +: IMEM_AW] =
                  !cact[g]                ? cur_lpc :
                  (cexe[g] && d_br)       ? d_imm18[IMEM_AW-1:0] :
                  (cexe[g] && d_exit)     ? cpc :
                                            cpc + 1'b1;
            assign lane_ndone[g] = ldone[tidx] | (cact[g] & cexe[g] & d_exit);

            // address generation for the LSU
            assign lane_addr[g*32 +: 32] = d_atom ? a : (a + d_imm14);
            assign lane_data[g*32 +: 32] = d_atom ? b : dval;
        end
    endgenerate

    // ---- cross-lane unit: SHFL (warp shuffle) --------------------------------
    reg [WARP_SIZE*32-1:0] shfl_y;
    reg [31:0]             src;
    reg                    src_ok;
    always @* begin
        for (j = 0; j < WARP_SIZE; j = j + 1) begin
            case (d_smode)
                `SHFL_IDX : begin src = d_sval % WARP_SIZE; src_ok = 1'b1;                        end
                `SHFL_UP  : begin src = j - d_sval;         src_ok = (j >= d_sval);               end
                `SHFL_DOWN: begin src = j + d_sval;         src_ok = (j + d_sval < WARP_SIZE);    end
                default   : begin src = j ^ d_sval;         src_ok = ((j ^ d_sval) < WARP_SIZE);  end
            endcase
            if (src_ok && cact[src[LW-1:0]])
                shfl_y[j*32 +: 32] = a_flat[src[LW-1:0]*32 +: 32];
            else
                shfl_y[j*32 +: 32] = a_flat[j*32 +: 32];
        end
    end

    // ---- cross-lane unit: VOTE ----------------------------------------------
    wire [WARP_SIZE-1:0] ballot   = vote_bit & cexe;
    wire                 vote_any = |ballot;
    wire                 vote_all = (ballot == cexe);

    reg [WARP_SIZE*32-1:0] lane_res;
    reg [WARP_SIZE-1:0]    lane_pres;
    always @* begin
        for (j = 0; j < WARP_SIZE; j = j + 1) begin
            if (d_op == `OP_SHFL)       lane_res[j*32 +: 32] = shfl_y[j*32 +: 32];
            else if (d_op == `OP_VOTE)  lane_res[j*32 +: 32] = {{(32-WARP_SIZE){1'b0}}, ballot};
            else                        lane_res[j*32 +: 32] = alu_y[j*32 +: 32];
            if (d_op == `OP_VOTE)       lane_pres[j] = (d_vmode == `VOTE_ALL) ? vote_all : vote_any;
            else                        lane_pres[j] = alu_p[j];
        end
    end

    // -------------------------------------------------------------------------
    // Load/Store Unit (LSU) — combinational request builder
    // -------------------------------------------------------------------------
    // Global memory: pick the lowest pending lane (the "leader"), take its
    // cache line, and serve EVERY pending lane that falls in the same line in
    // one transaction. That is memory coalescing. Atomics serialize per lane.
    reg  [LW-1:0]            leader;
    reg                      have_leader;
    reg  [31:0]              line_base;
    reg  [WARP_SIZE-1:0]     g_serve;
    reg  [LINE_WORDS-1:0]    g_wmask;
    reg  [LINE_WORDS*32-1:0] g_wdata;
    // Shared memory: one access per bank per cycle; lanes hitting the same
    // word of a bank are a broadcast (free), different words are a conflict.
    reg  [WARP_SIZE-1:0]     s_sel;
    reg  [SMEM_BANKS-1:0]    bank_used;
    reg  [SMEM_BANKS*SMEM_AW-1:0] bank_addr;
    reg  [31:0]              la;
    reg  [BANK_LOG-1:0]      bk;

    always @* begin
        have_leader = 1'b0;
        leader      = {LW{1'b0}};
        for (j = WARP_SIZE-1; j >= 0; j = j - 1)
            if (lpend[j]) begin leader = j[LW-1:0]; have_leader = 1'b1; end

        line_base = r_addr[leader*32 +: 32] & ~(LINE_WORDS - 1);
        g_wmask   = {LINE_WORDS{1'b0}};
        g_wdata   = {LINE_WORDS*32{1'b0}};
        for (j = 0; j < WARP_SIZE; j = j + 1) begin
            la = r_addr[j*32 +: 32];
            if (d_atom) g_serve[j] = lpend[j] && (j == leader);
            else        g_serve[j] = lpend[j] && ((la & ~(LINE_WORDS - 1)) == line_base);
            if (g_serve[j] && d_store) begin
                g_wmask[la[LINE_LOG-1:0]] = 1'b1;
                g_wdata[la[LINE_LOG-1:0]*32 +: 32] = r_data[j*32 +: 32];   // higher lane wins
            end
        end

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
            end
        end
    end

    // ---- shared-memory banks ---------------------------------------------------
    // Each bank is its own RAM with one read and one write per cycle. The
    // resolver above guarantees every lane selected in a pass that maps to this
    // bank asks for the same word, so the bank's address is simply the address
    // of any selected lane in it.
    wire [SMEM_BANKS*32-1:0] bank_q;
    genvar sbk;
    generate
        for (sbk = 0; sbk < SMEM_BANKS; sbk = sbk + 1) begin : sbank
            reg  [31:0] mem [0:SMEM_WORDS/SMEM_BANKS-1];
            reg         hit;
            reg  [SMEM_AW-1:0] ba;
            reg  [31:0] wd;
            integer k;
            always @* begin
                hit = 1'b0; ba = {SMEM_AW{1'b0}}; wd = 32'd0;
                for (k = 0; k < WARP_SIZE; k = k + 1)
                    if (s_sel[k] && r_addr[k*32 +: BANK_LOG] == sbk) begin
                        hit = 1'b1; ba = r_addr[k*32 +: SMEM_AW]; wd = r_data[k*32 +: 32];   // last lane wins, as before
                    end
            end
            wire [SMEM_AW-BANK_LOG-1:0] row = ba[SMEM_AW-1:BANK_LOG];
            assign bank_q[sbk*32 +: 32] = mem[row];
            always @(posedge clk)
                if (!rst && state == S_MEM && d_shared && have_leader && hit && (d_store || d_atom))
                    mem[row] <= d_atom ? mem[row] + wd : wd;
`ifndef SYNTHESIS
            integer zz;
            initial for (zz = 0; zz < SMEM_WORDS/SMEM_BANKS; zz = zz + 1) mem[zz] = 32'd0;
`endif
        end
    endgenerate

    // ---- performance counters (read by ps_gpu_top) ---------------------------
    assign perf_commit = !rst && state == S_WB;
    function [7:0] lanes_on(input [WARP_SIZE-1:0] m);
        integer q; begin lanes_on = 8'd0; for (q = 0; q < WARP_SIZE; q = q + 1) lanes_on = lanes_on + m[q]; end
    endfunction
    assign perf_lanes = lanes_on(cexe);

    // -------------------------------------------------------------------------
    // Trace switch (simulation only)
    // -------------------------------------------------------------------------
    reg trace_on;
`ifndef SYNTHESIS
    // Simulation only: start registers and shared memory at zero so traces are
    // readable. Real hardware does NOT clear them — never rely on it.
    integer z;
    initial begin
        trace_on = $test$plusargs("trace");
    end
`else
    initial trace_on = 1'b0;
`endif

    // -------------------------------------------------------------------------
    // Main control Finite State Machine (FSM)
    // -------------------------------------------------------------------------
    always @(posedge clk) begin
        blk_done <= 1'b0;
        if (rst) begin
            state      <= S_IDLE;
            busy       <= 1'b0;
            w_valid    <= {NUM_WARPS{1'b0}};
            w_wait     <= {NUM_WARPS{1'b0}};
            ldone      <= {NT{1'b1}};
            lpc        <= {NT*IMEM_AW{1'b0}};
            preds      <= {NT*4{1'b0}};
            rr_ptr     <= {WW{1'b0}};
            mreq_valid <= 1'b0;
            lwait      <= 1'b0;
            lpend      <= {WARP_SIZE{1'b0}};
            ir         <= 32'd0;
            cpc        <= {IMEM_AW{1'b0}};
            cw         <= {WW{1'b0}};
        end else begin
            case (state)
            // -----------------------------------------------------------------
            S_IDLE: if (blk_start) begin
                busy     <= 1'b1;
                cur_blk  <= blk_id;
                cur_bdim <= blk_dim;
                cur_gdim <= grid_dim;
                for (i = 0; i < NUM_WARPS; i = i + 1)
                    w_valid[i] <= (i*WARP_SIZE < blk_dim);
                for (i = 0; i < NT; i = i + 1)
                    ldone[i] <= (i >= blk_dim);          // unused lanes start "exited"
                lpc      <= {NT*IMEM_AW{1'b0}};          // kernel entry point is PC 0
                preds    <= {NT*4{1'b0}};
                w_wait   <= {NUM_WARPS{1'b0}};
                rr_ptr   <= {WW{1'b0}};
                state    <= S_SCHED;
`ifndef SYNTHESIS
                if (trace_on) $display("{\"ev\":\"blk\",\"t\":%0d,\"sm\":%0d,\"blk\":%0d,\"ph\":\"start\"}", cycle, SM_ID, blk_id);
`endif
            end
            // -----------------------------------------------------------------
            S_SCHED: begin
                if (bar_release) begin
                    w_wait <= {NUM_WARPS{1'b0}};           // everyone arrived: release
`ifndef SYNTHESIS
                    if (trace_on) $display("{\"ev\":\"bar\",\"t\":%0d,\"sm\":%0d,\"blk\":%0d}", cycle, SM_ID, cur_blk);
`endif
                end else if (found) begin
                    cw    <= pick;
                    cpc   <= w_minpc[pick*IMEM_AW +: IMEM_AW];
                    cact  <= pick_act;
                    t_s   <= cycle;
                    state <= S_FETCH;
                end else if (live == {NUM_WARPS{1'b0}}) begin
                    busy     <= 1'b0;
                    blk_done <= 1'b1;
                    state    <= S_IDLE;
`ifndef SYNTHESIS
                    if (trace_on) $display("{\"ev\":\"blk\",\"t\":%0d,\"sm\":%0d,\"blk\":%0d,\"ph\":\"end\"}", cycle, SM_ID, cur_blk);
`endif
                end
            end
            // -----------------------------------------------------------------
            S_FETCH: begin
                ir    <= imem_data;
                t_f   <= cycle;
                state <= S_DECODE;
            end
            // -----------------------------------------------------------------
            S_DECODE: begin
                cexe  <= cact & guard_ok;
                t_d   <= cycle;
                state <= S_EXEC;
            end
            // -----------------------------------------------------------------
            S_EXEC: begin
                r_res   <= lane_res;
                r_pres  <= lane_pres;
                r_npc   <= lane_npc;
                r_ndone <= lane_ndone;
                r_addr  <= lane_addr;
                r_data  <= lane_data;
                lpend   <= d_mem ? cexe : {WARP_SIZE{1'b0}};
                lwait   <= 1'b0;
                txn_cnt <= 16'd0;
                mem_cyc <= 16'd0;
                t_e     <= cycle;
                t_m     <= cycle + 1;
                state   <= d_mem ? S_MEM : S_WB;
            end
            // -----------------------------------------------------------------
            S_MEM: begin
                mem_cyc <= mem_cyc + 1'b1;
                if (d_shared) begin
                    // ---------------- shared memory: one pass per cycle -------
                    if (!have_leader) begin
                        state <= S_WB;
                    end else begin
                        txn_cnt <= txn_cnt + 1'b1;
                        for (j = 0; j < WARP_SIZE; j = j + 1) begin
                            if (s_sel[j]) begin
                                if (d_load)
                                    r_res[j*32 +: 32] <= bank_q[r_addr[j*32 +: BANK_LOG]*32 +: 32];
                                if (d_store) begin
`ifndef SYNTHESIS
                                    if (trace_on) $display("{\"ev\":\"sw\",\"t\":%0d,\"sm\":%0d,\"a\":%0d,\"v\":%0d}", cycle, SM_ID, r_addr[j*32 +: SMEM_AW], r_data[j*32 +: 32]);
`endif
                                end
                                if (d_atom) begin
                                    r_res[j*32 +: 32] <= bank_q[r_addr[j*32 +: BANK_LOG]*32 +: 32];
`ifndef SYNTHESIS
                                    if (trace_on) $display("{\"ev\":\"sw\",\"t\":%0d,\"sm\":%0d,\"a\":%0d,\"v\":%0d}", cycle, SM_ID, r_addr[j*32 +: SMEM_AW], bank_q[r_addr[j*32 +: BANK_LOG]*32 +: 32] + r_data[j*32 +: 32]);
`endif
                                end
                            end
                        end
                        lpend <= lpend & ~s_sel;
                    end
                end else begin
                    // ---------------- global memory: coalesced transactions ---
                    if (!lwait) begin
                        if (!have_leader) begin
                            state <= S_WB;
                        end else begin
                            mreq_valid <= 1'b1;
                            mreq_op    <= d_atom ? `MOP_ATOM : (d_store ? `MOP_WRITE : `MOP_READ);
                            mreq_addr  <= d_atom ? r_addr[leader*32 +: 32] : line_base;
                            mreq_wmask <= g_wmask;
                            mreq_wdata <= d_atom ? {{(LINE_WORDS-1)*32{1'b0}}, r_data[leader*32 +: 32]} : g_wdata;
                            lserve     <= g_serve;
                            lwait      <= 1'b1;
                            txn_cnt    <= txn_cnt + 1'b1;
                        end
                    end else if (mresp_valid) begin
                        mreq_valid <= 1'b0;
                        lwait      <= 1'b0;
                        for (j = 0; j < WARP_SIZE; j = j + 1) begin
                            if (lserve[j] && d_load)
                                r_res[j*32 +: 32] <= mresp_rdata[r_addr[j*32 +: LINE_LOG]*32 +: 32];
                            if (lserve[j] && d_atom)
                                r_res[j*32 +: 32] <= mresp_rdata[31:0];     // old value
                        end
                        lpend <= lpend & ~lserve;
                    end
                end
            end
            // -----------------------------------------------------------------
            S_WB: begin
                for (j = 0; j < WARP_SIZE; j = j + 1) begin
                    if (cexe[j] && d_wpred)
                        preds[(cw*WARP_SIZE + j)*4 + d_rd[1:0]] <= r_pres[j];
                    lpc[(cw*WARP_SIZE + j)*IMEM_AW +: IMEM_AW] <= r_npc[j*IMEM_AW +: IMEM_AW];
                    ldone[cw*WARP_SIZE + j] <= r_ndone[j];
                end
                if (d_bar) w_wait[cw] <= 1'b1;
                rr_ptr <= cw + 1'b1;
                state  <= S_SCHED;
`ifndef SYNTHESIS
                if (trace_on) begin
                    $write("{\"ev\":\"commit\",\"t\":%0d,\"sm\":%0d,\"w\":%0d,\"blk\":%0d,\"pc\":%0d,\"ir\":%0d,",
                           cycle, SM_ID, cw, cur_blk, cpc, ir);
                    $write("\"st\":[%0d,%0d,%0d,%0d,%0d,%0d],\"act\":%0d,\"exe\":%0d,\"txn\":%0d,\"mcyc\":%0d,",
                           t_s, t_f, t_d, t_e, (mem_cyc != 0) ? t_m : 0, cycle, cact, cexe, txn_cnt, mem_cyc);
                    $write("\"wr\":%0d,\"rd\":%0d,\"pw\":%0d,\"pv\":%0d,\"v\":[", d_wrd, d_rd, d_wpred, r_pres & cexe);
                    for (j = 0; j < WARP_SIZE; j = j + 1) begin
                        if (j > 0) $write(",");
                        $write("%0d", r_res[j*32 +: 32]);
                    end
                    $write("],\"lpc\":[");
                    for (j = 0; j < WARP_SIZE; j = j + 1) begin
                        if (j > 0) $write(",");
                        $write("%0d", r_npc[j*IMEM_AW +: IMEM_AW]);
                    end
                    $write("],\"addr\":[");
                    for (j = 0; j < WARP_SIZE; j = j + 1) begin
                        if (j > 0) $write(",");
                        $write("%0d", d_mem ? r_addr[j*32 +: 32] : 0);
                    end
                    $display("],\"done\":%0d}", r_ndone);
                end
`endif
            end
            default: state <= S_IDLE;
            endcase
        end
    end
endmodule
