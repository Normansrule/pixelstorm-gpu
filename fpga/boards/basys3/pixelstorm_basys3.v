// =============================================================================
// Pixelstorm on the Digilent Basys 3 (Xilinx Artix-7 XC7A35T-1CPG236C)
// A leaner GPU so it fits the smaller FPGA: 1 SM, 8 warps x 4 lanes (still
// 32-thread blocks, so every demo kernel runs unchanged), 4 shared-memory banks.
//   btnC start   btnU reset   sw1..0 kernel   sw15..14 speed
//   VGA framebuffer   7-segment cycle count   LEDs status   UART status line
// =============================================================================
module pixelstorm_basys3 (
    input  wire        clk,
    input  wire        btnC, input wire btnU,
    input  wire [15:0] sw,
    output wire [15:0] led,
    output wire [3:0]  vgaRed, output wire [3:0] vgaGreen, output wire [3:0] vgaBlue,
    output wire        Hsync, output wire Vsync,
    output wire [6:0]  seg, output wire dp, output wire [3:0] an,
    output wire        RsTx
);
    wire clk_pix, clk_gpu, rst, de;
    clocking_xc7 u_clk (.clk100(clk), .rst_in(btnU), .speed(sw[15:14]), .clk_pix(clk_pix), .clk_gpu(clk_gpu), .rst(rst));
    ps_fpga_top #(.NUM_SMS(1), .NUM_WARPS(8), .WARP_SIZE(4), .NUM_REGS(16), .SMEM_WORDS(256), .SMEM_BANKS(4), .IMEM_AW(8)) u_top (
        .clk_gpu(clk_gpu), .clk_pix(clk_pix), .rst(rst), .btn_start(btnC), .sel(sw[1:0]),
        .vga_r(vgaRed), .vga_g(vgaGreen), .vga_b(vgaBlue), .vga_hs(Hsync), .vga_vs(Vsync), .vga_de(de),
        .led(led), .seg(seg), .an(an), .uart_tx(RsTx));
    assign dp = 1'b1;
endmodule
