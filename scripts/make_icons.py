from PIL import Image, ImageDraw
import math

BG = (15, 19, 25)        # #0F1319
AMBER = (227, 163, 77)   # #E3A34D
GREEN = (78, 154, 110)   # #4E9A6E
TEXT = (237, 239, 243)   # #EDEFF3

def make_icon(size, path, corner_radius_ratio=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    r = int(size * corner_radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)

    cx, cy = size / 2, size / 2 - size * 0.03
    R = size * 0.30

    # Stopwatch-ish "kickoff clock" glyph: a ring with a notch, like a countdown
    ring_w = max(3, int(size * 0.045))
    draw.arc([cx - R, cy - R, cx + R, cy + R], start=0, end=360, fill=(TEXT[0], TEXT[1], TEXT[2], 255), width=ring_w)

    # Clock hand pointing to ~"one hour before" position (upper right, like 1 o'clock)
    angle = math.radians(-60)
    hx = cx + R * 0.62 * math.cos(angle)
    hy = cy + R * 0.62 * math.sin(angle)
    draw.line([cx, cy, hx, hy], fill=AMBER, width=max(3, int(size * 0.05)))

    # small filled center dot
    dot_r = size * 0.035
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=AMBER)

    # tiny pitch-green dash at the bottom, like a ball resting on a line
    dash_w = size * 0.16
    dash_y = cy + R + size * 0.09
    draw.rounded_rectangle(
        [cx - dash_w / 2, dash_y, cx + dash_w / 2, dash_y + max(3, size * 0.03)],
        radius=size * 0.015,
        fill=GREEN,
    )

    img.save(path)

make_icon(192, "/home/claude/matchday/frontend/icons/icon-192.png")
make_icon(512, "/home/claude/matchday/frontend/icons/icon-512.png")
make_icon(180, "/home/claude/matchday/frontend/icons/apple-touch-icon.png", corner_radius_ratio=0.0)
print("icons done")
