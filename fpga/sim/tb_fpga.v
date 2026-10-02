// =============================================================================
// fpga/sim/tb_fpga.v — the whole FPGA design, as it would run on the board
// -----------------------------------------------------------------------------
// Presses START with SEL = +sel=<n>, waits for the kernel to finish, then grabs
// one complete 640x480 VGA frame from the video pins into a PPM image: exactly
// what a monitor plugged into the board would show. fpga/sim/check.js then
// compares every framebuffer pixel on that screen with the golden model.
//   vvp tb_fpga.vvp +sel=2 +ppm=frame.ppm
// =============================================================================
`timescale 1ns/1ps
module tb_fpga;
    parameter NW = 4, WS = 8, SB = 8;                    // GPU shape: -Ptb_fpga.NW=16 -Ptb_fpga.WS=2 -Ptb_fpga.SB=2 for the Tang Nano build
    reg clk = 0; always #20 clk = ~clk;                 // 25 MHz for both GPU and pixels
    reg rst = 1, btn = 0; reg [1:0] sel = 0;
    wire [3:0] r, g, b; wire hs, vs, de; wire [15:0] led; wire [6:0] seg; wire [3:0] an; wire tx;
    ps_fpga_top #(.NUM_WARPS(NW), .WARP_SIZE(WS), .SMEM_BANKS(SB), .PROG("fpga/gen/prog_imem.hex"), .CONS("fpga/gen/prog_cmem.hex"), .INFO("fpga/gen/prog_info.hex"),
                  .FONT("fpga/gen/font8x8.hex"), .NAMES("fpga/gen/prog_names.hex")) dut (
        .clk_gpu(clk), .clk_pix(clk), .rst(rst), .btn_start(btn), .sel(sel),
        .vga_r(r), .vga_g(g), .vga_b(b), .vga_hs(hs), .vga_vs(vs), .vga_de(de), .led(led), .seg(seg), .an(an), .uart_tx(tx));
    integer f, n, k; reg [1023:0] ppm; integer s;
    // UART receiver: print what the board would send to the PC
    integer bitc; reg [7:0] ch; integer cyc_uart;
    initial forever begin
        @(negedge tx); #(8680/2);                         // 115200 baud = 8.68 us per bit
        for (bitc = 0; bitc < 8; bitc = bitc + 1) begin #8680; ch[bitc] = tx; end
        #8680; if (ch != 8'h0A) $write("%c", ch); else $write("\n");
    end
    initial begin
        if (!$value$plusargs("sel=%d", s)) s = 2; sel = s;
        if (!$value$plusargs("ppm=%s", ppm)) ppm = "frame.ppm";
        repeat (10) @(posedge clk); rst = 0; repeat (10) @(posedge clk);
        btn = 1; repeat (4) @(posedge clk); btn = 0;
        wait (led[14] == 1'b1);                           // kernel finished
        $display("[tb_fpga] kernel %0d finished after %0d GPU cycles", s, dut.cyc_q);
        @(negedge vs); @(posedge vs);                     // start of a fresh frame
        f = $fopen(ppm, "w"); $fwrite(f, "P3\n640 480\n15\n"); n = 0;
        while (n < 640 * 480) begin @(posedge clk); if (de) begin $fwrite(f, "%0d %0d %0d\n", r, g, b); n = n + 1; end end
        $fclose(f); $display("[tb_fpga] wrote %0s", ppm);
        repeat (400000) @(posedge clk);                    // let the UART line finish
        $finish;
    end
endmodule
