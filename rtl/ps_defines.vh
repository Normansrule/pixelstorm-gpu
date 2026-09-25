// =============================================================================
// ps_defines.vh — Pixelstorm Instruction Set Architecture (PS-ISA) constants
// -----------------------------------------------------------------------------
// Every instruction is 32 bits. Field layout (see docs/03-isa-reference.md):
//
//   31      26 25 24 23 22 21   18 17   14 13   10 9     6 5          0
//  +----------+--+--+-----+-------+-------+-------+-------+------------+
//  |  opcode  |G |N | Pg  |  Rd   |  Rs1  |  Rs2  |  Rs3  |  aux/cmp   |
//  +----------+--+--+-----+-------+-------+-------+-------+------------+
//              guard       imm14 = bits[13:0]  (overlaps Rs2/Rs3/aux)
//                          imm18 = bits[17:0]  (overlaps Rs1..aux)
//
//  G = guard enable, N = negate, Pg = predicate register P0..P3
//  "@P0 ADD R1, R2, R3"  -> only lanes whose P0 is true execute.
//
//  The single source of truth for the ISA table used by the assembler and the
//  browser simulator is web/js/pixelstorm.js. Keep the two in sync.
// =============================================================================
`ifndef PS_DEFINES_VH
`define PS_DEFINES_VH

// ---- control ----------------------------------------------------------------
`define OP_NOP    6'h00
`define OP_EXIT   6'h01
`define OP_BRA    6'h02
`define OP_BAR    6'h03
// ---- data movement ----------------------------------------------------------
`define OP_MOV    6'h04
`define OP_MOVI   6'h05
`define OP_S2R    6'h06
`define OP_LDC    6'h07
// ---- register-register integer ALU ------------------------------------------
`define OP_ADD    6'h08
`define OP_SUB    6'h09
`define OP_MUL    6'h0A
`define OP_AND    6'h0B
`define OP_OR     6'h0C
`define OP_XOR    6'h0D
`define OP_SHL    6'h0E
`define OP_SHR    6'h0F
`define OP_SRA    6'h10
`define OP_MIN    6'h11
`define OP_MAX    6'h12
`define OP_QMUL   6'h13
`define OP_MAD    6'h14
`define OP_SEL    6'h15
`define OP_POPC   6'h16
// ---- register-immediate integer ALU -----------------------------------------
`define OP_ADDI   6'h18
`define OP_MULI   6'h19
`define OP_ANDI   6'h1A
`define OP_ORI    6'h1B
`define OP_XORI   6'h1C
`define OP_SHLI   6'h1D
`define OP_SHRI   6'h1E
`define OP_SRAI   6'h1F
// ---- predicates and warp-level (cross-lane) operations ----------------------
`define OP_SETP   6'h20
`define OP_VOTE   6'h21
`define OP_SHFL   6'h22
// ---- memory -----------------------------------------------------------------
`define OP_LDG    6'h28
`define OP_STG    6'h29
`define OP_LDS    6'h2A
`define OP_STS    6'h2B
`define OP_ATOM   6'h2C
`define OP_ATOMS  6'h2D

// SETP comparison codes (bits [2:0])
`define CMP_EQ  3'd0
`define CMP_NE  3'd1
`define CMP_LT  3'd2
`define CMP_LE  3'd3
`define CMP_GT  3'd4
`define CMP_GE  3'd5
`define CMP_LTU 3'd6
`define CMP_GEU 3'd7

// S2R special registers (imm14[2:0])
`define SR_TID    3'd0   // threadIdx.x
`define SR_CTAID  3'd1   // blockIdx.x
`define SR_NTID   3'd2   // blockDim.x
`define SR_NCTAID 3'd3   // gridDim.x
`define SR_LANEID 3'd4   // lane inside the warp
`define SR_WARPID 3'd5   // warp inside the block
`define SR_SMID   3'd6   // which Streaming Multiprocessor
`define SR_CLOCK  3'd7   // cycle counter

// SHFL modes (imm14[13:12])
`define SHFL_IDX  2'd0
`define SHFL_UP   2'd1
`define SHFL_DOWN 2'd2
`define SHFL_XOR  2'd3

// VOTE modes (bits [1:0])
`define VOTE_ANY    2'd0
`define VOTE_ALL    2'd1
`define VOTE_BALLOT 2'd2

// Global memory request opcodes
`define MOP_READ  2'd0
`define MOP_WRITE 2'd1
`define MOP_ATOM  2'd2

`endif
