#!/usr/bin/env python3
"""Images du README à partir des captures (npm run screenshots) : bannière, vignettes de la
galerie (haut de chaque page), et captures allégées (256 couleurs, presque sans perte).

    python3 scripts/readme-images.py docs/captures
"""
import sys, os, glob
from PIL import Image, ImageDraw

folder = sys.argv[1] if len(sys.argv) > 1 else 'docs/captures'
BANNER = ['01-effets.png', '06-couleur-conversion.png', '09-musique.png', '11-formats.png']
R = 22


def rounded(im):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), R, fill=255)
    return mask


def light(im, path):
    im.convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)


# Bannière : quatre pages côte à côte, coupées à la même hauteur.
H, PAD, GAP = 1500, 56, 40
shots = [Image.open(os.path.join(folder, n)).convert('RGB') for n in BANNER]
shots = [im.crop((0, 0, im.width, min(H, im.height))) for im in shots]
out = Image.new('RGB', (PAD * 2 + sum(s.width for s in shots) + GAP * (len(shots) - 1), PAD * 2 + H), (18, 18, 20))
x = PAD
for im in shots:
    shadow = Image.new('RGBA', (im.width + 24, im.height + 24), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((12, 16, im.width + 12, im.height + 12), R, fill=(0, 0, 0, 110))
    out.paste(shadow, (x - 12, PAD - 12), shadow)
    out.paste(im, (x, PAD), rounded(im))
    x += im.width + GAP
out = out.resize((1600, round(out.height * 1600 / out.width)), Image.LANCZOS)
out.save(os.path.join(folder, 'banniere.png'), optimize=True)

# Vignettes de la galerie : le haut de chaque page (même hauteur), et captures allégées.
os.makedirs(os.path.join(folder, 'apercus'), exist_ok=True)
for path in sorted(glob.glob(os.path.join(folder, '[0-9]*.png'))):
    im = Image.open(path).convert('RGB')
    top = im.crop((0, 0, im.width, min(1240, im.height)))
    if top.height < 1240:
        pad = Image.new('RGB', (im.width, 1240), top.getpixel((0, top.height - 1)))
        pad.paste(top, (0, 0))
        top = pad
    light(top, os.path.join(folder, 'apercus', os.path.basename(path)))
    light(im, path)
print('Images du README à jour dans ' + folder)
