// =============================================================================
// ps_dispatcher.v — the block (CTA) scheduler
// -----------------------------------------------------------------------------
// A kernel launch "<<<grid, block>>>" creates gridDim thread blocks. The
// dispatcher hands the next unlaunched block to any idle Streaming
// Multiprocessor (SM) until all blocks have run. NVIDIA calls the real one the
// GigaThread engine / Compute Work Distributor.
// =============================================================================
module ps_dispatcher #(
    parameter NUM_SMS = 2
)(
    input  wire               clk,
    input  wire               rst,
    input  wire               launch,        // pulse: start a kernel
    input  wire [15:0]        grid_dim,
    input  wire [15:0]        block_dim,
    input  wire [NUM_SMS-1:0] sm_busy,
    output reg  [NUM_SMS-1:0] sm_start,      // pulse per SM
    output reg  [15:0]        sm_blk_id,     // block id that goes with sm_start
    output reg  [15:0]        r_grid,
    output reg  [15:0]        r_block,
    output reg                running,
    output reg                done
);
    reg [15:0] next_blk;
    integer s;
    reg picked;

    always @(posedge clk) begin
        sm_start <= {NUM_SMS{1'b0}};
        if (rst) begin
            running  <= 1'b0;
            done     <= 1'b0;
            next_blk <= 16'd0;
        end else if (launch) begin
            running  <= 1'b1;
            done     <= 1'b0;
            next_blk <= 16'd0;
            r_grid   <= grid_dim;
            r_block  <= block_dim;
        end else if (running) begin
            picked = 1'b0;
            if (next_blk < r_grid) begin
                // hand out at most one block per cycle, lowest idle SM first
                for (s = 0; s < NUM_SMS; s = s + 1) begin
                    if (!picked && !sm_busy[s] && !sm_start[s]) begin
                        picked      = 1'b1;
                        sm_start[s] <= 1'b1;
                        sm_blk_id   <= next_blk;
                        next_blk    <= next_blk + 1'b1;
                    end
                end
            end else if (sm_busy == {NUM_SMS{1'b0}} && sm_start == {NUM_SMS{1'b0}}) begin
                running <= 1'b0;
                done    <= 1'b1;
            end
        end
    end
endmodule
