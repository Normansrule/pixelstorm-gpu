#!/usr/bin/env bash
# Install everything Pixelstorm needs on Ubuntu 22.04 / 24.04 / 26.04 (native or WSL2).
set -euo pipefail
echo "==> apt packages"
sudo apt-get update
sudo apt-get install -y iverilog verilator gtkwave yosys nodejs npm git make python3
echo
echo "==> versions"
iverilog -V 2>&1 | head -1 || true
verilator --version || true
yosys -V || true
node --version
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js $NODE_MAJOR is too old; install Node 18+ (for example from https://github.com/nvm-sh/nvm)." >&2
  exit 1
fi
echo
echo "==> smoke test"
node tools/pixelstorm.js rtl kernels/01_vector_add.psa | tail -2
echo
echo "Ready. Next: make test, make traces, make serve"
echo "WSL2: GTKWave opens through WSLg on Windows 11; on Windows 10 install an X server."
