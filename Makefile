# Pixelstorm GPU — common tasks.  Run `make help`.
KERNEL ?= kernels/01_vector_add.psa
PORT   ?= 8000


.PHONY: fpga-gen fpga-sim fpga-tang fpga-bit fpga-prog fpga-datasheet silicon gds record docs site help setup test test1 lint synth wave run sim traces bundle figures isa serve all clean

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
	@echo "make fpga-sim  simulate the FPGA board: VGA frames checked pixel by pixel"
	@echo "make fpga-bit BOARD=nexys_a7|basys3   bitstream with Vivado; make fpga-prog to load it"
	@echo "make fpga-tang  Tang Nano 20K: open-source build and load (OSS CAD Suite)"
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

BOARD ?= basys3
OFL_BOARD_nexys_a7 = nexys_a7_100
OFL_BOARD_basys3   = basys3

fpga-gen:               ## assemble the demo kernels into the loader ROM (fpga/gen)
	node fpga/gen_programs.js

# GPU shapes of the three boards: name warps lanes shared-memory-banks
FPGA_SHAPES = basys3:8:4:4 nexys_a7:4:8:8 tangnano20k:16:2:2

fpga-sim: fpga-gen      ## simulate the boards: every kernel on all three GPU shapes, a UART upload, TMDS; pixel-checked
	mkdir -p build/fpga
	iverilog -g2012 -o build/fpga/tb_tmds.vvp fpga/sim/tb_tmds.v fpga/rtl/ps_tmds_enc.v
	vvp -n build/fpga/tb_tmds.vvp | tee build/fpga/tmds.log | grep -E "PASS|FAIL"
	@for sh in $(FPGA_SHAPES); do \
	  b=$${sh%%:*}; r=$${sh#*:}; nw=$${r%%:*}; r=$${r#*:}; ws=$${r%%:*}; sb=$${r#*:}; \
	  iverilog -g2012 -I rtl -Ptb_fpga.NW=$$nw -Ptb_fpga.WS=$$ws -Ptb_fpga.SB=$$sb -o build/fpga/tb_$$b.vvp fpga/sim/tb_fpga.v fpga/rtl/*.v rtl/ps_*.v || exit 1; \
	  for s in 0 1 2 3; do \
	    vvp -n build/fpga/tb_$$b.vvp +sel=$$s +ppm=build/fpga/$$b-$$s.ppm > build/fpga/$$b-$$s.log; \
	    node fpga/sim/check.js $$s build/fpga/$$b-$$s.ppm $$nw $$ws | sed "s/^/$$b: /" || exit 1; \
	    grep -a "PIXELSTORM" build/fpga/$$b-$$s.log | tr -d '\r' | sed "s/^/$$b: /"; done; done
	node tools/pixelstorm.js upload fpga/kernels/rings.psa --hex build/fpga/rings.hex > /dev/null
	vvp -n build/fpga/tb_basys3.vvp +upload=build/fpga/rings.hex +ppm=build/fpga/upload.ppm > build/fpga/upload.log
	node fpga/sim/check.js k:fpga/kernels/rings.psa build/fpga/upload.ppm 8 4 | sed 's/^/basys3 upload: /'
	vvp -n build/fpga/tb_basys3.vvp +upload=build/fpga/rings.hex +corrupt | grep -E "PASS|FAIL" | tee build/fpga/corrupt.log
	@grep -q PASS build/fpga/corrupt.log
	python3 fpga/sim/ppm2png.py
	python3 fpga/sim/report.py

fpga-tang: fpga-gen     ## Tang Nano 20K: open-source build (Yosys, nextpnr-himbaechel, gowin_pack) and load
	bash fpga/boards/tangnano20k/build.sh

fpga-bit: fpga-gen      ## bitstream with Vivado: make fpga-bit BOARD=nexys_a7 (or basys3)
	vivado -mode batch -nojournal -nolog -source fpga/vivado/build.tcl -tclargs $(BOARD)

fpga-prog:              ## load the bitstream over USB with openFPGALoader
	openFPGALoader -b $(OFL_BOARD_$(BOARD)) build/fpga/$(BOARD)/pixelstorm_$(BOARD).bit

fpga-datasheet:         ## regenerate fpga/docs/pixelstorm-fpga-datasheet.pdf
	python3 fpga/docs/datasheet.py

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
