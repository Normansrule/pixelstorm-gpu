// =============================================================================
// ps_decoder.v — turns a 32-bit instruction word into control signals.
// Purely combinational. In a real GPU this is the "Decode" pipeline stage.
// =============================================================================
`include "ps_defines.vh"

module ps_decoder (
    input  wire [31:0] ir,
    output wire [5:0]  op,
    output wire        g_en,      // guard predicate enabled (@P / @!P)
    output wire        g_neg,     // guard is negated (@!P)
    output wire [1:0]  g_p,       // which predicate register guards us
    output wire [3:0]  rd,
    output wire [3:0]  rs1,
    output wire [3:0]  rs2,
    output wire [3:0]  rs3,
    output wire [31:0] imm14,     // sign-extended bits [13:0]
    output wire [31:0] imm18,     // sign-extended bits [17:0]
    output wire [2:0]  cmp,       // SETP comparison
    output wire [1:0]  selp,      // SEL predicate
    output wire [1:0]  shfl_mode,
    output wire [4:0]  shfl_val,
    output wire [1:0]  vote_mode,
    output reg         writes_rd,
    output reg         writes_pred,
    output reg         is_mem,
    output reg         is_shared,
    output reg         is_load,
    output reg         is_store,
    output reg         is_atom,
    output reg         is_branch,
    output reg         is_exit,
    output reg         is_bar
);
    assign op        = ir[31:26];
    assign g_en      = ir[25];
    assign g_neg     = ir[24];
    assign g_p       = ir[23:22];
    assign rd        = ir[21:18];
    assign rs1       = ir[17:14];
    assign rs2       = ir[13:10];
    assign rs3       = ir[9:6];
    assign imm14     = {{18{ir[13]}}, ir[13:0]};
    assign imm18     = {{14{ir[17]}}, ir[17:0]};
    assign cmp       = ir[2:0];
    assign selp      = ir[1:0];
    assign shfl_mode = ir[13:12];
    assign shfl_val  = ir[4:0];
    assign vote_mode = ir[1:0];

    always @* begin
        writes_rd   = 1'b0;  writes_pred = 1'b0;
        is_mem      = 1'b0;  is_shared   = 1'b0;
        is_load     = 1'b0;  is_store    = 1'b0;  is_atom = 1'b0;
        is_branch   = 1'b0;  is_exit     = 1'b0;  is_bar  = 1'b0;
        case (op)
            `OP_EXIT : is_exit   = 1'b1;
            `OP_BRA  : is_branch = 1'b1;
            `OP_BAR  : is_bar    = 1'b1;
            `OP_MOV, `OP_MOVI, `OP_S2R, `OP_LDC,
            `OP_ADD, `OP_SUB, `OP_MUL, `OP_AND, `OP_OR, `OP_XOR,
            `OP_SHL, `OP_SHR, `OP_SRA, `OP_MIN, `OP_MAX, `OP_QMUL,
            `OP_MAD, `OP_SEL, `OP_POPC,
            `OP_ADDI, `OP_MULI, `OP_ANDI, `OP_ORI, `OP_XORI,
            `OP_SHLI, `OP_SHRI, `OP_SRAI, `OP_SHFL : writes_rd = 1'b1;
            `OP_SETP : writes_pred = 1'b1;
            `OP_VOTE : begin
                if (ir[1:0] == `VOTE_BALLOT) writes_rd   = 1'b1;
                else                          writes_pred = 1'b1;
            end
            `OP_LDG  : begin is_mem = 1'b1; is_load  = 1'b1; writes_rd = 1'b1; end
            `OP_STG  : begin is_mem = 1'b1; is_store = 1'b1; end
            `OP_ATOM : begin is_mem = 1'b1; is_atom  = 1'b1; writes_rd = 1'b1; end
            `OP_LDS  : begin is_mem = 1'b1; is_shared = 1'b1; is_load  = 1'b1; writes_rd = 1'b1; end
            `OP_STS  : begin is_mem = 1'b1; is_shared = 1'b1; is_store = 1'b1; end
            `OP_ATOMS: begin is_mem = 1'b1; is_shared = 1'b1; is_atom  = 1'b1; writes_rd = 1'b1; end
            default  : ;
        endcase
    end
endmodule
