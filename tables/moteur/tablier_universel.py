#!/usr/bin/env python3
"""Tablier de la base universelle (moteur/bas_fanny/t077.png, extrait de Fanny par decor_glb.py --bas) :
cartes de la table dans les triangles (outils/vpx/tablier.py --cartes), puis texte du centre neutre à la place de
« FANNY TE LA REND … PÉTANQUE WORLD TOUR » (même place, même style). La texture est retournée (haut = joueur).

  python3 outils/vpx/decor_glb.py --bas --sortie tables/moteur/bas_fanny
  python3 outils/vpx/tablier.py --dossier tables/moteur/bas_fanny --cartes tables/moteur/cartes_universelle.json
  python3 tables/moteur/tablier_universel.py
"""
import os
from PIL import Image, ImageDraw, ImageFont
ICI = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(ICI, 'bas_fanny', 't077.png')
GRAS = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
im = Image.open(F).convert('RGBA').transpose(Image.FLIP_TOP_BOTTOM)     # sens de lecture
W, H = im.size
dr = ImageDraw.Draw(im)
x0, x1 = 780, 1120
for y in range(H - 348, H - 40):                                         # ancien texte du centre : noir dégradé
    c = im.getpixel((760, y))                                            # du même rang, pris à gauche
    dr.line((x0, y, x1, y), fill=c)
def ligne(y, txt, taille, coul):
    ft = ImageFont.truetype(GRAS, taille)
    dr.text((952, H - y), txt, font=ft, fill=coul, anchor='mm')        # axe de la flèche du sauvetage
ligne(282, 'SAUVETAGE', 34, (255, 246, 224, 255))
ligne(232, 'bille rendue tant', 22, (255, 246, 224, 255))
ligne(204, 'que la lampe brille', 22, (255, 246, 224, 255))
ligne(140, '#ARDUCIBLE', 24, (232, 178, 60, 255))
im.transpose(Image.FLIP_TOP_BOTTOM).save(F)

# plastiques des lance-pierres (t076.png) : décor de Fanny remplacé par un gris uni, liseré foncé gardé
P = os.path.join(ICI, 'bas_fanny', 't076.png')
pl = Image.open(P).convert('RGBA')
px = pl.load()
for y in range(pl.height):
    for x in range(pl.width):
        r, g, b, a = px[x, y]
        if a and r + g + b > 90:
            orange = r > 170 and g > 100 and b < 110
            px[x, y] = (70, 75, 84, a) if orange else (208, 212, 218, a)
pl.save(P)
print(F)
