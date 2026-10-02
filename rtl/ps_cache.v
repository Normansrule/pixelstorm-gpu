// =============================================================================
// ps_cache.v — a small shared cache between the memory arbiter and DRAM
// -----------------------------------------------------------------------------
// Direct-mapped, write-through, no write-allocate. One request at a time (the
// arbiter already serializes the SMs), so it plays the role of a tiny L2.
//
//   read  + hit   answer next cycle from the cache, DRAM is never touched
//   read  + miss  forward to DRAM, fill the line when it returns, answer
//   write         forward to DRAM (write-through); update the cached copy if
//                 the line is present
//   atomic        forward to DRAM; drop the cached copy so it cannot go stale
//
// address -> [ tag | index (log2 LINES bits) | word in line (log2 LINE_WORDS) ]
// Real GPUs: L1 per SM (about 30 cycles) and a large shared L2 (about 200).
// =============================================================================
module ps_cache #(
    parameter LINES      = 16,
    parameter LINE_WORDS = 4
)(
    input  wire                       clk,
    input  wire                       rst,
    input  wire [31:0]                cycle,
    // ---- from the arbiter ----
    input  wire                       up_req_valid,
    input  wire [1:0]                 up_req_op,
    input  wire [31:0]                up_req_addr,
    input  wire [LINE_WORDS-1:0]      up_req_wmask,
    input  wire [LINE_WORDS*32-1:0]   up_req_wdata,
    output reg                        up_resp_valid,
    output reg  [LINE_WORDS*32-1:0]   up_resp_rdata,
    // ---- to DRAM ----
    output reg                        dn_req_valid,
    output reg  [1:0]                 dn_req_op,
    output reg  [31:0]                dn_req_addr,
    output reg  [LINE_WORDS-1:0]      dn_req_wmask,
    output reg  [LINE_WORDS*32-1:0]   dn_req_wdata,
    input  wire                       dn_resp_valid,
    input  wire [LINE_WORDS*32-1:0]   dn_resp_rdata
);
    localparam OW = $clog2(LINE_WORDS);
    localparam IW = $clog2(LINES);

    reg                      valid [0:LINES-1];
    reg [31:0]               tagr  [0:LINES-1];
    reg [LINE_WORDS*32-1:0]  data  [0:LINES-1];

    reg          waiting;
    reg [1:0]    w_op;
    reg [IW-1:0] w_idx;
    reg [31:0]   w_tag;

    wire [IW-1:0] idx = up_req_addr[OW +: IW];
    wire [31:0]   tag = up_req_addr >> (OW + IW);
    wire          hit = valid[idx] && (tagr[idx] == tag);

    reg trace_on;
`ifndef SYNTHESIS
    initial trace_on = $test$plusargs("trace");
`else
    initial trace_on = 1'b0;
`endif
    integer i, w;

    always @(posedge clk) begin
        up_resp_valid <= 1'b0;
        dn_req_valid  <= 1'b0;
        if (rst) begin
            waiting <= 1'b0;
            for (i = 0; i < LINES; i = i + 1) valid[i] <= 1'b0;
        end else if (up_req_valid) begin
            if (up_req_op == 2'd0 && hit) begin                 // read hit
                up_resp_valid <= 1'b1;
                up_resp_rdata <= data[idx];
`ifndef SYNTHESIS
                if (trace_on) $display("{\"ev\":\"cache\",\"t\":%0d,\"hit\":1,\"a\":%0d}", cycle, up_req_addr);
`endif
            end else begin                                        // miss, write or atomic: go to DRAM
                dn_req_valid <= 1'b1;
                dn_req_op    <= up_req_op;
                dn_req_addr  <= up_req_addr;
                dn_req_wmask <= up_req_wmask;
                dn_req_wdata <= up_req_wdata;
                waiting      <= 1'b1;
                w_op         <= up_req_op;
                w_idx        <= idx;
                w_tag        <= tag;
                if (up_req_op == 2'd1 && hit)                     // write-through: keep the copy current
                    for (w = 0; w < LINE_WORDS; w = w + 1)
                        if (up_req_wmask[w]) data[idx][w*32 +: 32] <= up_req_wdata[w*32 +: 32];
                if (up_req_op == 2'd2 && hit) valid[idx] <= 1'b0; // atomic: drop the copy
`ifndef SYNTHESIS
                if (trace_on && up_req_op == 2'd0) $display("{\"ev\":\"cache\",\"t\":%0d,\"hit\":0,\"a\":%0d}", cycle, up_req_addr);
`endif
            end
        end else if (waiting && dn_resp_valid) begin
            waiting       <= 1'b0;
            up_resp_valid <= 1'b1;
            up_resp_rdata <= dn_resp_rdata;
            if (w_op == 2'd0) begin                               // fill the line on a read miss
                valid[w_idx] <= 1'b1;
                tagr[w_idx]  <= w_tag;
                data[w_idx]  <= dn_resp_rdata;
            end
        end
    end
endmodule
