#!/usr/bin/env python3
"""Record the 3D chip explorer into an animated GIF for the README.

Like Remotion, the video is made programmatically: the script drives the page's
own API (window.PSCHIP) frame by frame, setting the simulation cycle and the
camera, and screenshots each frame. Needs: pip install playwright pillow &&
playwright install chromium, and a server running (make serve).

    python3 tools/record_chip.py [--kernel mandelbrot] [--frames 40] [--out docs/img/chip.gif]
"""
import argparse, asyncio, io, math
from PIL import Image
from playwright.async_api import async_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--url', default='http://localhost:8000/chip.html')
ap.add_argument('--kernel', default='mandelbrot')
ap.add_argument('--frames', type=int, default=40)
ap.add_argument('--width', type=int, default=960)
ap.add_argument('--height', type=int, default=540)
ap.add_argument('--out', default='docs/img/chip.gif')
ap.add_argument('--wait', type=int, default=900, help='ms to let each frame render (raise on slow machines)')
a = ap.parse_args()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': a.width, 'height': a.height})
        await pg.goto(f'{a.url}?k={a.kernel}'); await pg.wait_for_timeout(4000)
        await pg.evaluate("document.querySelectorAll('.hud,.cambar,.unav').forEach(e => e.style.display = 'none'); document.getElementById('labels').classList.add('off'); PSCHIP.pause()")
        end = await pg.evaluate("+document.getElementById('scrub').max")
        frames = []
        for i in range(a.frames):
            f = i / a.frames
            cyc = int(end * min(1.0, f * 1.1))
            cam = dict(theta=-0.9 + 1.2 * f, phi=1.0 - 0.1 * math.sin(f * math.pi), r=104 - 16 * math.sin(f * math.pi), tx=0, ty=8, tz=-11)
            await pg.evaluate(f"PSCHIP.setCycle({cyc}); PSCHIP.setCam({cam})".replace("'", '"'))
            await pg.wait_for_timeout(a.wait)
            frames.append(Image.open(io.BytesIO(await pg.screenshot())).convert('RGB'))
            print(f'frame {i + 1}/{a.frames}  cycle {cyc}', flush=True)
        await b.close()
    q = [fr.quantize(colors=192, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for fr in frames]   # a palette per frame keeps the glow
    q[0].save(a.out, save_all=True, append_images=q[1:], duration=110, loop=0, optimize=True)
    print('wrote', a.out)

asyncio.run(main())
