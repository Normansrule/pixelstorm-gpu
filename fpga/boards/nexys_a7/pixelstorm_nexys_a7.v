// =============================================================================
// Pixelstorm on the Digilent Nexys A7-100T (Xilinx Artix-7 XC7A100T-1CSG324C)
//   BTNC         start the selected kernel          CPU_RESET  reset
//   SW1..SW0     kernel: 0 gradient, 1 triangle, 2 Mandelbrot, 3 Mandelbrot zoom
//   SW15..SW14   GPU speed: full, 1/64, 1/1024, 1/16384 (slow motion)
//   VGA          the framebuffer, painting live    7-segment  cycle count (hex)
//   LED15 busy, LED14 done, LED13..12 kernel       UART       "PIXELSTORM k=.. cycles=.." at 115200 8N1
// =============================================================================
module pixelstorm_nexys_a7 (
    input  wire        CLK100MHZ,
    input  wire        CPU_RESETN,
    input  wire        BTNC,
    input  wire [15:0] SW,
    output wire [15:0] LED,
    output wire [3:0]  VGA_R, output wire [3:0] VGA_G, output wire [3:0] VGA_B,
    output wire        VGA_HS, output wire VGA_VS,
    output wire        CA, CB, CC, CD, CE, CF, CG, DP,
    output wire [7:0]  AN,
    output wire        UART_RXD_OUT,
    input  wire        UART_TXD_IN
);
    wire clk_pix, clk_gpu, rst;
    clocking_xc7 u_clk (.clk100(CLK100MHZ), .rst_in(~CPU_RESETN), .speed(SW[15:14]), .clk_pix(clk_pix), .clk_gpu(clk_gpu), .rst(rst));
    wire [6:0] seg; wire [3:0] an; wire de;
    ps_fpga_top #(.NUM_SMS(1), .NUM_WARPS(4), .WARP_SIZE(8), .NUM_REGS(16), .SMEM_WORDS(256), .SMEM_BANKS(8), .IMEM_AW(8)) u_top (
        .clk_gpu(clk_gpu), .clk_pix(clk_pix), .rst(rst), .btn_start(BTNC), .sel(SW[1:0]), .anim(SW[2]), .arg(SW[13:3]),
        .vga_r(VGA_R), .vga_g(VGA_G), .vga_b(VGA_B), .vga_hs(VGA_HS), .vga_vs(VGA_VS), .vga_de(de),
        .led(LED), .seg(seg), .an(an), .uart_tx(UART_RXD_OUT), .uart_rx(UART_TXD_IN));
    assign {CG, CF, CE, CD, CC, CB, CA} = seg;
    assign DP = 1'b1;
    assign AN = {4'b1111, an};
endmodule
