"""Draws the Tension app icons: a weight stack with the selector pin pulled out.

    python3 tools/make-icons.py      (needs Pillow)

Writes icon-192.png, icon-512.png and icon-maskable-512.png next to index.html.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG, PLATE, SLOT, CAP, ROD = (20, 29, 38), (230, 234, 238), (176, 186, 196), (143, 155, 167), (95, 108, 121)
PIN, PIN_DARK, CABLE = (245, 192, 43), (176, 128, 0), (255, 122, 69)
S = 2048  # draw big, scale down for smooth edges


def draw(maskable):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, S, S], fill=BG)
        k = 0.76          # keep everything inside Android's round safe zone
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=BG)
        k = 0.9
    c = S / 2
    fx = lambda v: c + (v - 542) * k * S / 1024       # 1024-unit design space; the pin
    fy = lambda v: c + (v - 482) * k * S / 1024       # sticks out right, so shift to balance
    w = lambda v: max(1, int(v * k * S / 1024))
    box = lambda x0, y0, x1, y1: [fx(x0), fy(y0), fx(x1), fy(y1)]

    # cable coming out of the top of the stack
    d.rounded_rectangle(box(414, 64, 450, 240), radius=w(18), fill=CABLE)
    # head plate the cable pulls on, with the selector rod running down the middle
    d.rounded_rectangle(box(192, 222, 672, 282), radius=w(20), fill=CAP)
    d.rectangle(box(418, 282, 446, 880), fill=ROD)
    # plates
    top, h, gap = 302, 98, 22
    for i in range(5):
        y = top + i * (h + gap)
        d.rounded_rectangle(box(172, y, 692, y + h), radius=w(20), fill=PLATE)
        d.rounded_rectangle(box(204, y + 32, 300, y + h - 32), radius=w(10), fill=SLOT)   # number label
    # the pin, pushed into the middle plate and sticking out to the right with a pull ring
    y = top + 2 * (h + gap) + h / 2
    d.rounded_rectangle(box(500, y - 24, 830, y + 24), radius=w(24), fill=PIN)
    d.rounded_rectangle(box(500, y + 12, 790, y + 24), radius=w(6), fill=PIN_DARK)     # shading under the rod
    d.ellipse(box(778, y - 84, 946, y + 84), fill=PIN)
    d.ellipse(box(828, y - 34, 896, y + 34), fill=BG)
    return im


for name, size, maskable in [("icon-192.png", 192, False), ("icon-512.png", 512, False), ("icon-maskable-512.png", 512, True)]:
    draw(maskable).resize((size, size), Image.LANCZOS).save(ROOT / name)
    print("wrote", name)
