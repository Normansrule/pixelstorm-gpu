// =============================================================================
// Pixelstorm on the Sipeed Tang Nano 20K (Gowin GW2AR-LV18QN88C8/I7), ~$30
// -----------------------------------------------------------------------------
// The smallest build: 1 SM, 16 warps x 2 lanes (still 32-thread blocks, so all
// demo kernels run unchanged), 2 shared-memory banks.
//   S1 (pin 88)   start the selected kernel
//   S2 (pin 87)   next kernel: gradient, triangle, Mandelbrot, Mandelbrot zoom
//   HDMI          640x480 @ 60 Hz DVI: framebuffer painting live + status line
//   LED0..1       kernel   LED2 busy   LED3 done   LED5 heartbeat (active low)
//   UART (69)     "PIXELSTORM k=.. cycles=.." at 115200 8N1 on the USB serial port
// Clocks: 27 MHz crystal -> rPLL 126 MHz (x14/3) = TMDS bit clock (DDR, 5 bits
// per pixel clock) -> CLKDIV /5 = 25.2 MHz pixel and GPU clock.
// Pin numbers follow Sipeed's official examples (github.com/sipeed/TangNano-20K-example).
// =============================================================================
module pixelstorm_tangnano20k (
    input  wire       I_clk,           // 27 MHz
    input  wire       I_s1,            // start
    input  wire       I_s2,            // next kernel
    output wire [5:0] O_led,
    output wire       O_uart_tx,
    input  wire       I_uart_rx,
    output wire       O_tmds_clk_p, output wire O_tmds_clk_n,
    output wire [2:0] O_tmds_data_p, output wire [2:0] O_tmds_data_n
);
    // ---------------------------------------------------------------- clocks
    wire clk_ser, clk_pix, lock;
    rPLL #(
        .FCLKIN("27"), .DYN_IDIV_SEL("false"), .IDIV_SEL(2), .DYN_FBDIV_SEL("false"), .FBDIV_SEL(13),
        .DYN_ODIV_SEL("false"), .ODIV_SEL(8), .PSDA_SEL("0000"), .DYN_DA_EN("false"), .DUTYDA_SEL("1000"),
        .CLKOUT_FT_DIR(1'b1), .CLKOUTP_FT_DIR(1'b1), .CLKOUT_DLY_STEP(0), .CLKOUTP_DLY_STEP(0),
        .CLKFB_SEL("internal"), .CLKOUT_BYPASS("false"), .CLKOUTP_BYPASS("false"), .CLKOUTD_BYPASS("false"),
        .DYN_SDIV_SEL(2), .CLKOUTD_SRC("CLKOUT"), .CLKOUTD3_SRC("CLKOUT"), .DEVICE("GW2AR-18C")
    ) u_pll (
        .CLKOUT(clk_ser), .LOCK(lock), .CLKOUTP(), .CLKOUTD(), .CLKOUTD3(),
        .RESET(1'b0), .RESET_P(1'b0), .CLKIN(I_clk), .CLKFB(1'b0),
        .FBDSEL(6'b0), .IDSEL(6'b0), .ODSEL(6'b0), .PSDA(4'b0), .DUTYDA(4'b0), .FDLY(4'b0));
    CLKDIV #(.DIV_MODE("5")) u_div (.CLKOUT(clk_pix), .HCLKIN(clk_ser), .RESETN(lock), .CALIB(1'b0));

    reg [3:0] rs = 4'hF; always @(posedge clk_pix) rs <= {rs[2:0], ~lock};
    wire rst = rs[3];

    // ---------------------------------------------------------------- S2: next kernel (debounced)
    reg [17:0] dbc; reg s2q, s2d; reg [1:0] sel = 2'd2;          // start on the Mandelbrot set
    always @(posedge clk_pix) begin
        dbc <= dbc + 1'b1;
        if (dbc == 0) begin s2q <= I_s2; s2d <= s2q; if (s2q && !s2d) sel <= sel + 1'b1; end   // ~10 ms sampling
    end

    // ---------------------------------------------------------------- Pixelstorm
    wire [3:0] r, g, b; wire hs, vs, de; wire [15:0] led;
    ps_fpga_top #(.NUM_SMS(1), .NUM_WARPS(16), .WARP_SIZE(2), .NUM_REGS(16), .SMEM_WORDS(64), .SMEM_BANKS(2), .IMEM_AW(8),   // demo kernels use no shared memory: 64 words saves LUTs
                  .UART_DIV(219),
                  .PROG("fpga/gen/prog_imem.hex"), .CONS("fpga/gen/prog_cmem.hex"), .INFO("fpga/gen/prog_info.hex"),
                  .FONT("fpga/gen/font8x8.hex"), .NAMES("fpga/gen/prog_names.hex")) u_top (
        .clk_gpu(clk_pix), .clk_pix(clk_pix), .rst(rst), .btn_start(I_s1), .sel(sel), .anim(1'b0), .arg(11'd0),
        .vga_r(r), .vga_g(g), .vga_b(b), .vga_hs(hs), .vga_vs(vs), .vga_de(de),
        .led(led), .seg(), .an(), .uart_tx(O_uart_tx), .uart_rx(I_uart_rx));
    assign O_led = ~{led[5], 1'b0, led[14], led[15], sel};        // LEDs are active low

    // ---------------------------------------------------------------- DVI: TMDS encode, serialize, LVDS out
    wire [9:0] q0, q1, q2;
    ps_tmds_enc e0 (.clk(clk_pix), .d({b, b}), .c({vs, hs}),   .de(de), .q(q0));   // syncs travel at their line levels (negative polarity at 640x480)
    ps_tmds_enc e1 (.clk(clk_pix), .d({g, g}), .c(2'b00),      .de(de), .q(q1));
    ps_tmds_enc e2 (.clk(clk_pix), .d({r, r}), .c(2'b00),      .de(de), .q(q2));
    wire [9:0] lane [0:3];
    assign lane[0] = q0; assign lane[1] = q1; assign lane[2] = q2; assign lane[3] = 10'b1111100000;   // lane 3 = TMDS clock
    wire [3:0] ser;
    genvar k;
    generate for (k = 0; k < 4; k = k + 1) begin : tx
        OSER10 u_ser (.Q(ser[k]), .D0(lane[k][0]), .D1(lane[k][1]), .D2(lane[k][2]), .D3(lane[k][3]), .D4(lane[k][4]),
                      .D5(lane[k][5]), .D6(lane[k][6]), .D7(lane[k][7]), .D8(lane[k][8]), .D9(lane[k][9]),
                      .PCLK(clk_pix), .FCLK(clk_ser), .RESET(rst));
    end endgenerate
    ELVDS_OBUF u_d0 (.I(ser[0]), .O(O_tmds_data_p[0]), .OB(O_tmds_data_n[0]));
    ELVDS_OBUF u_d1 (.I(ser[1]), .O(O_tmds_data_p[1]), .OB(O_tmds_data_n[1]));
    ELVDS_OBUF u_d2 (.I(ser[2]), .O(O_tmds_data_p[2]), .OB(O_tmds_data_n[2]));
    ELVDS_OBUF u_ck (.I(ser[3]), .O(O_tmds_clk_p),     .OB(O_tmds_clk_n));
endmodule
