#!/usr/bin/env python3
"""Images du README à partir des captures (npm run screenshots) : bannière, captures par outil
encadrées, et captures pleine page allégées (256 couleurs, presque sans perte).

    python3 scripts/readme-images.py docs/captures
"""
import sys, os, glob
from PIL import Image, ImageDraw

folder = sys.argv[1] if len(sys.argv) > 1 else 'docs/captures'
BANNER = ['01-express.png', '02-effets.png', '12-parole.png', '13-formats.png']
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

# Captures pleine page allégées (256 couleurs, presque sans perte).
for path in sorted(glob.glob(os.path.join(folder, '[0-9]*.png'))):
    light(Image.open(path), path)

# Captures par outil (scripts/readme-shots.js) : coins arrondis et ombre douce sur fond
# transparent, lisibles en thème clair comme en thème sombre de GitHub. Une capture déjà
# encadrée (plus grande que la fenêtre de 760 x 1520) n'est pas retraitée.
M, SH = 28, 18
for path in sorted(glob.glob(os.path.join(folder, 'outils', '*.png'))):
    im = Image.open(path).convert('RGB')
    if im.size != (760, 1520):
        continue
    canvas = Image.new('RGBA', (im.width + 2 * M, im.height + 2 * M), (0, 0, 0, 0))
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((M - 4, M + 6, M + im.width + 4, M + im.height + 10), R + 4, fill=(0, 0, 0, 70))
    from PIL import ImageFilter
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(SH / 2)))
    layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    layer.paste(im, (M, M), rounded(im))
    canvas = Image.alpha_composite(canvas, layer)
    # 600 px de large (affichées en 260 à 300 px) et 256 couleurs : cinq fois plus léger, pareil à l'œil.
    canvas = canvas.resize((600, round(canvas.height * 600 / canvas.width)), Image.LANCZOS)
    canvas.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)

print('Images du README à jour dans ' + folder)

# Animations (scripts/readme-gallery.js) : les images d'un dossier deviennent un GIF léger, la
# dernière image reste affichée plus longtemps. Le dossier d'images est ensuite supprimé.
import shutil
for d in sorted(glob.glob(os.path.join(folder, 'animations', '*', ''))):
    frames = [Image.open(p).convert('RGB').resize((400, 800), Image.LANCZOS) for p in sorted(glob.glob(os.path.join(d, '*.png')))]
    if not frames:
        continue
    # Une palette commune (faite sur quelques images) : pas de scintillement entre les images.
    sample = Image.new('RGB', (400, 800 * min(4, len(frames))))
    for i, f in enumerate(frames[::max(1, len(frames) // 4)][:4]):
        sample.paste(f, (0, 800 * i))
    pal = sample.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    durations = [380] * (len(q) - 1) + [2600]
    q[0].save(os.path.normpath(d) + '.gif', save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
    shutil.rmtree(d)
