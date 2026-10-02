// =============================================================================
// ps_bram_mem.v — Pixelstorm global memory in FPGA block RAM
// -----------------------------------------------------------------------------
// Speaks the same protocol as the DRAM model in sim/tb_gpu.v: one request
// (1-cycle pulse), a response LAT cycles later. Storage is LINE_WORDS banks so
// a whole 4-word line is read in one cycle. Each bank is written in the
// canonical block-RAM style (one write port, registered reads) so Vivado and
// Yosys map it to RAMB36/RAMB18:
//   port A  the GPU (read line, write masked line, atomic add) or the loader
//   port B  read-only video scan-out of the framebuffer, on the pixel clock
// =============================================================================
module ps_bram_mem #(
    parameter WORDS      = 8192,          // 32 KB of global memory
    parameter LINE_WORDS = 4,
    parameter LAT        = 4              // >= 2: cycles from request to response
)(
    input  wire                       clk,
    input  wire                       rst,
    input  wire                       req_valid,
    input  wire [1:0]                 req_op,          // 0 read line, 1 write line, 2 atomic add
    input  wire [31:0]                req_addr,
    input  wire [LINE_WORDS-1:0]      req_wmask,
    input  wire [LINE_WORDS*32-1:0]   req_wdata,
    output reg                        resp_valid,
    output reg  [LINE_WORDS*32-1:0]   resp_rdata,
    input  wire                       host_we,         // loader: clear or preload while the GPU is idle
    input  wire [31:0]                host_addr,
    input  wire [31:0]                host_wdata,
    input  wire                       vclk,
    input  wire [31:0]                vaddr,
    output wire [31:0]                vdata
);
    localparam OW = $clog2(LINE_WORDS);
    localparam IW = $clog2(WORDS / LINE_WORDS);

    reg                     pend;
    reg [7:0]               cnt;
    reg [1:0]               p_op;
    reg [31:0]              p_addr;
    reg [LINE_WORDS-1:0]    p_wmask;
    reg [LINE_WORDS*32-1:0] p_wdata;
    wire [IW-1:0]           p_idx  = p_addr[OW +: IW];
    wire [OW-1:0]           p_word = p_addr[OW-1:0];
    wire [LINE_WORDS*32-1:0] rd;                       // registered port-A read of the pending line
    wire                    fire = pend && (cnt <= 1);

    genvar g;
    generate for (g = 0; g < LINE_WORDS; g = g + 1) begin : b
        reg [31:0] mem [0:WORDS/LINE_WORDS-1];
        reg [31:0] qa, qb;
        // one write per cycle: loader, line write, or atomic result
        wire        we  = host_we ? (host_addr[OW-1:0] == g)
                        : fire && ((p_op == 2'd1 && p_wmask[g]) || (p_op == 2'd2 && p_word == g));
        wire [IW-1:0] wa = host_we ? host_addr[OW +: IW] : p_idx;
        wire [31:0] wd  = host_we ? host_wdata : (p_op == 2'd2 ? qa + p_wdata[31:0] : p_wdata[g*32 +: 32]);
        always @(posedge clk) begin
            if (we) mem[wa] <= wd;
            qa <= mem[p_idx];
        end
        always @(posedge vclk) qb <= mem[vaddr[OW +: IW]];
        assign rd[g*32 +: 32] = qa;
        integer j;
        initial for (j = 0; j < WORDS / LINE_WORDS; j = j + 1) mem[j] = 32'd0;
    end endgenerate

    reg [OW-1:0] vsel;
    always @(posedge vclk) vsel <= vaddr[OW-1:0];
    wire [LINE_WORDS*32-1:0] vqs;                      // every bank's video read, side by side
    generate for (g = 0; g < LINE_WORDS; g = g + 1) begin : v
        assign vqs[g*32 +: 32] = b[g].qb;
    end endgenerate
    assign vdata = vqs[vsel*32 +: 32];

    always @(posedge clk) begin
        resp_valid <= 1'b0;
        if (rst) pend <= 1'b0;
        else if (req_valid) begin
            pend <= 1'b1; cnt <= LAT; p_op <= req_op; p_addr <= req_addr; p_wmask <= req_wmask; p_wdata <= req_wdata;
        end else if (pend) begin
            if (cnt <= 1) begin
                pend <= 1'b0; resp_valid <= 1'b1;
                if (p_op == 2'd0) resp_rdata <= rd;
                else if (p_op == 2'd2) resp_rdata <= {{(LINE_WORDS-1)*32{1'b0}}, rd[p_word*32 +: 32]};
            end else cnt <= cnt - 1'b1;
        end
    end
endmodule
