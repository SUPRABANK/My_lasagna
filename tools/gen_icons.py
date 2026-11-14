"""Generate PWA icons from logo.jpg using Pillow."""
import os
from PIL import Image, ImageDraw, ImageOps

ROOT = r'C:\calforcash'
LOGO_PATH = os.path.join(ROOT, 'logo.jpg')
OUT_DIR = os.path.join(ROOT, 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

PRIMARY = (216, 74, 43, 255)  # #d84a2b

logo = Image.open(LOGO_PATH).convert('RGBA')


def rounded_image(img, radius):
    mask = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def make_icon(size, maskable=False):
    bg = Image.new('RGBA', (size, size), PRIMARY)
    d = ImageDraw.Draw(bg)
    # subtle vertical gradient
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(216 + (178 - 216) * t)
        g = int(74 + (58 - 74) * t)
        b = int(43 + (32 - 43) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b, 255))

    logo_box = int(size * (0.60 if maskable else 0.62))
    pad = (size - logo_box) // 2

    # white rounded tile
    tile = Image.new('RGBA', (logo_box, logo_box), (255, 255, 255, 255))
    tile = rounded_image(tile, logo_box // 4)
    bg.paste(tile, (pad, pad), tile)

    # logo fitted inside with margin
    inner = int(logo_box * 0.84)
    fitted = ImageOps.fit(logo, (inner, inner), method=Image.LANCZOS)
    fitted = rounded_image(fitted, max(4, inner // 6))
    inner_pad = pad + (logo_box - inner) // 2
    bg.paste(fitted, (inner_pad, inner_pad), fitted)

    return bg.convert('RGB')


targets = [
    ('icon-192', 192, False),
    ('icon-512', 512, False),
    ('icon-maskable-512', 512, True),
]

for name, size, maskable in targets:
    img = make_icon(size, maskable)
    out_path = os.path.join(OUT_DIR, f'{name}.png')
    img.save(out_path, 'PNG', optimize=True)
    print('wrote', out_path)

print('done')
