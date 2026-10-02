# =============================================================================
# fpga/vivado/build.tcl — Pixelstorm bitstream in Vivado batch mode (no project)
#   vivado -mode batch -source fpga/vivado/build.tcl -tclargs nexys_a7
#   vivado -mode batch -source fpga/vivado/build.tcl -tclargs basys3
# Run from the repository root. Output: build/fpga/<board>/pixelstorm_<board>.bit
# plus utilization and timing reports. Vivado ML Standard (free) supports both parts.
# =============================================================================
set board [lindex $argv 0]
if {$board eq ""} { set board nexys_a7 }
switch $board {
    nexys_a7 { set part xc7a100tcsg324-1; set top pixelstorm_nexys_a7 }
    basys3   { set part xc7a35tcpg236-1;  set top pixelstorm_basys3 }
    default  { error "unknown board $board (use nexys_a7 or basys3)" }
}
set out build/fpga/$board
file mkdir $out
read_verilog -sv [glob rtl/ps_*.v]
read_verilog -sv [glob fpga/rtl/*.v]
read_verilog -sv fpga/boards/clocking_xc7.v fpga/boards/$board/pixelstorm_$board.v
read_mem [glob fpga/gen/*.hex]
read_xdc fpga/boards/$board/$board.xdc
synth_design -top $top -part $part -include_dirs rtl -verilog_define SYNTHESIS -flatten_hierarchy rebuilt
opt_design
place_design
phys_opt_design
route_design
report_utilization    -file $out/utilization.rpt
report_timing_summary -file $out/timing.rpt
write_bitstream -force $out/pixelstorm_$board.bit
puts "Pixelstorm: wrote $out/pixelstorm_$board.bit (see utilization.rpt and timing.rpt)"
