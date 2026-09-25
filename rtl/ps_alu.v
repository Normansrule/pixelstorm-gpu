// =============================================================================
// ps_alu.v — one lane's integer Arithmetic Logic Unit (ALU).
// A warp has WARP_SIZE copies of this module side by side; they all receive
// the SAME opcode but DIFFERENT operands. That is SIMT (Single Instruction,
// Multiple Threads) in one picture. NVIDIA markets these lanes as "CUDA cores".
// =============================================================================
`include "ps_defines.vh"

module ps_alu (
    input  wire [5:0]  op,
    input  wire [31:0] a,        // Rs1 value for this lane
    input  wire [31:0] b,        // Rs2 value for this lane
    input  wire [31:0] c,        // Rs3 value for this lane (MAD)
    input  wire [31:0] imm14,
    input  wire [31:0] imm18,
    input  wire [2:0]  cmp,
    input  wire        psel,     // predicate used by SEL
    input  wire [31:0] srv,      // special-register value (S2R)
    input  wire [31:0] cval,     // constant-bank value (LDC)
    output reg  [31:0] y,        // result written to Rd
    output reg         p         // result written to a predicate (SETP)
);
    wire signed [31:0] sa = a;
    wire signed [31:0] sb = b;
    wire signed [63:0] qprod = sa * sb;   // Q16.16 fixed-point product

    integer k;
    reg [31:0] popc;
    always @* begin
        popc = 32'd0;
        for (k = 0; k < 32; k = k + 1) popc = popc + {31'd0, a[k]};
    end

    always @* begin
        y = 32'd0;
        p = 1'b0;
        case (op)
            `OP_MOV  : y = a;
            `OP_MOVI : y = imm18;
            `OP_S2R  : y = srv;
            `OP_LDC  : y = cval;
            `OP_ADD  : y = a + b;
            `OP_SUB  : y = a - b;
            `OP_MUL  : y = a * b;
            `OP_AND  : y = a & b;
            `OP_OR   : y = a | b;
            `OP_XOR  : y = a ^ b;
            `OP_SHL  : y = a << b[4:0];
            `OP_SHR  : y = a >> b[4:0];
            `OP_SRA  : y = sa >>> b[4:0];
            `OP_MIN  : y = (sa < sb) ? a : b;
            `OP_MAX  : y = (sa > sb) ? a : b;
            `OP_QMUL : y = qprod[47:16];
            `OP_MAD  : y = a * b + c;
            `OP_SEL  : y = psel ? a : b;
            `OP_POPC : y = popc;
            `OP_ADDI : y = a + imm14;
            `OP_MULI : y = a * imm14;
            `OP_ANDI : y = a & imm14;
            `OP_ORI  : y = a | imm14;
            `OP_XORI : y = a ^ imm14;
            `OP_SHLI : y = a << imm14[4:0];
            `OP_SHRI : y = a >> imm14[4:0];
            `OP_SRAI : y = sa >>> imm14[4:0];
            `OP_SETP : begin
                case (cmp)
                    `CMP_EQ  : p = (a == b);
                    `CMP_NE  : p = (a != b);
                    `CMP_LT  : p = (sa <  sb);
                    `CMP_LE  : p = (sa <= sb);
                    `CMP_GT  : p = (sa >  sb);
                    `CMP_GE  : p = (sa >= sb);
                    `CMP_LTU : p = (a <  b);
                    default  : p = (a >= b);   // CMP_GEU
                endcase
            end
            default  : ;
        endcase
    end
endmodule
