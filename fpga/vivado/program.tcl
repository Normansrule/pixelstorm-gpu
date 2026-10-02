# fpga/vivado/program.tcl — load the bitstream over USB (JTAG) into the board's FPGA
#   vivado -mode batch -source fpga/vivado/program.tcl -tclargs nexys_a7
set board [lindex $argv 0]; if {$board eq ""} { set board nexys_a7 }
open_hw_manager
connect_hw_server
open_hw_target
set dev [lindex [get_hw_devices xc7a*] 0]
current_hw_device $dev
set_property PROGRAM.FILE build/fpga/$board/pixelstorm_$board.bit $dev
program_hw_devices $dev
puts "Pixelstorm is running: press the centre button"
