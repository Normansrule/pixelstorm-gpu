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
    reg rst = 1, btn = 0; reg [1:0] sel = 0; reg anim = 0; reg [10:0] arg = 0; integer nframes = 0, runs = 0;
    wire [3:0] r, g, b; wire hs, vs, de; wire [15:0] led; wire [6:0] seg; wire [3:0] an; wire tx; reg rxl = 1'b1;
    ps_fpga_top #(.NUM_WARPS(NW), .WARP_SIZE(WS), .SMEM_BANKS(SB), .PROG("fpga/gen/prog_imem.hex"), .CONS("fpga/gen/prog_cmem.hex"), .INFO("fpga/gen/prog_info.hex"),
                  .FONT("fpga/gen/font8x8.hex"), .NAMES("fpga/gen/prog_names.hex")) dut (
        .clk_gpu(clk), .clk_pix(clk), .rst(rst), .btn_start(btn), .sel(sel), .anim(anim), .arg(arg),
        .vga_r(r), .vga_g(g), .vga_b(b), .vga_hs(hs), .vga_vs(vs), .vga_de(de), .led(led), .seg(seg), .an(an), .uart_tx(tx), .uart_rx(rxl));
    integer f, n, k; reg [1023:0] ppm, upf; integer s; reg [7:0] ubytes [0:4095]; integer ulen, ui, bi;
    // UART receiver: print what the board would send to the PC
    integer bitc; reg [7:0] ch; integer cyc_uart;
    initial forever begin
        @(negedge tx); #(8680/2);                         // 115200 baud = 8.68 us per bit
        for (bitc = 0; bitc < 8; bitc = bitc + 1) begin #8680; ch[bitc] = tx; end
        #8680; if (ch != 8'h0A) $write("%c", ch); else $write("\n");
    end
    reg err_seen = 0; always @(posedge clk) if (dut.u_err) err_seen <= 1'b1;
    initial begin
        if (!$value$plusargs("sel=%d", s)) s = 2; sel = s;
        if (!$value$plusargs("ppm=%s", ppm)) ppm = "frame.ppm";
        if ($value$plusargs("anim=%d", nframes)) anim = 1;              // animation: run nframes frames, then stop
        if (!$value$plusargs("arg=%d", ui)) ui = 0; arg = ui;
        repeat (10) @(posedge clk); rst = 0; repeat (10) @(posedge clk);
        if ($value$plusargs("upload=%s", upf)) begin                 // send a kernel over the UART instead of pressing start
            $readmemh(upf, ubytes); ulen = 0; while (ulen < 4096 && ubytes[ulen] !== 8'bx) ulen = ulen + 1;
            $display("[tb_fpga] uploading %0d bytes from %0s at 115200 baud", ulen, upf);
            if ($test$plusargs("corrupt")) ubytes[40] = ubytes[40] ^ 8'h01;   // one flipped bit in an instruction
            for (ui = 0; ui < ulen; ui = ui + 1) begin
                rxl = 0; #8680; for (bi = 0; bi < 8; bi = bi + 1) begin rxl = ubytes[ui][bi]; #8680; end rxl = 1; #8680;
            end
            if ($test$plusargs("corrupt")) begin
                repeat (200000) @(posedge clk);
                if (err_seen && !led[14] && !led[15]) $display("PASS: corrupted upload rejected (checksum error, nothing launched)");
                else $display("FAIL: corrupted upload was not rejected");
                $finish;
            end
        end else begin
            btn = 1; repeat (4) @(posedge clk); btn = 0;
        end
        if (anim) begin
            while (runs < nframes) begin @(posedge dut.done); runs = runs + 1; end
            anim = 0;                                      // the loader sees this before it would start frame nframes
            $display("[tb_fpga] animation: %0d frames, stopping", runs);
        end
        wait (led[14] == 1'b1);                           // kernel finished
        $display("[tb_fpga] kernel %0d finished after %0d GPU cycles", dut.kernel, dut.cyc_q);
        @(negedge vs); @(posedge vs);                     // start of a fresh frame
        f = $fopen(ppm, "w"); $fwrite(f, "P3\n640 480\n15\n"); n = 0;
        while (n < 640 * 480) begin @(posedge clk); if (de) begin $fwrite(f, "%0d %0d %0d\n", r, g, b); n = n + 1; end end
        $fclose(f); $display("[tb_fpga] wrote %0s", ppm);
        repeat (400000) @(posedge clk);                    // let the UART line finish
        $finish;
    end
endmodule
