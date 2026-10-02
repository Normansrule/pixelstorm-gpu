// =============================================================================
// ps_fpga_top.v — Pixelstorm on an FPGA board (board-independent part)
// -----------------------------------------------------------------------------
//   clk_gpu   GPU, loader and global memory port A (the board may gate it for
//             slow motion)
//   clk_pix   25 MHz: VGA, 7-segment, UART
// Press START: the loader clears the framebuffer, loads the kernel chosen by
// SEL, launches it, and the VGA output shows the image painting in. When the
// kernel finishes, the 7-segment display shows the cycle count in hex, LED 14
// lights and the UART prints "PIXELSTORM k=<n> cycles=<hex>".
// =============================================================================
module ps_fpga_top #(
    parameter NUM_SMS    = 1,
    parameter NUM_WARPS  = 4,
    parameter WARP_SIZE  = 8,
    parameter NUM_REGS   = 16,
    parameter SMEM_WORDS = 256,
    parameter SMEM_BANKS = 8,
    parameter IMEM_AW    = 8,
    parameter CACHE_LINES = 0,
    parameter GMEM_WORDS = 8192,
    parameter MEM_LAT    = 4,
    parameter UART_DIV   = 217,           // 25 MHz / 115200
    parameter PROG = "fpga/gen/prog_imem.hex", parameter CONS = "fpga/gen/prog_cmem.hex", parameter INFO = "fpga/gen/prog_info.hex",
    parameter FONT = "fpga/gen/font8x8.hex", parameter NAMES = "fpga/gen/prog_names.hex"
)(
    input  wire        clk_gpu,
    input  wire        clk_pix,
    input  wire        rst,
    input  wire        btn_start,
    input  wire [1:0]  sel,
    output wire [3:0]  vga_r, output wire [3:0] vga_g, output wire [3:0] vga_b,
    output wire        vga_hs, output wire vga_vs, output wire vga_de,
    output wire [15:0] led,
    output reg  [6:0]  seg, output reg [3:0] an,
    output wire        uart_tx
);
    localparam LW = 4;
    // ---------------------------------------------------------------- GPU
    wire imem_we, cmem_we, host_we, launch, done, running;
    wire [IMEM_AW-1:0] imem_addr; wire [3:0] cmem_addr; wire [31:0] imem_wdata, cmem_wdata, host_addr, host_wdata;
    wire [15:0] grid_dim, block_dim; wire [31:0] cycle;
    wire m_req_valid; wire [1:0] m_req_op; wire [31:0] m_req_addr; wire [LW-1:0] m_req_wmask; wire [LW*32-1:0] m_req_wdata;
    wire m_resp_valid; wire [LW*32-1:0] m_resp_rdata;
    ps_gpu_top #(.NUM_SMS(NUM_SMS), .NUM_WARPS(NUM_WARPS), .WARP_SIZE(WARP_SIZE), .NUM_REGS(NUM_REGS), .LINE_WORDS(LW),
                 .SMEM_WORDS(SMEM_WORDS), .SMEM_BANKS(SMEM_BANKS), .IMEM_AW(IMEM_AW), .CONST_AW(4), .CACHE_LINES(CACHE_LINES)) u_gpu (
        .clk(clk_gpu), .rst(rst),
        .host_imem_we(imem_we), .host_imem_addr(imem_addr), .host_imem_wdata(imem_wdata),
        .host_cmem_we(cmem_we), .host_cmem_addr(cmem_addr), .host_cmem_wdata(cmem_wdata),
        .launch(launch), .grid_dim(grid_dim), .block_dim(block_dim),
        .done(done), .running(running), .cycle(cycle),
        .mem_req_valid(m_req_valid), .mem_req_op(m_req_op), .mem_req_addr(m_req_addr),
        .mem_req_wmask(m_req_wmask), .mem_req_wdata(m_req_wdata),
        .mem_resp_valid(m_resp_valid), .mem_resp_rdata(m_resp_rdata));

    // ---------------------------------------------------------------- start button: synchronize + edge
    reg [2:0] bs; always @(posedge clk_gpu) bs <= {bs[1:0], btn_start};
    wire start = bs[1] & ~bs[2];

    wire [31:0] fb_addr; wire [7:0] fb_w, fb_h; wire [1:0] kernel; wire lbusy, finished;
    ps_loader #(.IMEM_AW(IMEM_AW), .PROG(PROG), .CONS(CONS), .INFO(INFO)) u_load (
        .clk(clk_gpu), .rst(rst), .start(start), .sel(sel),
        .imem_we(imem_we), .imem_addr(imem_addr), .imem_wdata(imem_wdata),
        .cmem_we(cmem_we), .cmem_addr(cmem_addr), .cmem_wdata(cmem_wdata),
        .mem_we(host_we), .mem_addr(host_addr), .mem_wdata(host_wdata),
        .launch(launch), .grid_dim(grid_dim), .block_dim(block_dim),
        .fb_addr(fb_addr), .fb_w(fb_w), .fb_h(fb_h), .kernel(kernel),
        .gpu_done(done), .busy(lbusy), .finished(finished));

    // ---------------------------------------------------------------- memory + video
    wire [31:0] vaddr, vdata;
    ps_bram_mem #(.WORDS(GMEM_WORDS), .LINE_WORDS(LW), .LAT(MEM_LAT)) u_mem (
        .clk(clk_gpu), .rst(rst),
        .req_valid(m_req_valid), .req_op(m_req_op), .req_addr(m_req_addr), .req_wmask(m_req_wmask), .req_wdata(m_req_wdata),
        .resp_valid(m_resp_valid), .resp_rdata(m_resp_rdata),
        .host_we(host_we), .host_addr(host_addr), .host_wdata(host_wdata),
        .vclk(clk_pix), .vaddr(vaddr), .vdata(vdata));

    // status into the pixel-clock domain (slow-changing signals, two-flop synchronizers)
    reg [1:0] s_run, s_fin; reg [31:0] cyc_q;
    always @(posedge clk_pix) begin s_run <= {s_run[0], lbusy}; s_fin <= {s_fin[0], finished}; end
    always @(posedge clk_gpu) if (running) cyc_q <= cycle;
    ps_vga #(.FONT(FONT), .NAMES(NAMES)) u_vga (.clk(clk_pix), .fb_addr(fb_addr), .fb_w(fb_w), .fb_h(fb_h), .running(s_run[1]), .done(s_fin[1]),
                  .kernel(kernel), .cycles(s_fin[1] ? cyc_q : 32'd0),
                  .maddr(vaddr), .mdata(vdata), .r(vga_r), .g(vga_g), .b(vga_b), .hs(vga_hs), .vs(vga_vs), .de(vga_de));

    // ---------------------------------------------------------------- LEDs, 7-segment (cycle count, hex)
    reg [23:0] tick; always @(posedge clk_pix) tick <= tick + 1'b1;
    assign led = {s_run[1], s_fin[1], kernel, 4'b0, running ? tick[23:16] : 8'h00};
    wire [15:0] shown = cyc_q[15:0];
    wire [1:0]  dig = tick[16:15];
    wire [3:0]  nib = shown[dig*4 +: 4];
    always @(posedge clk_pix) begin
        an <= ~(4'b0001 << dig);                              // active-low anodes
        case (nib)                                            // active-low segments g..a
            4'h0: seg <= 7'b1000000; 4'h1: seg <= 7'b1111001; 4'h2: seg <= 7'b0100100; 4'h3: seg <= 7'b0110000;
            4'h4: seg <= 7'b0011001; 4'h5: seg <= 7'b0010010; 4'h6: seg <= 7'b0000010; 4'h7: seg <= 7'b1111000;
            4'h8: seg <= 7'b0000000; 4'h9: seg <= 7'b0010000; 4'hA: seg <= 7'b0001000; 4'hB: seg <= 7'b0000011;
            4'hC: seg <= 7'b1000110; 4'hD: seg <= 7'b0100001; 4'hE: seg <= 7'b0000110; default: seg <= 7'b0001110;
        endcase
    end

    // ---------------------------------------------------------------- UART: "PIXELSTORM k=<n> cycles=<8 hex>\r\n"
    reg [5:0] ci; reg sending; reg ustart; reg [7:0] uch; wire ubusy;
    ps_uart_tx #(.DIV(UART_DIV)) u_tx (.clk(clk_pix), .rst(rst), .start(ustart), .data(uch), .tx(uart_tx), .busy(ubusy));
    function [7:0] hexc(input [3:0] v); hexc = v < 10 ? 8'h30 + v : 8'h37 + v; endfunction
    function [7:0] msg(input [5:0] k);
        case (k)
            0: msg = "P"; 1: msg = "I"; 2: msg = "X"; 3: msg = "E"; 4: msg = "L"; 5: msg = "S"; 6: msg = "T"; 7: msg = "O"; 8: msg = "R"; 9: msg = "M";
            10: msg = " "; 11: msg = "k"; 12: msg = "="; 13: msg = 8'h30 + kernel; 14: msg = " ";
            15: msg = "c"; 16: msg = "y"; 17: msg = "c"; 18: msg = "l"; 19: msg = "e"; 20: msg = "s"; 21: msg = "=";
            22: msg = hexc(cyc_q[31:28]); 23: msg = hexc(cyc_q[27:24]); 24: msg = hexc(cyc_q[23:20]); 25: msg = hexc(cyc_q[19:16]);
            26: msg = hexc(cyc_q[15:12]); 27: msg = hexc(cyc_q[11:8]); 28: msg = hexc(cyc_q[7:4]); 29: msg = hexc(cyc_q[3:0]);
            30: msg = 8'h0D; default: msg = 8'h0A;
        endcase
    endfunction
    reg fin_d;
    always @(posedge clk_pix) begin
        ustart <= 0; fin_d <= s_fin[1];
        if (rst) begin sending <= 0; ci <= 0; end
        else if (s_fin[1] && !fin_d) begin sending <= 1; ci <= 0; end
        else if (sending && !ubusy && !ustart) begin
            uch <= msg(ci); ustart <= 1;
            if (ci == 31) sending <= 0; else ci <= ci + 1'b1;
        end
    end
endmodule
