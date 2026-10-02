// =============================================================================
// ps_loader.v — the "driver": loads a kernel from ROM into the GPU and launches it
// -----------------------------------------------------------------------------
// What cudaMemcpy + a kernel launch do on a PC, done in hardware:
//   1. clear the kernel's framebuffer in global memory
//   2. copy its instructions into instruction memory, its arguments into the
//      constant bank
//   3. pulse launch with the grid and block size, wait for done
// The ROM images are generated from kernels/*.psa by fpga/gen_programs.js.
// =============================================================================
module ps_loader #(
    parameter NK      = 4,               // kernel slots in the ROM
    parameter IMEM_AW = 8,
    parameter PROG    = "fpga/gen/prog_imem.hex",
    parameter CONS    = "fpga/gen/prog_cmem.hex",
    parameter INFO    = "fpga/gen/prog_info.hex"
)(
    input  wire                clk,
    input  wire                rst,
    input  wire                start,     // one-cycle pulse
    input  wire [1:0]          sel,
    output reg                 imem_we,
    output reg [IMEM_AW-1:0]   imem_addr,
    output reg [31:0]          imem_wdata,
    output reg                 cmem_we,
    output reg [3:0]           cmem_addr,
    output reg [31:0]          cmem_wdata,
    output reg                 mem_we,
    output reg [31:0]          mem_addr,
    output reg [31:0]          mem_wdata,
    output reg                 launch,
    output reg [15:0]          grid_dim,
    output reg [15:0]          block_dim,
    output reg [31:0]          fb_addr,
    output reg [7:0]           fb_w,
    output reg [7:0]           fb_h,
    output reg [1:0]           kernel,
    input  wire                gpu_done,
    input  wire                anim,      // re-launch forever, c[15] = frame number
    input  wire [10:0]         arg,       // live argument from the switches, c[14]
    // upload port (pixel clock): overwrites ROM slot 3 with a kernel received over the UART
    input  wire                wclk,
    input  wire                u_we_i, input wire u_we_c, input wire u_we_f,
    input  wire [IMEM_AW-1:0]  u_addr,
    input  wire [31:0]         u_data,
    output reg                 busy,
    output reg                 finished
);
    localparam N_I = (1 << IMEM_AW);
    reg [31:0] prog [0:NK*N_I-1];
    reg [31:0] cons [0:NK*16-1];
    reg [31:0] info [0:NK*4-1];          // grid, block, fb address, (fb_w << 8) | fb_h
    initial begin $readmemh(PROG, prog); $readmemh(CONS, cons); $readmemh(INFO, info); end
    always @(posedge wclk) begin
        if (u_we_i) prog[3 * N_I + u_addr] <= u_data;
        if (u_we_c) cons[3 * 16 + u_addr[3:0]] <= u_data;
        if (u_we_f) info[3 * 4 + u_addr[1:0]] <= u_data;
    end

    localparam IDLE = 0, CLEAR = 1, LOADI = 2, LOADC = 3, GO = 4, RUN = 5, NEXT = 6;
    reg [31:0] frame;
    reg [2:0]  st;
    reg [15:0] i;
    reg [15:0] npix;
    always @(posedge clk) begin
        imem_we <= 0; cmem_we <= 0; mem_we <= 0; launch <= 0;
        if (rst) begin st <= IDLE; busy <= 0; finished <= 0; kernel <= 0; fb_w <= 0; fb_h <= 0; fb_addr <= 0; frame <= 0; end
        else case (st)
            IDLE: if (start) begin
                kernel <= sel; busy <= 1; finished <= 0;
                grid_dim <= info[sel*4 + 0][15:0]; block_dim <= info[sel*4 + 1][15:0];
                fb_addr <= info[sel*4 + 2]; fb_w <= info[sel*4 + 3][15:8]; fb_h <= info[sel*4 + 3][7:0];
                npix <= info[sel*4 + 3][15:8] * info[sel*4 + 3][7:0];
                i <= 0; frame <= 0; st <= CLEAR;
            end
            CLEAR: begin                                   // blank the framebuffer so you watch it fill
                if (i < npix) begin mem_we <= 1; mem_addr <= fb_addr + i; mem_wdata <= 32'h000000; i <= i + 1; end
                else begin i <= 0; st <= LOADI; end
            end
            LOADI: begin
                imem_we <= 1; imem_addr <= i[IMEM_AW-1:0]; imem_wdata <= prog[kernel * N_I + i];
                if (i == N_I - 1) begin i <= 0; st <= LOADC; end else i <= i + 1;
            end
            LOADC: begin
                cmem_we <= 1; cmem_addr <= i[3:0];
                cmem_wdata <= (i == 14) ? {21'd0, arg} : (i == 15) ? frame : cons[kernel * 16 + i];
                if (i == 15) st <= GO; else i <= i + 1;
            end
            GO:  begin launch <= 1; i <= 0; st <= RUN; end
            RUN: if (gpu_done && !launch) begin
                if (anim) begin frame <= frame + 1; st <= NEXT; end           // next frame: only c[14], c[15] change
                else begin busy <= 0; finished <= 1; st <= IDLE; end
            end
            NEXT: begin
                cmem_we <= 1; cmem_addr <= i[0] ? 4'd15 : 4'd14; cmem_wdata <= i[0] ? frame : {21'd0, arg};
                if (i[0]) begin i <= 0; st <= GO; end else i <= 1;
            end
            default: st <= IDLE;
        endcase
    end
endmodule
