# Pixelstorm GPU — common tasks.  Run `make help`.
KERNEL ?= kernels/01_vector_add.psa
PORT   ?= 8000


.PHONY: silicon gds record docs site help setup test test1 lint synth wave run sim traces bundle figures isa serve all clean

help:
	@echo "make setup    install tools (Ubuntu / WSL2)"
	@echo "make test     RTL vs golden model for every kernel, 1 and 2 SMs"
	@echo "make run      run KERNEL=$(KERNEL) on the RTL"
	@echo "make sim      run KERNEL on the golden model"
	@echo "make wave     run KERNEL with a VCD and open GTKWave"
	@echo "make lint     Verilator lint"
	@echo "make synth    Yosys synthesis statistics"
	@echo "make traces   record RTL traces into web/traces/"
	@echo "make figures  regenerate docs/img/*.svg from the traces"
	@echo "make docs     regenerate chapter 6 and the course template"
	@echo "make all      test, traces, figures, docs"
	@echo "make serve    home, 3D chip, visualizer and labs at http://localhost:$(PORT)"
	@echo "make record   record the 3D explorer into docs/img/chip.gif"
	@echo "make silicon  synthesize to SkyWater 130 nm, place, write GDS, render with KLayout"
	@echo "make gds      open the layout in KLayout"

setup:
	bash scripts/setup_ubuntu.sh

test:
	./pixelstorm test

test1:
	./pixelstorm test --sms 1

run:
	./pixelstorm rtl $(KERNEL)

sim:
	./pixelstorm sim $(KERNEL)

wave:
	./pixelstorm rtl $(KERNEL) --vcd build/wave.vcd
	gtkwave build/wave.vcd sim/wave.gtkw &

lint:
	verilator --lint-only -Wall -Wno-fatal -Wno-WIDTH -Wno-UNUSED -Irtl --top-module ps_gpu_top rtl/*.v

synth:
	yosys -p "read_verilog -Irtl -DSYNTHESIS rtl/*.v; synth -top ps_gpu_top; stat"

traces: bundle
	./pixelstorm traces

figures: traces
	node tools/figures.js
	node tools/site_data.js

docs:
	python3 tools/rtl_chapter.py
	python3 tools/silicon/chapter.py
	python3 tools/course.py

all: test figures docs

bundle:
	./pixelstorm bundle

isa:
	./pixelstorm isa-md

silicon:                ## RTL -> sky130 gates -> placed GDS -> KLayout pictures
	bash tools/silicon/fetch_pdk.sh
	mkdir -p build/silicon
	yosys -q -s tools/silicon/synth.ys
	python3 tools/silicon/place.py
	python3 tools/silicon/render.py
	node tools/figures.js
	python3 tools/silicon/chapter.py
	python3 tools/course.py

gds: silicon            ## open the layout in KLayout
	klayout build/silicon/ps_s130.gds &

record:
	@echo "needs: pip install playwright pillow && playwright install chromium, and make serve running"
	python3 tools/record_chip.py

site:
	node tools/site_data.js
	mkdir -p web/img && cp docs/img/* web/img/

serve: site
	@echo "open http://localhost:$(PORT)"
	python3 -m http.server $(PORT) -d web

clean:
	rm -rf build
