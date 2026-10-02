// =============================================================================
// ps_tmds_enc.v — DVI/HDMI TMDS encoder (8b/10b transition-minimized, DC balanced)
// -----------------------------------------------------------------------------
// Follows the encoding algorithm of the DVI 1.0 specification, section 3.2:
//   stage 1  pick XOR or XNOR chaining, whichever gives fewer transitions
//   stage 2  invert the word when that brings the running disparity back to 0
//   blanking send one of four control tokens that carry HSYNC/VSYNC (on lane 0)
// One encoder per colour lane; output bit 0 is transmitted first.
// =============================================================================
module ps_tmds_enc (
    input  wire       clk,
    input  wire [7:0] d,          // pixel byte
    input  wire [1:0] c,          // control bits (lane 0: {vsync, hsync})
    input  wire       de,         // 1 = video data, 0 = blanking
    output reg  [9:0] q
);
    function [3:0] ones(input [7:0] v); integer i; begin ones = 0; for (i = 0; i < 8; i = i + 1) ones = ones + v[i]; end endfunction
    wire [3:0] n1d = ones(d);
    wire       xnor_ = (n1d > 4) || (n1d == 4 && d[0] == 1'b0);
    wire [8:0] qm;
    assign qm[0] = d[0];
    genvar i;
    generate for (i = 1; i < 8; i = i + 1) begin : chain
        assign qm[i] = xnor_ ? ~(qm[i-1] ^ d[i]) : (qm[i-1] ^ d[i]);
    end endgenerate
    assign qm[8] = ~xnor_;
    wire [3:0] n1q = ones(qm[7:0]);
    wire signed [5:0] diff = $signed({2'b0, n1q}) - $signed(6'd8 - {2'b0, n1q});   // ones - zeros
    reg  signed [5:0] cnt = 0;                                                        // running disparity
    always @(posedge clk) begin
        if (!de) begin
            cnt <= 0;
            case (c)
                2'b00: q <= 10'b1101010100;
                2'b01: q <= 10'b0010101011;
                2'b10: q <= 10'b0101010100;
                default: q <= 10'b1010101011;
            endcase
        end else if (cnt == 0 || diff == 0) begin
            q   <= {~qm[8], qm[8], qm[8] ? qm[7:0] : ~qm[7:0]};
            cnt <= qm[8] ? cnt + diff : cnt - diff;
        end else if ((cnt > 0 && diff > 0) || (cnt < 0 && diff < 0)) begin
            q   <= {1'b1, qm[8], ~qm[7:0]};
            cnt <= cnt + $signed({4'b0, qm[8], 1'b0}) - diff;
        end else begin
            q   <= {1'b0, qm[8], qm[7:0]};
            cnt <= cnt - $signed({4'b0, ~qm[8], 1'b0}) + diff;
        end
    end
endmodule
