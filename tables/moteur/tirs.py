#!/usr/bin/env python3
"""Contrôle des lignes de tir : plateau de chaque table avec ses cibles (orange) et la ligne de tir de chacune vers
la palette qui la vise (bleu) ; murs invisibles en rouge. Planche : <sortie>.

    python3 moteur/tirs.py t1_banques t2_orbites … --sortie planche.jpg
"""
import argparse, json, os
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('tables', nargs='+')
ap.add_argument('--sortie', default='tirs.jpg')
a = ap.parse_args()
outs = []
for d in a.tables:
    t = json.load(open(os.path.join(d, 'sortie', 'table.json')))
    im = Image.open(os.path.join(d, 'sortie', 'images', 'plateau.jpg')).convert('RGB').resize((514, 1263))
    dr = ImageDraw.Draw(im)
    for m in t['murs']:
        dr.polygon([tuple(q) for q in m['pts']], outline=(40, 40, 40) if m.get('visible', True) else (200, 0, 0))
    for c in t['cibles']:
        x, y, nx, ny = c['x'], c['y'], c['nx'], c['ny']
        tx, ty = -ny, nx
        w = 12 if c['genre'] == 'ronde' else 15
        dr.polygon([(x + tx * w, y + ty * w), (x - tx * w, y - ty * w), (x - tx * w - nx * 6, y - ty * w - ny * 6),
                    (x + tx * w - nx * 6, y + ty * w - ny * 6)], fill=(255, 140, 0), outline=(0, 0, 0))
        k = (1075 - y) / ny if ny > 0.05 else 400
        for dx in (-13.5, 13.5):                        # couloir de la bille (diamètre 27 mm)
            dr.line([(x + tx * dx, y + ty * dx), (x + nx * k + tx * dx, y + ny * k + ty * dx)], fill=(0, 160, 255))
    outs.append(im.crop((0, 0, 514, 1130)))
pl = Image.new('RGB', (len(outs) * 524, 1130), 'white')
for i, o in enumerate(outs):
    pl.paste(o, (i * 524, 0))
pl.resize((pl.width * 2 // 3, pl.height * 2 // 3)).save(a.sortie, quality=88)
print(a.sortie)
