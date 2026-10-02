// fpga/sim/tb_tmds.v — TMDS encoder check: encode a full video frame's worth of
// pixels and blanking, decode with the reference decoder, and require every
// pixel, every control token, and a bounded running disparity.
`timescale 1ns/1ps
module tb_tmds;
    reg clk = 0; always #5 clk = ~clk;
    reg [7:0] d = 0; reg [1:0] c = 0; reg de = 0;
    wire [9:0] q;
    ps_tmds_enc dut (.clk(clk), .d(d), .c(c), .de(de), .q(q));
    // reference decoder (DVI 1.0, section 3.3)
    function [9:0] dec(input [9:0] w);            // {is_ctrl, c[1:0], d[7:0]} packed as [10:0] would overflow; use two outputs
        reg [7:0] t; integer k;
        begin
            t = w[9] ? ~w[7:0] : w[7:0];
            dec[0] = t[0];
            for (k = 1; k < 8; k = k + 1) dec[k] = w[8] ? (t[k] ^ t[k-1]) : ~(t[k] ^ t[k-1]);
            dec[9:8] = 2'b00;
        end
    endfunction
    integer n, errs = 0, disp = 0, maxdisp = 0, ones, k; reg [7:0] exp_d; reg exp_de; reg [1:0] exp_c; reg [9:0] w, dw;
    initial begin
        for (n = 0; n < 800 * 30; n = n + 1) begin
            // a mix of real-looking data: ramps, noise, flat colours, and blanking with syncs
            de = (n % 800) < 640;
            d  = (n % 7 == 0) ? $random : (n % 3 == 0) ? 8'h00 : (n % 5 == 0) ? 8'hFF : n[7:0];
            c  = {(n / 800) % 5 == 0, (n % 800) >= 656 && (n % 800) < 752};
            exp_d = d; exp_de = de; exp_c = c;
            @(posedge clk); #1; w = q;
            if (exp_de) begin
                dw = dec(w);
                if (dw[7:0] !== exp_d) begin if (errs < 5) $display("pixel %0d: sent %02x decoded %02x", n, exp_d, dw[7:0]); errs = errs + 1; end
                ones = 0; for (k = 0; k < 10; k = k + 1) ones = ones + w[k];
                disp = disp + ones - (10 - ones);
                if (disp > maxdisp) maxdisp = disp; if (-disp > maxdisp) maxdisp = -disp;
            end else begin
                disp = 0;
                if (w !== (exp_c == 0 ? 10'b1101010100 : exp_c == 1 ? 10'b0010101011 : exp_c == 2 ? 10'b0101010100 : 10'b1010101011)) begin
                    if (errs < 5) $display("blank %0d: wrong control token", n); errs = errs + 1; end
            end
        end
        if (errs == 0 && maxdisp <= 20) $display("PASS: %0d TMDS symbols decode exactly; running disparity stays within +/-%0d", 800 * 30, maxdisp);
        else $display("FAIL: %0d errors, max disparity %0d", errs, maxdisp);
        $finish;
    end
endmodule
