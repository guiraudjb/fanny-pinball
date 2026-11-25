#!/usr/bin/env python3
"""Plateau aux inserts allumés, pour les lampes de la table VPX.

Le plateau peint (donnees/decor/plateau.jpg, tiré de la scène du jeu web) montre les inserts éteints : pastilles
sombres avec leur lettre (T-O-U-R, F-A-N-N-Y, ×2…). Les lampes VPX sont en « mode image » : allumées, elles montrent
sur le cercle de l'insert (et son halo) cette image-ci, où chaque insert est redessiné allumé comme dans le jeu web
(js/render.js drawLampInsert, lit = true) : plastique coloré éclairé de l'intérieur, anneau moulé, reflet, lettre.

  python3 outils/vpx/inserts.py   → donnees/decor/inserts/<lampe>.png (un insert allumé, RGBA, halo compris)
                                     donnees/decor/plateau_allume.jpg (tous allumés, pour comparer)
                                     donnees/decor/plateau_eteint.jpg (plateau de la table, inserts éteints assombris)
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(ICI, 'donnees/decor')
table = json.load(open(os.path.join(ICI, 'donnees/table.json')))
plateau = Image.open(os.path.join(D, 'plateau.jpg')).convert('RGB')
K = plateau.width / table['W']                       # pixels par mm (3,2)
SS = 4                                               # sur-échantillonnage du dessin
POLICE = next(p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                          '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] if os.path.exists(p))
HALO = 1.35                                          # rayon du halo / rayon de l'insert (= rayon des lampes VPX)


def rgb(h):
    n = int(h[1:], 16)
    return np.array([(n >> 16) & 255, (n >> 8) & 255, n & 255], float)


def teinte(c, k, lift=0):
    return np.clip(c * k + lift, 0, 255)


def insert_allume(r_mm, coul, texte):
    """Insert allumé (RGBA), côté 2·HALO·r, centré ; dessiné à SS× puis réduit."""
    r = r_mm * K * SS
    n = int(np.ceil(2 * HALO * r)) + 4
    c = n / 2
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    d = np.hypot(xx - c, yy - c)
    col = rgb(coul)
    im = np.zeros((n, n, 4))
    # halo : lumière qui déborde autour de l'insert
    halo = np.clip(1 - (d - r) / ((HALO - 1) * r), 0, 1) ** 2 * (d >= r)
    im[..., :3] = teinte(col, 1.0, 40)
    im[..., 3] = halo * 0.8
    # cerclage sombre
    bague = d <= r + 1.1 * K * SS                    # 1,1 mm
    im[bague, :3] = [24, 17, 12]; im[bague, 3] = 1
    # plastique éclairé : dégradé radial (centre presque blanc, couleur à 58 %, bord plus sombre)
    t = np.clip(d / r, 0, 1)[..., None]
    c0, c1, c2 = teinte(col, 0.25, 200), teinte(col, 1.0, 50), teinte(col, 0.9, 10)
    grad = np.where(t < 0.58, c0 + (c1 - c0) * (t / 0.58), c1 + (c2 - c1) * ((t - 0.58) / 0.42))
    dedans = d <= r
    im[dedans, :3] = grad[dedans]; im[dedans, 3] = 1
    out = Image.fromarray(np.dstack([im[..., :3], im[..., 3:] * 255]).astype(np.uint8), 'RGBA')
    dr = ImageDraw.Draw(out, 'RGBA')
    # anneau moulé, reflet, bord
    w = max(1, int(r * 0.075))
    dr.ellipse((c - r * 0.74, c - r * 0.74, c + r * 0.74, c + r * 0.74), outline=(255, 255, 255, 82), width=w)
    refl = Image.new('RGBA', out.size, (0, 0, 0, 0))
    ImageDraw.Draw(refl).ellipse((c - r * 0.24 - r * 0.38, c - r * 0.28 - r * 0.18, c - r * 0.24 + r * 0.38, c - r * 0.28 + r * 0.18),
                                 fill=(255, 255, 255, 87))
    refl = refl.rotate(np.degrees(0.6), center=(c - r * 0.24, c - r * 0.28), resample=Image.BICUBIC)
    out.alpha_composite(refl)
    dr = ImageDraw.Draw(out, 'RGBA')
    w = max(1, int(r * 0.085))
    dr.ellipse((c - r + 0.25, c - r + 0.25, c + r - 0.25, c + r - 0.25), outline=(0, 0, 0, 115), width=w)
    if texte:
        ft = ImageFont.truetype(POLICE, int(r * (0.92 if len(texte) > 1 else 1.18)))
        dr.text((c, c + r * 0.06), texte, font=ft, fill=(22, 15, 10, 255), anchor='mm')
    return out.resize((n // SS, n // SS), Image.LANCZOS)


allume = plateau.convert('RGBA')
os.makedirs(os.path.join(D, 'inserts'), exist_ok=True)
for lp in table['lampes']:
    ins = insert_allume(lp['r'], lp['couleur'], lp.get('texte') or '')
    ins.save(os.path.join(D, 'inserts', lp['nom'] + '.png'))       # flasher F_<nom> de la table (allumé = visible)
    allume.alpha_composite(ins, (int(round(lp['x'] * K - ins.width / 2)), int(round(lp['y'] * K - ins.height / 2))))
allume.convert('RGB').save(os.path.join(D, 'plateau_allume.jpg'), quality=92)

# plateau de la table : inserts éteints assombris (plastique non éclairé), pour que l'insert allumé tranche ; la
# lettre et le cerclage restent (on n'assombrit que le disque, la lettre noire reste noire)
eteint = np.asarray(plateau, float)
yy, xx = np.mgrid[0:eteint.shape[0], 0:eteint.shape[1]]
for lp in table['lampes']:
    cx, cy, r = lp['x'] * K, lp['y'] * K, lp['r'] * K
    x0, x1, y0, y1 = int(cx - r - 2), int(cx + r + 3), int(cy - r - 2), int(cy + r + 3)
    d = np.hypot(xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy)
    f = np.clip((r - d) / 1.5, 0, 1)[..., None]                 # bord adouci
    eteint[y0:y1, x0:x1] *= 1 - 0.5 * f
Image.fromarray(eteint.astype(np.uint8)).save(os.path.join(D, 'plateau_eteint.jpg'), quality=92)
print(f"{len(table['lampes'])} inserts allumés → {os.path.join(D, 'plateau_allume.jpg')}")
