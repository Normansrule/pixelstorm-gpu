#!/usr/bin/env bash
# Download the SkyWater 130 nm high-density standard-cell library (sky130_fd_sc_hd)
# files the silicon flow needs: timing (Liberty), abstracts (LEF) and cell layouts (GDS).
# Source: The OpenROAD Project's OpenROAD-flow-scripts, Apache-2.0 (the PDK itself is Apache-2.0).
set -euo pipefail
D=build/pdk; mkdir -p "$D"
B=https://raw.githubusercontent.com/The-OpenROAD-Project/OpenROAD-flow-scripts/master/flow/platforms/sky130hd
for f in lib/sky130_fd_sc_hd__tt_025C_1v80.lib lef/sky130_fd_sc_hd_merged.lef lef/sky130_fd_sc_hd.tlef gds/sky130_fd_sc_hd.gds; do
  out="$D/$(basename "$f")"
  if [ -s "$out" ]; then echo "have $out"; else echo "fetch $f"; curl -fsSL "$B/$f" -o "$out"; fi
done
ls -lh "$D"
