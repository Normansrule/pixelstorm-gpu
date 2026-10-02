// =============================================================================
// ps_uploader.v — receive a kernel over the USB serial port and launch it
// -----------------------------------------------------------------------------
// Packet (little-endian), sent by ./pixelstorm upload:
//   "PSK1"                         magic
//   name[16]                       shown on the status line
//   grid u16, block u16            launch shape
//   fb_addr u16, fb_w u8, fb_h u8  framebuffer to display
//   n u16                          instruction count (<= 256)
//   n x u32                        instructions
//   16 x u32                       kernel arguments (constant bank)
//   checksum u8                    sum of every byte after the magic, mod 256
// Everything is written into ROM slot 3 as it arrives; the kernel is launched
// only if the checksum matches. A pause of ~50 ms mid-packet restarts the parse.
// =============================================================================
module ps_uploader #(parameter DIV = 217, parameter IMEM_AW = 8)(
    input  wire              clk, input wire rst, input wire rx,
    output reg               we_i, output reg we_c, output reg we_f, output reg we_n,
    output reg [IMEM_AW-1:0] waddr, output reg [31:0] wdata,
    output reg               go,          // one-cycle pulse: checksum good, launch slot 3
    output reg               ok,          // last upload was good (for an LED)
    output reg               err
);
    wire bv; wire [7:0] b;
    ps_uart_rx #(.DIV(DIV)) u_rx (.clk(clk), .rst(rst), .rx(rx), .valid(bv), .data(b));
    reg [15:0] k;                // byte index in the packet
    reg [15:0] n;                // instruction count
    reg [7:0]  sum;
    reg [31:0] acc;
    reg [23:0] idle;
    wire [15:0] i0 = 16'd30, p0 = 16'd30 + {n, 2'b00}, cks = p0 + 16'd64;
    always @(posedge clk) begin
        {we_i, we_c, we_f, we_n, go, err} <= 6'b0;
        if (rst) begin k <= 0; ok <= 0; idle <= 0; end
        else if (!bv) begin
            if (k != 0) begin idle <= idle + 1'b1; if (idle == 24'd1_250_000) k <= 0; end   // ~50 ms at 25 MHz
        end else begin
            idle <= 0;
            acc <= {b, acc[31:8]};
            if (k >= 4) sum <= sum + b;
            if (k < 4) begin
                if (b == (("PSK1" >> (8 * (3 - k))) & 32'hFF)) k <= k + 1'b1;
                else k <= (b == "P") ? 16'd1 : 16'd0;
                sum <= 0;
            end else begin
                k <= k + 1'b1;
                if (k < 20) begin we_n <= 1; waddr <= k - 4; wdata <= {24'd0, b}; end
                else if (k == 21) begin we_f <= 1; waddr <= 0; wdata <= {16'd0, b, acc[31:24]}; end        // grid
                else if (k == 23) begin we_f <= 1; waddr <= 1; wdata <= {16'd0, b, acc[31:24]}; end        // block
                else if (k == 25) begin we_f <= 1; waddr <= 2; wdata <= {16'd0, b, acc[31:24]}; end        // fb address
                else if (k == 27) begin we_f <= 1; waddr <= 3; wdata <= {16'd0, acc[31:24], b}; end        // (fb_w << 8) | fb_h
                else if (k == 29) n <= {b, acc[31:24]};
                else if (k >= i0 && k < p0 && k[1:0] == 2'd1) begin we_i <= 1; waddr <= (k - i0) >> 2; wdata <= {b, acc[31:8]}; end
                else if (k >= p0 && k < cks && (k - p0) % 4 == 3) begin we_c <= 1; waddr <= (k - p0) >> 2; wdata <= {b, acc[31:8]}; end
                else if (k == cks) begin
                    k <= 0;
                    if (b == sum) begin go <= 1; ok <= 1; end else begin err <= 1; ok <= 0; end
                end
            end
        end
    end
endmodule
