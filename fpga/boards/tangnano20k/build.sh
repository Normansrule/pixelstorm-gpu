#!/usr/bin/env bash
# Pixelstorm for the Tang Nano 20K with the fully open-source flow (no vendor tools, no licence):
#   Yosys (synthesis) -> nextpnr-himbaechel (place and route) -> gowin_pack (bitstream) -> openFPGALoader
# All four come in the OSS CAD Suite: github.com/YosysHQ/oss-cad-suite-build (recent release).
# Run from the repository root:   bash fpga/boards/tangnano20k/build.sh [--flash]
set -euo pipefail
OUT=build/fpga/tangnano20k; mkdir -p "$OUT"
node fpga/gen_programs.js
yosys -q -p "read_verilog -sv -DSYNTHESIS -Irtl $(ls rtl/ps_*.v | tr '\n' ' ') $(ls fpga/rtl/*.v | tr '\n' ' ') fpga/boards/tangnano20k/pixelstorm_tangnano20k.v; \
             synth_gowin -top pixelstorm_tangnano20k -json $OUT/pixelstorm.json; tee -o $OUT/utilization.txt stat"
nextpnr-himbaechel --json $OUT/pixelstorm.json --write $OUT/pnr.json \
    --device GW2AR-LV18QN88C8/I7 --vopt family=GW2A-18C --vopt cst=fpga/boards/tangnano20k/tangnano20k.cst \
    --freq 25 2>&1 | tee $OUT/nextpnr.log | grep -E "Max frequency|ERROR|Info: Device utilisation" -A12 | head -40
gowin_pack -d GW2A-18C -o $OUT/pixelstorm_tangnano20k.fs $OUT/pnr.json
echo "bitstream: $OUT/pixelstorm_tangnano20k.fs"
if [ "${1:-}" = "--flash" ]; then openFPGALoader -b tangnano20k -f $OUT/pixelstorm_tangnano20k.fs
else openFPGALoader -b tangnano20k $OUT/pixelstorm_tangnano20k.fs; fi
