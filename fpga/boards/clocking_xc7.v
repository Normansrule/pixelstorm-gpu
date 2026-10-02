// =============================================================================
// fpga/boards/clocking_xc7.v — Xilinx 7-series clocking for Pixelstorm boards
// -----------------------------------------------------------------------------
// 100 MHz board oscillator -> MMCM -> 25 MHz pixel clock (VGA 640x480).
// The GPU clock is the same 25 MHz passed through a BUFGCE (a clock buffer
// with enable), so it can run at full speed or in slow motion:
//   speed = 0: 25 MHz   1: 1/64   2: 1/1024   3: 1/16384  (watch warps paint)
// Reset is held until the MMCM locks and is synchronized to the pixel clock.
// =============================================================================
module clocking_xc7 (
    input  wire       clk100,
    input  wire       rst_in,          // active high, asynchronous (button)
    input  wire [1:0] speed,
    output wire       clk_pix,
    output wire       clk_gpu,
    output reg        rst
);
    wire fb, c25, locked;
    MMCME2_BASE #(.CLKIN1_PERIOD(10.0), .CLKFBOUT_MULT_F(10.0), .CLKOUT0_DIVIDE_F(40.0)) u_mmcm (
        .CLKIN1(clk100), .CLKFBIN(fb), .CLKFBOUT(fb), .CLKOUT0(c25), .LOCKED(locked),
        .PWRDWN(1'b0), .RST(1'b0),
        .CLKFBOUTB(), .CLKOUT0B(), .CLKOUT1(), .CLKOUT1B(), .CLKOUT2(), .CLKOUT2B(),
        .CLKOUT3(), .CLKOUT3B(), .CLKOUT4(), .CLKOUT5(), .CLKOUT6());
    BUFG u_bufg (.I(c25), .O(clk_pix));

    reg [13:0] div = 0; reg ce = 1'b1;
    always @(posedge clk_pix) begin
        div <= div + 1'b1;
        case (speed)
            2'd0: ce <= 1'b1;
            2'd1: ce <= (div[5:0]  == 0);
            2'd2: ce <= (div[9:0]  == 0);
            default: ce <= (div[13:0] == 0);
        endcase
    end
    BUFGCE u_gate (.I(c25), .CE(ce | rst), .O(clk_gpu));   // clock runs freely during reset so the GPU resets

    reg [3:0] rs = 4'hF;
    always @(posedge clk_pix or posedge rst_in)
        if (rst_in) rs <= 4'hF; else rs <= {rs[2:0], ~locked};
    always @(posedge clk_pix) rst <= rs[3];
endmodule
