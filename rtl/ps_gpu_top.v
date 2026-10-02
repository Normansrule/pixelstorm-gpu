// =============================================================================
// ps_gpu_top.v — the whole Pixelstorm GPU
// -----------------------------------------------------------------------------
//
//            host (testbench / "driver")
//              |  load program, constants, launch <<<grid, block>>>
//              v
//   +------------------------------------------------------------+
//   |  instruction memory   constant bank     block dispatcher    |
//   |        |                   |                  |             |
//   |   +----+------+-------+----+------+   start/done per SM     |
//   |   |  SM 0     |       |  SM 1     |  ... NUM_SMS           |
//   |   | warps x lanes     | warps x lanes                       |
//   |   +----+------+       +----+------+                         |
//   |        \                  /                                  |
//   |       global memory arbiter (round robin)                   |
//   +-----------------------------|------------------------------+
//                                 v
//                       global memory (DRAM model, in testbench)
// =============================================================================
module ps_gpu_top #(
    parameter NUM_SMS    = 2,
    parameter NUM_WARPS  = 4,
    parameter WARP_SIZE  = 8,
    parameter NUM_REGS   = 16,
    parameter LINE_WORDS = 4,
    parameter SMEM_WORDS = 256,
    parameter SMEM_BANKS = 8,
    parameter IMEM_AW    = 10,
    parameter CONST_AW   = 4,
    parameter CACHE_LINES = 0          // 0 = no cache (wires); otherwise a direct-mapped shared cache
)(
    input  wire                     clk,
    input  wire                     rst,
    // ---- host programming interface ----
    input  wire                     host_imem_we,
    input  wire [IMEM_AW-1:0]       host_imem_addr,
    input  wire [31:0]              host_imem_wdata,
    input  wire                     host_cmem_we,
    input  wire [CONST_AW-1:0]      host_cmem_addr,
    input  wire [31:0]              host_cmem_wdata,
    input  wire                     launch,
    input  wire [15:0]              grid_dim,
    input  wire [15:0]              block_dim,
    output wire                     done,
    output wire                     running,
    output reg  [31:0]              cycle,
    // ---- global memory channel ----
    output wire                     mem_req_valid,
    output wire [1:0]               mem_req_op,
    output wire [31:0]              mem_req_addr,
    output wire [LINE_WORDS-1:0]    mem_req_wmask,
    output wire [LINE_WORDS*32-1:0] mem_req_wdata,
    input  wire                     mem_resp_valid,
    input  wire [LINE_WORDS*32-1:0] mem_resp_rdata
);
    // ---- instruction memory + constant bank ----------------------------------
    reg [31:0] imem [0:(1<<IMEM_AW)-1];
    reg [31:0] cmem [0:(1<<CONST_AW)-1];
    always @(posedge clk) begin
        if (host_imem_we) imem[host_imem_addr] <= host_imem_wdata;
        if (host_cmem_we) cmem[host_cmem_addr] <= host_cmem_wdata;
    end

    // ---- cycle counter (restarts at every launch) ------------------------------
    always @(posedge clk) begin
        if (rst || launch) cycle <= 32'd0;
        else               cycle <= cycle + 1'b1;
    end

    // ---- block dispatcher ------------------------------------------------------
    wire [NUM_SMS-1:0] sm_busy, sm_start, sm_done;
    wire [15:0]        blk_id, r_grid, r_block;

    ps_dispatcher #(.NUM_SMS(NUM_SMS)) u_disp (
        .clk(clk), .rst(rst), .launch(launch), .grid_dim(grid_dim), .block_dim(block_dim),
        .sm_busy(sm_busy), .sm_start(sm_start), .sm_blk_id(blk_id),
        .r_grid(r_grid), .r_block(r_block), .running(running), .done(done)
    );

    // ---- Streaming Multiprocessors ---------------------------------------------
    wire [NUM_SMS-1:0]               req_valid;
    wire [NUM_SMS*2-1:0]             req_op;
    wire [NUM_SMS*32-1:0]            req_addr;
    wire [NUM_SMS*LINE_WORDS-1:0]    req_wmask;
    wire [NUM_SMS*LINE_WORDS*32-1:0] req_wdata;
    wire [NUM_SMS-1:0]               resp_valid;
    wire [LINE_WORDS*32-1:0]         resp_rdata;

    genvar s;
    generate
        for (s = 0; s < NUM_SMS; s = s + 1) begin : g_sm
            wire [IMEM_AW-1:0]  ia;
            wire [CONST_AW-1:0] ca;
            ps_sm #(
                .SM_ID(s), .NUM_WARPS(NUM_WARPS), .WARP_SIZE(WARP_SIZE), .NUM_REGS(NUM_REGS),
                .LINE_WORDS(LINE_WORDS), .SMEM_WORDS(SMEM_WORDS), .SMEM_BANKS(SMEM_BANKS),
                .IMEM_AW(IMEM_AW), .CONST_AW(CONST_AW)
            ) u_sm (
                .clk(clk), .rst(rst), .cycle(cycle),
                .blk_start(sm_start[s]), .blk_id(blk_id), .blk_dim(r_block), .grid_dim(r_grid),
                .busy(sm_busy[s]), .blk_done(sm_done[s]),
                .imem_addr(ia), .imem_data(imem[ia]),
                .cmem_addr(ca), .cmem_data(cmem[ca]),
                .mreq_valid(req_valid[s]), .mreq_op(req_op[s*2 +: 2]), .mreq_addr(req_addr[s*32 +: 32]),
                .mreq_wmask(req_wmask[s*LINE_WORDS +: LINE_WORDS]),
                .mreq_wdata(req_wdata[s*LINE_WORDS*32 +: LINE_WORDS*32]),
                .mresp_valid(resp_valid[s]), .mresp_rdata(resp_rdata)
            );
        end
    endgenerate

    // ---- global memory arbiter ---------------------------------------------------
    wire                     a_req_valid;
    wire [1:0]               a_req_op;
    wire [31:0]              a_req_addr;
    wire [LINE_WORDS-1:0]    a_req_wmask;
    wire [LINE_WORDS*32-1:0] a_req_wdata;
    wire                     a_resp_valid;
    wire [LINE_WORDS*32-1:0] a_resp_rdata;
    ps_mem_arbiter #(.NUM_SMS(NUM_SMS), .LINE_WORDS(LINE_WORDS)) u_arb (
        .clk(clk), .rst(rst), .cycle(cycle),
        .sm_req_valid(req_valid), .sm_req_op(req_op), .sm_req_addr(req_addr),
        .sm_req_wmask(req_wmask), .sm_req_wdata(req_wdata),
        .sm_resp_valid(resp_valid), .sm_resp_rdata(resp_rdata),
        .mem_req_valid(a_req_valid), .mem_req_op(a_req_op), .mem_req_addr(a_req_addr),
        .mem_req_wmask(a_req_wmask), .mem_req_wdata(a_req_wdata),
        .mem_resp_valid(a_resp_valid), .mem_resp_rdata(a_resp_rdata)
    );

    // ---- optional shared cache between the arbiter and DRAM --------------------
    generate
        if (CACHE_LINES == 0) begin : g_nocache
            assign mem_req_valid = a_req_valid;  assign mem_req_op    = a_req_op;
            assign mem_req_addr  = a_req_addr;   assign mem_req_wmask = a_req_wmask;
            assign mem_req_wdata = a_req_wdata;
            assign a_resp_valid  = mem_resp_valid; assign a_resp_rdata = mem_resp_rdata;
        end else begin : g_cache
            ps_cache #(.LINES(CACHE_LINES), .LINE_WORDS(LINE_WORDS)) u_cache (
                .clk(clk), .rst(rst), .cycle(cycle),
                .up_req_valid(a_req_valid), .up_req_op(a_req_op), .up_req_addr(a_req_addr),
                .up_req_wmask(a_req_wmask), .up_req_wdata(a_req_wdata),
                .up_resp_valid(a_resp_valid), .up_resp_rdata(a_resp_rdata),
                .dn_req_valid(mem_req_valid), .dn_req_op(mem_req_op), .dn_req_addr(mem_req_addr),
                .dn_req_wmask(mem_req_wmask), .dn_req_wdata(mem_req_wdata),
                .dn_resp_valid(mem_resp_valid), .dn_resp_rdata(mem_resp_rdata)
            );
        end
    endgenerate
endmodule
