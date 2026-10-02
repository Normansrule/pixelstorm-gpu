// ps_bin2bcd.v — 32-bit binary to 10 decimal digits (double dabble, one bit per clock).
// Restarts whenever the input changes; 'dec' holds the last finished conversion.
module ps_bin2bcd (input wire clk, input wire [31:0] bin_in, output reg [39:0] dec = 0);
    reg [31:0] bin = 0, last = 32'hFFFFFFFF; reg [39:0] bcd = 0; reg [5:0] n = 0; integer q;
    always @(posedge clk) begin
        if (bin_in != last) begin last <= bin_in; bin <= bin_in; bcd <= 0; n <= 32; end
        else if (n != 0) begin : step
            reg [39:0] t; t = bcd;
            for (q = 0; q < 10; q = q + 1) if (t[q*4 +: 4] >= 5) t[q*4 +: 4] = t[q*4 +: 4] + 4'd3;
            bcd <= {t[38:0], bin[31]}; bin <= {bin[30:0], 1'b0}; n <= n - 1'b1;
            if (n == 1) dec <= {t[38:0], bin[31]};
        end
    end
endmodule
