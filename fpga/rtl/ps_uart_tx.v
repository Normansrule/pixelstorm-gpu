// ps_uart_tx.v — 8N1 serial transmitter (115200 baud from a 25 MHz clock by default)
// Frame: start bit, 8 data bits LSB first, stop bit, plus one extra idle bit so the
// stop bit always lasts a full bit time before the next start bit.
module ps_uart_tx #(parameter DIV = 217)(
    input  wire clk, input wire rst,
    input  wire       start, input wire [7:0] data,
    output reg        tx = 1'b1, output wire busy
);
    reg [10:0] sh; reg [3:0] n = 0; reg [15:0] c = 0;
    assign busy = (n != 0);
    always @(posedge clk) begin
        if (rst) begin n <= 0; tx <= 1'b1; end
        else if (!busy && start) begin sh <= {2'b11, data, 1'b0}; n <= 11; c <= 0; end
        else if (busy) begin
            if (c == 0) begin tx <= sh[0]; sh <= {1'b1, sh[10:1]}; n <= n - 1'b1; end
            c <= (c == DIV - 1) ? 16'd0 : c + 1'b1;
        end
    end
endmodule
