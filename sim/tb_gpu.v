// =============================================================================
// tb_gpu.v — testbench = "the host CPU + driver + DRAM"
// -----------------------------------------------------------------------------
// Plusargs (tools/pixelstorm.js rtl passes these for you):
//   +imem=<hex>  program words        +cmem=<hex>  kernel parameters c[0..15]
//   +gmem=<hex>  initial global memory +out=<hex>  final global memory dump
//   +grid=<n> +block=<n>              launch configuration <<<grid, block>>>
//   +lat=<n>     DRAM latency in cycles (default 8)
//   +trace       print JSON events for the web visualizer
//   +vcd=<file>  dump waveforms for GTKWave
//   +maxcyc=<n>  watchdog
// =============================================================================
`timescale 1ns/1ps

module tb_gpu;
    parameter NUM_SMS    = 2;
    parameter NUM_WARPS  = 4;
    parameter WARP_SIZE  = 8;
    parameter LINE_WORDS = 4;
    parameter IMEM_AW    = 10;
    parameter CONST_AW   = 4;
    parameter GMEM_WORDS = 65536;

    reg clk = 1'b0;
    always #5 clk = ~clk;

    reg                     rst = 1'b1;
    reg                     host_imem_we = 1'b0;
    reg  [IMEM_AW-1:0]      host_imem_addr = 0;
    reg  [31:0]             host_imem_wdata = 0;
    reg                     host_cmem_we = 1'b0;
    reg  [CONST_AW-1:0]     host_cmem_addr = 0;
    reg  [31:0]             host_cmem_wdata = 0;
    reg                     launch = 1'b0;
    reg  [15:0]             grid_dim = 16'd1, block_dim = 16'd8;
    wire                    done, running;
    wire [31:0]             cycle;

    wire                     mem_req_valid;
    wire [1:0]               mem_req_op;
    wire [31:0]              mem_req_addr;
    wire [LINE_WORDS-1:0]    mem_req_wmask;
    wire [LINE_WORDS*32-1:0] mem_req_wdata;
    reg                      mem_resp_valid = 1'b0;
    reg  [LINE_WORDS*32-1:0] mem_resp_rdata = 0;

    ps_gpu_top #(
        .NUM_SMS(NUM_SMS), .NUM_WARPS(NUM_WARPS), .WARP_SIZE(WARP_SIZE),
        .LINE_WORDS(LINE_WORDS), .IMEM_AW(IMEM_AW), .CONST_AW(CONST_AW)
    ) dut (
        .clk(clk), .rst(rst),
        .host_imem_we(host_imem_we), .host_imem_addr(host_imem_addr), .host_imem_wdata(host_imem_wdata),
        .host_cmem_we(host_cmem_we), .host_cmem_addr(host_cmem_addr), .host_cmem_wdata(host_cmem_wdata),
        .launch(launch), .grid_dim(grid_dim), .block_dim(block_dim),
        .done(done), .running(running), .cycle(cycle),
        .mem_req_valid(mem_req_valid), .mem_req_op(mem_req_op), .mem_req_addr(mem_req_addr),
        .mem_req_wmask(mem_req_wmask), .mem_req_wdata(mem_req_wdata),
        .mem_resp_valid(mem_resp_valid), .mem_resp_rdata(mem_resp_rdata)
    );

    // -------------------------------------------------------------------------
    // Global memory = DRAM model with fixed latency
    // -------------------------------------------------------------------------
    reg [31:0] gmem [0:GMEM_WORDS-1];
    reg [31:0] prog [0:(1<<IMEM_AW)-1];
    reg [31:0] cons [0:(1<<CONST_AW)-1];

    integer lat = 8;
    integer cnt = 0;
    reg     pend = 1'b0;
    reg [1:0]               p_op;
    reg [31:0]              p_addr;
    reg [LINE_WORDS-1:0]    p_wmask;
    reg [LINE_WORDS*32-1:0] p_wdata;
    reg                     trace_on;
    integer w;
    reg [31:0] old;

    always @(posedge clk) begin
        mem_resp_valid <= 1'b0;
        if (mem_req_valid) begin
            pend    <= 1'b1;
            cnt     <= lat;
            p_op    <= mem_req_op;
            p_addr  <= mem_req_addr;
            p_wmask <= mem_req_wmask;
            p_wdata <= mem_req_wdata;
        end else if (pend) begin
            if (cnt <= 1) begin
                pend           <= 1'b0;
                mem_resp_valid <= 1'b1;
                case (p_op)
                    2'd0: for (w = 0; w < LINE_WORDS; w = w + 1)
                              mem_resp_rdata[w*32 +: 32] <= gmem[(p_addr + w) % GMEM_WORDS];
                    2'd1: for (w = 0; w < LINE_WORDS; w = w + 1)
                              if (p_wmask[w]) begin
                                  gmem[(p_addr + w) % GMEM_WORDS] <= p_wdata[w*32 +: 32];
                                  if (trace_on) $display("{\"ev\":\"gw\",\"t\":%0d,\"a\":%0d,\"v\":%0d}",
                                                         cycle, (p_addr + w) % GMEM_WORDS, p_wdata[w*32 +: 32]);
                              end
                    default: begin
                        old = gmem[p_addr % GMEM_WORDS];
                        mem_resp_rdata <= {{(LINE_WORDS-1)*32{1'b0}}, old};
                        gmem[p_addr % GMEM_WORDS] <= old + p_wdata[31:0];
                        if (trace_on) $display("{\"ev\":\"gw\",\"t\":%0d,\"a\":%0d,\"v\":%0d}",
                                               cycle, p_addr % GMEM_WORDS, old + p_wdata[31:0]);
                    end
                endcase
            end else begin
                cnt <= cnt - 1;
            end
        end
    end

    // -------------------------------------------------------------------------
    // Host driver
    // -------------------------------------------------------------------------
    reg [1023:0] f_imem, f_cmem, f_gmem, f_out, f_vcd;
    integer i, maxcyc, gv, bv;

    initial begin
        trace_on = $test$plusargs("trace");
        for (i = 0; i < GMEM_WORDS; i = i + 1) gmem[i] = 32'd0;
        for (i = 0; i < (1<<IMEM_AW); i = i + 1) prog[i] = 32'd0;
        for (i = 0; i < (1<<CONST_AW); i = i + 1) cons[i] = 32'd0;

        if ($value$plusargs("imem=%s", f_imem)) $readmemh(f_imem, prog);
        if ($value$plusargs("cmem=%s", f_cmem)) $readmemh(f_cmem, cons);
        if ($value$plusargs("gmem=%s", f_gmem)) $readmemh(f_gmem, gmem);
        if (!$value$plusargs("lat=%d", lat)) lat = 8;
        if (!$value$plusargs("maxcyc=%d", maxcyc)) maxcyc = 2000000;
        if ($value$plusargs("grid=%d", gv))  grid_dim  = gv;
        if ($value$plusargs("block=%d", bv)) block_dim = bv;
        if ($value$plusargs("vcd=%s", f_vcd)) begin
            $dumpfile(f_vcd);
            $dumpvars(0, tb_gpu);
        end

        repeat (3) @(posedge clk);
        rst <= 1'b0;

        // upload the kernel binary and its parameters (what cudaMemcpy + the
        // driver do for you on a real system)
        for (i = 0; i < (1<<IMEM_AW); i = i + 1) begin
            @(posedge clk);
            host_imem_we <= 1'b1; host_imem_addr <= i; host_imem_wdata <= prog[i];
        end
        for (i = 0; i < (1<<CONST_AW); i = i + 1) begin
            @(posedge clk);
            host_imem_we <= 1'b0;
            host_cmem_we <= 1'b1; host_cmem_addr <= i; host_cmem_wdata <= cons[i];
        end
        @(posedge clk);
        host_cmem_we <= 1'b0;

        // kernel<<<grid, block>>>(params...)
        @(posedge clk);
        launch <= 1'b1;
        @(posedge clk);
        launch <= 1'b0;
        @(posedge clk);

        while (!done && cycle < maxcyc) @(posedge clk);

        if (!done) begin
            $display("{\"ev\":\"timeout\",\"t\":%0d}", cycle);
        end
        $display("{\"ev\":\"done\",\"t\":%0d,\"ok\":%0d}", cycle, done);
        if ($value$plusargs("out=%s", f_out)) $writememh(f_out, gmem);
        $finish;
    end
endmodule
