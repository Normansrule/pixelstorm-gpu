// =============================================================================
// ps_mem_arbiter.v — shares ONE global-memory channel among all SMs
// -----------------------------------------------------------------------------
// Round-robin, one transaction in flight. Real GPUs have many memory
// partitions, an L2 cache and a crossbar/NoC (Network-on-Chip); this is the
// smallest thing that still shows why memory bandwidth is the bottleneck.
// =============================================================================
module ps_mem_arbiter #(
    parameter NUM_SMS    = 2,
    parameter LINE_WORDS = 4
)(
    input  wire                             clk,
    input  wire                             rst,
    input  wire [31:0]                      cycle,
    // ---- SM side (flattened) ----
    input  wire [NUM_SMS-1:0]               sm_req_valid,
    input  wire [NUM_SMS*2-1:0]             sm_req_op,
    input  wire [NUM_SMS*32-1:0]            sm_req_addr,
    input  wire [NUM_SMS*LINE_WORDS-1:0]    sm_req_wmask,
    input  wire [NUM_SMS*LINE_WORDS*32-1:0] sm_req_wdata,
    output wire [NUM_SMS-1:0]               sm_resp_valid,
    output wire [LINE_WORDS*32-1:0]         sm_resp_rdata,
    // ---- memory side ----
    output reg                              mem_req_valid,   // 1-cycle pulse
    output reg  [1:0]                       mem_req_op,
    output reg  [31:0]                      mem_req_addr,
    output reg  [LINE_WORDS-1:0]            mem_req_wmask,
    output reg  [LINE_WORDS*32-1:0]         mem_req_wdata,
    input  wire                             mem_resp_valid,
    input  wire [LINE_WORDS*32-1:0]         mem_resp_rdata
);
    localparam SW = (NUM_SMS > 1) ? $clog2(NUM_SMS) : 1;

    reg          busy;
    reg [SW-1:0] owner;
    reg [SW-1:0] rr;
    reg          found;
    reg [SW-1:0] pick;
    integer i, k;

    reg trace_on;
`ifndef SYNTHESIS
    initial trace_on = $test$plusargs("trace");
`else
    initial trace_on = 1'b0;
`endif

    always @* begin
        found = 1'b0;
        pick  = {SW{1'b0}};
        for (i = 0; i < NUM_SMS; i = i + 1) begin
            k = (rr + i) % NUM_SMS;
            if (!found && sm_req_valid[k]) begin
                found = 1'b1;
                pick  = k[SW-1:0];
            end
        end
    end

    genvar g;
    generate
        for (g = 0; g < NUM_SMS; g = g + 1) begin : resp
            assign sm_resp_valid[g] = busy && mem_resp_valid && (owner == g);
        end
    endgenerate
    assign sm_resp_rdata = mem_resp_rdata;

    always @(posedge clk) begin
        mem_req_valid <= 1'b0;
        if (rst) begin
            busy  <= 1'b0;
            owner <= {SW{1'b0}};
            rr    <= {SW{1'b0}};
        end else if (!busy) begin
            if (found) begin
                busy          <= 1'b1;
                owner         <= pick;
                mem_req_valid <= 1'b1;
                mem_req_op    <= sm_req_op   [pick*2 +: 2];
                mem_req_addr  <= sm_req_addr [pick*32 +: 32];
                mem_req_wmask <= sm_req_wmask[pick*LINE_WORDS +: LINE_WORDS];
                mem_req_wdata <= sm_req_wdata[pick*LINE_WORDS*32 +: LINE_WORDS*32];
`ifndef SYNTHESIS
                if (trace_on)
                    $display("{\"ev\":\"mreq\",\"t\":%0d,\"sm\":%0d,\"op\":%0d,\"a\":%0d,\"wm\":%0d}",
                             cycle, pick, sm_req_op[pick*2 +: 2], sm_req_addr[pick*32 +: 32],
                             sm_req_wmask[pick*LINE_WORDS +: LINE_WORDS]);
`endif
            end
        end else if (mem_resp_valid) begin
            busy <= 1'b0;
            rr   <= owner + 1'b1;
        end
    end
endmodule
