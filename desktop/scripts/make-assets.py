"""Generates the app icon and the installer wizard images (run once: python scripts/make-assets.py).
Needs Pillow. Output goes to desktop/assets/. Replace these files with your own artwork any time."""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(exist_ok=True)
CYAN, VIOLET, BG1, BG2 = (56, 214, 242), (155, 140, 255), (7, 11, 18), (17, 26, 51)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h, c1, c2, diagonal=True):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = ((x / w + y / h) / 2) if diagonal else y / h
            px[x, y] = lerp(c1, c2, t)
    return img


def font(size, bold=True):
    for name in ("DejaVuSans-Bold.ttf", "DejaVuSans.ttf", "LiberationSans-Bold.ttf", "arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def emblem(size):
    """Arc-reactor ring with a shield and an A, on a transparent square."""
    S = size * 4
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = S / 2
    ring = gradient(S, S, CYAN, VIOLET).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    m = ImageDraw.Draw(mask)
    m.ellipse([S * .06, S * .06, S * .94, S * .94], outline=255, width=int(S * .055))
    for a0 in (20, 140, 260):   # gaps in the ring, like a reactor
        m.arc([S * .06, S * .06, S * .94, S * .94], a0, a0 + 14, fill=0, width=int(S * .06))
    layer.paste(ring, (0, 0), mask)
    # shield
    top, bot, half = S * .24, S * .78, S * .22
    shield = [(c, top), (c + half, top + S * .06), (c + half, S * .52), (c, bot), (c - half, S * .52), (c - half, top + S * .06)]
    d.polygon(shield, fill=(10, 18, 34, 255))
    d.line(shield + [shield[0]], fill=CYAN + (255,), width=int(S * .02), joint="curve")
    # letter A
    f = font(int(S * .30))
    bbox = d.textbbox((0, 0), "A", font=f)
    d.text((c - (bbox[2] - bbox[0]) / 2 - bbox[0], S * .425 - (bbox[3] - bbox[1]) / 2 - bbox[1]), "A", font=f, fill=CYAN + (255,))
    return layer.resize((size, size), Image.LANCZOS)


def icon(size=1024):
    base = gradient(size, size, BG2, BG1).convert("RGBA")
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([size * .2, size * .2, size * .8, size * .8], fill=CYAN + (70,))
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(size * .08)))
    base.alpha_composite(emblem(size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * .22), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def sidebar(w=164, h=314):
    S = 4
    img = gradient(w * S, h * S, BG2, BG1, diagonal=False).convert("RGBA")
    em = emblem(int(w * S * .74))
    img.alpha_composite(em, (int(w * S * .13), int(h * S * .10)))
    d = ImageDraw.Draw(img)
    d.text((w * S / 2, h * S * .60), "AEGIS", font=font(int(w * S * .17)), fill=(232, 238, 249, 255), anchor="mm")
    d.text((w * S / 2, h * S * .67), "your AI assistant", font=font(int(w * S * .075), False), fill=(138, 153, 181, 255), anchor="mm")
    d.rectangle([0, h * S - int(h * S * .012), w * S, h * S], fill=CYAN + (255,))
    return img.resize((w, h), Image.LANCZOS).convert("RGB")


big = icon(1024)
big.resize((256, 256), Image.LANCZOS).save(OUT / "icon.png")
big.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
sb = sidebar()
sb.save(OUT / "installerSidebar.bmp")
sb.save(OUT / "uninstallerSidebar.bmp")
print("wrote", sorted(p.name for p in OUT.iterdir()))
