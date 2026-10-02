// ps_uart_rx.v — 8N1 serial receiver (115200 baud from a 25 MHz clock by default).
// Synchronizes the line, finds the start bit, samples every bit in its middle,
// and only accepts a byte whose stop bit is high.
module ps_uart_rx #(parameter DIV = 217)(
    input  wire       clk, input wire rst, input wire rx,
    output reg        valid, output reg [7:0] data
);
    reg [2:0] s = 3'b111; always @(posedge clk) s <= {s[1:0], rx};
    wire line = s[2];
    reg [15:0] c = 0; reg [3:0] n = 0; reg busy = 0; reg [7:0] sh = 0;
    always @(posedge clk) begin
        valid <= 1'b0;
        if (rst) busy <= 1'b0;
        else if (!busy) begin
            if (!line) begin busy <= 1'b1; c <= DIV / 2; n <= 0; end          // falling edge: start bit
        end else if (c == 0) begin
            c <= DIV - 1;
            if (n == 0) begin if (line) busy <= 1'b0; n <= 1; end             // middle of the start bit: still low?
            else if (n <= 8) begin sh <= {line, sh[7:1]}; n <= n + 1'b1; end  // data bits, LSB first
            else begin busy <= 1'b0; if (line) begin valid <= 1'b1; data <= sh; end end   // stop bit
        end else c <= c - 1'b1;
    end
endmodule
