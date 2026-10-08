"""Draw the plugin-ready icon: a checklist sheet with three ticked rows and a seal, flat style.
Run: python3 scripts/make-icon.py  (needs Pillow). Writes plugin/.claude-plugin/icon.png and assets/icon.png."""
from pathlib import Path
from PIL import Image, ImageDraw

S = 4                       # supersample factor, scaled down at the end for smooth edges
N = 512 * S
BG = (24, 52, 74)           # deep slate blue
SHEET = (244, 246, 248)
LINE = (176, 188, 200)
TICK = (34, 160, 96)        # green
SEAL = (240, 176, 48)       # amber

def r(*v):
    return [x * S for x in v]

img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle(r(0, 0, 512, 512), radius=96 * S, fill=BG)
d.rounded_rectangle(r(120, 84, 392, 428), radius=28 * S, fill=SHEET)
d.rounded_rectangle(r(196, 64, 316, 112), radius=18 * S, fill=LINE)           # clip
for i, y in enumerate((164, 248, 332)):
    d.rounded_rectangle(r(152, y, 200, y + 48), radius=10 * S, outline=TICK, width=7 * S)
    d.line(r(162, y + 25, 174, y + 37, 192, y + 12), fill=TICK, width=9 * S, joint="curve")
    d.rounded_rectangle(r(220, y + 16, 360 - 40 * (i == 2), y + 32), radius=8 * S, fill=LINE)
d.ellipse(r(318, 318, 434, 434), fill=SEAL, outline=BG, width=10 * S)           # ready seal
d.line(r(348, 378, 368, 398, 404, 356), fill=SHEET, width=14 * S, joint="curve")

out = img.resize((512, 512), Image.LANCZOS)
root = Path(__file__).resolve().parent.parent
for p in (root / "plugin/.claude-plugin/icon.png", root / "assets/icon.png"):
    out.save(p, optimize=True)
    print(p.relative_to(root), p.stat().st_size, "bytes")
