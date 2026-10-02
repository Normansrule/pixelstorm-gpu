// =============================================================================
// ps_vga.v — 640x480 @ 60 Hz VGA scan-out of the Pixelstorm framebuffer
// -----------------------------------------------------------------------------
// Pixel clock 25 MHz (25.175 nominal; every monitor accepts 25.0). The
// framebuffer (FB_W x FB_H words of 0x00RRGGBB at FB_ADDR) is drawn SCALE times
// larger in the middle of the screen; a thin frame and a progress bar showing
// the GPU's state surround it. RGB444 output, as on Digilent boards.
// =============================================================================
module ps_vga #(
    parameter SCALE = 12,
    parameter FONT  = "fpga/gen/font8x8.hex",       // 64 glyphs (ASCII 32..95) x 8 rows, bit 0 = leftmost pixel
    parameter NAMES = "fpga/gen/prog_names.hex"     // 16 characters per kernel slot
)(
    input  wire        clk,               // 25 MHz pixel clock
    input  wire [31:0] fb_addr,
    input  wire [7:0]  fb_w,
    input  wire [7:0]  fb_h,
    input  wire        running,
    input  wire        done,
    input  wire [1:0]  kernel,
    input  wire [31:0] cycles,
    input  wire        name_we,          // uploaded kernel's name -> slot 3
    input  wire [3:0]  name_waddr,
    input  wire [7:0]  name_wdata,
    output reg  [31:0] maddr,             // to ps_bram_mem video port (1-cycle latency)
    input  wire [31:0] mdata,
    output reg  [3:0]  r, output reg [3:0] g, output reg [3:0] b,
    output reg         hs, output reg vs,
    output reg         de                 // for the simulation frame grabber
);
    // 640x480 timing: visible, front porch, sync, back porch
    localparam HV = 640, HF = 16, HS = 96, HB = 48, HT = 800;
    localparam VV = 480, VF = 10, VS = 2,  VB = 33, VT = 525;
    reg [9:0] x = 0, y = 0;
    always @(posedge clk) begin
        if (x == HT - 1) begin x <= 0; y <= (y == VT - 1) ? 10'd0 : y + 1'b1; end
        else x <= x + 1'b1;
    end
    wire [9:0] W = fb_w * SCALE, H = fb_h * SCALE;
    wire [9:0] x0 = (HV - W) / 2, y0 = (VV - H) / 2 - 16;
    wire in_fb = (x >= x0) && (x < x0 + W) && (y >= y0) && (y < y0 + H);
    wire [9:0] fx = (x - x0) / SCALE, fy = (y - y0) / SCALE;
    wire frame = !in_fb && (x >= x0 - 3) && (x < x0 + W + 3) && (y >= y0 - 3) && (y < y0 + H + 3);
    wire bar = (y >= y0 + H + 18) && (y < y0 + H + 26) && (x >= x0) && (x < x0 + W);

    // ---- status line: "<KERNEL NAME>      <cycles> CYCLES" at 2x scale under the bar ----
    reg [7:0] font  [0:511];
    reg [7:0] names [0:63];
    initial begin $readmemh(FONT, font); $readmemh(NAMES, names); end
    always @(posedge clk) if (name_we) names[48 + name_waddr] <= name_wdata;
    // cycles -> 10 decimal digits (double dabble, one bit per clock, restarts when the count changes)
    reg [31:0] bin = 0, last = 32'hFFFFFFFF; reg [39:0] bcd = 0, dec = 0; reg [5:0] bitn = 0;
    integer q;
    always @(posedge clk) begin
        if (cycles != last) begin last <= cycles; bin <= cycles; bcd <= 0; bitn <= 32; end
        else if (bitn != 0) begin : dd
            reg [39:0] t; t = bcd;
            for (q = 0; q < 10; q = q + 1) if (t[q*4 +: 4] >= 5) t[q*4 +: 4] = t[q*4 +: 4] + 4'd3;
            bcd <= {t[38:0], bin[31]}; bin <= {bin[30:0], 1'b0}; bitn <= bitn - 1'b1;
            if (bitn == 1) dec <= {t[38:0], bin[31]};
        end
    end
    localparam TY = 440, TX = 48;                        // text origin; 2x scale = 16 x 16 pixel cells
    wire [9:0] tcol = (x - TX) >> 4, trow = (y - TY) >> 1;
    wire       in_txt = (y >= TY) && (y < TY + 16) && (x >= TX) && (x < TX + 36 * 16);
    localparam [55:0] S_RUN = "RUNNING";
    localparam [87:0] S_PRESS = "PRESS START";
    localparam [55:0] S_CYC = " CYCLES";
    // columns: 0-15 kernel name, 18-28 status (right-aligned cycle count in 18-27), 29-35 " CYCLES"
    function [7:0] ch(input [5:0] c);
        reg [3:0] dg; reg lead;
        begin
            ch = " ";
            if (c < 16) ch = names[kernel * 16 + c];
            else if (c >= 18 && c <= 28) begin
                if (running) ch = (c <= 24) ? S_RUN[8*(24 - c) +: 8] : " ";
                else if (done) begin
                    if (c <= 27) begin
                        dg   = dec[(27 - c) * 4 +: 4];
                        lead = (dec >> ((28 - c) * 4)) == 0;      // blank leading zeros
                        ch   = (dg == 0 && lead && c != 27) ? " " : 8'h30 + dg;
                    end
                end else ch = S_PRESS[8*(28 - c) +: 8];
            end else if (c >= 29 && c <= 35 && done && !running) ch = S_CYC[8*(35 - c) +: 8];
        end
    endfunction
    wire [7:0] tc = ch(tcol[5:0]);
    wire [7:0] glyph = font[{tc[5:0] - 6'd32, trow[2:0]}];
    wire       txt_px = in_txt && glyph[(x - TX) >> 1 & 3'd7];

    // stage 1: address; stage 2: the block RAM reads it; stage 3: colour
    reg vis1, in1, frame1, bar1, hs1, vs1, txt1;
    reg vis2, in2, frame2, bar2, hs2, vs2, txt2;
    always @(posedge clk) begin
        maddr  <= fb_addr + fy * fb_w + fx;
        vis1   <= (x < HV) && (y < VV);
        in1 <= in_fb; frame1 <= frame; bar1 <= bar; txt1 <= txt_px;
        hs1 <= !((x >= HV + HF) && (x < HV + HF + HS));
        vs1 <= !((y >= VV + VF) && (y < VV + VF + VS));
        vis2 <= vis1; in2 <= in1; frame2 <= frame1; bar2 <= bar1; hs2 <= hs1; vs2 <= vs1; txt2 <= txt1;
        hs <= hs2; vs <= vs2; de <= vis2;
        if (!vis2)       begin r <= 0; g <= 0; b <= 0; end
        else if (in2)    begin r <= mdata[23:20]; g <= mdata[15:12]; b <= mdata[7:4]; end
        else if (frame2) begin r <= 4'h3; g <= 4'h8; b <= 4'hF; end                  // blue frame
        else if (txt2)   begin r <= 4'hE; g <= 4'hE; b <= 4'hF; end                  // status text
        else if (bar2)   begin r <= done ? 4'h2 : 4'hF; g <= done ? 4'hD : 4'hB; b <= done ? 4'hA : 4'h3; end  // green when done, amber while running
        else             begin r <= 4'h0; g <= 4'h1; b <= 4'h2; end                  // dark background
    end
endmodule
