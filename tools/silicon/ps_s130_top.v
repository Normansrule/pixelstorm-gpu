// ps_s130_top — the Pixelstorm tapeout configuration for SkyWater 130 nm.
// Same RTL as the simulated GPU with smaller memories, so the design fits a
// realistic die when every storage bit is a flip-flop (no SRAM macros).
module ps_s130_top (
    input  wire         clk,
    input  wire         rst,
    input  wire         host_imem_we,
    input  wire [5:0]   host_imem_addr,
    input  wire [31:0]  host_imem_wdata,
    input  wire         host_cmem_we,
    input  wire [3:0]   host_cmem_addr,
    input  wire [31:0]  host_cmem_wdata,
    input  wire         launch,
    input  wire [15:0]  grid_dim,
    input  wire [15:0]  block_dim,
    output wire         done,
    output wire         running,
    output wire [31:0]  cycle,
    output wire         mem_req_valid,
    output wire [1:0]   mem_req_op,
    output wire [31:0]  mem_req_addr,
    output wire [3:0]   mem_req_wmask,
    output wire [127:0] mem_req_wdata,
    input  wire         mem_resp_valid,
    input  wire [127:0] mem_resp_rdata
);
    ps_gpu_top #(
        .NUM_SMS(2), .NUM_WARPS(2), .WARP_SIZE(4), .NUM_REGS(8), .LINE_WORDS(4),
        .SMEM_WORDS(32), .SMEM_BANKS(4), .IMEM_AW(6), .CONST_AW(4)
    ) u_gpu (
        .clk(clk), .rst(rst),
        .host_imem_we(host_imem_we), .host_imem_addr(host_imem_addr), .host_imem_wdata(host_imem_wdata),
        .host_cmem_we(host_cmem_we), .host_cmem_addr(host_cmem_addr), .host_cmem_wdata(host_cmem_wdata),
        .launch(launch), .grid_dim(grid_dim), .block_dim(block_dim),
        .done(done), .running(running), .cycle(cycle),
        .mem_req_valid(mem_req_valid), .mem_req_op(mem_req_op), .mem_req_addr(mem_req_addr),
        .mem_req_wmask(mem_req_wmask), .mem_req_wdata(mem_req_wdata),
        .mem_resp_valid(mem_resp_valid), .mem_resp_rdata(mem_resp_rdata)
    );
endmodule
