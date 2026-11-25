#!/usr/bin/env python3
"""Tablier de la table VPX : instructions déplacées dans les triangles noirs en diagonale.

Le tablier (texture du décor exporté du jeu web, voir decor_glb.py) porte deux cartes d'instructions tout en bas
(MULTIBALL TRIPLETTE, BONUS · EXTRA BALL) : dans la vue bureau elles sortent de l'écran. Ce script les efface
et réécrit leur texte dans les deux triangles noirs libres au-dessus, lignes parallèles au bord en V du tablier,
dans le style des cartes (titre blanc sur bandeau rouge, texte crème).

  python3 outils/vpx/tablier.py      (après decor_glb.py ; sans effet si les cartes sont déjà effacées)
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
import argparse
_ap = argparse.ArgumentParser()
_ap.add_argument('--dossier', default=os.path.join(ICI, 'donnees/decor'))
_ap.add_argument('--cartes', help='JSON [[titre, [lignes…]], [titre, [lignes…]]] : cartes d\'une autre table')
_a = _ap.parse_args()
D = _a.dossier
POLICE = next(p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                          '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] if os.path.exists(p))
CREME, ROUGE, BLANC = (243, 230, 200, 255), (200, 52, 43, 255), (255, 246, 224, 255)

CARTES = [   # texte de js/render.js APRON_CARDS, les deux dernières lignes raccourcies (pointe du triangle)
    ('MULTIBALL TRIPLETTE', ['F-A-N-N-Y allume LE CERCLE', 'Cercle allumé : 3 billes en jeu',
                             'Multiball : RAMPE = JACKPOT', '3 jackpots : SUPER JACKPOT']),
    ('BONUS · EXTRA BALL', ['T-O-U-R : bonus ×2, ×3 … ×5', '×5 : EXTRA BALL au Cercle',
                            'RAMPE : escale World Tour', '7 escales : GRAND CHELEM']),
]

if _a.cartes:
    CARTES = [(t, l) for t, l in json.load(open(_a.cartes))]

# texture du tablier : la seule texturée posée en bas de la table, à plat
decor = json.load(open(os.path.join(D, 'decor.json')))
g = next(g for g in decor['groupes'] if g['texture'] and g['min'][1] > 1900 and g['max'][2] < 50)
chemin = os.path.join(D, g['texture'])
tex = Image.open(chemin).convert('RGBA').transpose(Image.FLIP_TOP_BOTTOM)   # sens de la table (haut = fond du plateau)
a = np.asarray(tex).astype(int)
L, H = tex.size
rouge = (a[..., 0] > 150) & (a[..., 1] < 90) & (a[..., 3] > 200)
ys, xs = np.where(rouge)
if not len(ys):
    print(f'{g["texture"]} : cartes déjà effacées'); raise SystemExit
haut_cartes = ys.min()                                     # haut des bandeaux rouges

# 1. effacer les cartes : chaque ligne reprend le noir dégradé du tablier pris sur le bord gauche
cartes = np.zeros((H, L), bool)
for lo, hi in [(0, L // 2), (L // 2, L)]:
    m = (xs >= lo) & (xs < hi)
    cartes[haut_cartes - 2:H, xs[m].min() - 3:xs[m].max() + 4] = True
fond = a[:, 30, :].copy()
b = a.copy()
b[cartes] = np.broadcast_to(fond[:, None, :], a.shape)[cartes]
tex = Image.fromarray(b.astype(np.uint8), 'RGBA')

# 2. bord en V du tablier : première ligne opaque de chaque colonne ; une droite par côté
op = a[..., 3] > 128
bord = np.array([np.argmax(op[:, x]) if op[:, x].any() else H for x in range(L)])
milieu = L // 2
fin_d = max(x for x in range(milieu, L) if bord[x] < 200)          # bord droit du tablier (avant le couloir)


def droite(x0, x1):
    xx = np.arange(x0, x1)
    k, c = np.polyfit(xx, bord[xx], 1)
    return k, c


BAS = haut_cartes + 126         # limite basse du texte : le haut des anciennes cartes reste visible à l'écran
JANTE = 46                      # filet chromé le long du bord


def ecrire(cote, titre, lignes):
    """Lignes parallèles au bord du côté (« g » ou « d »), de la plus longue (contre le bord) à la plus courte."""
    if cote == 'g':
        k, c = droite(60, 650); xbord = 14
    else:
        k, c = droite(1250, fin_d - 60); xbord = fin_d - 14
    th = math.atan(k)                                   # angle du bord (repère image, y vers le bas)
    u = np.array([math.cos(th), math.sin(th)])          # le long du bord
    n = np.array([-math.sin(th), math.cos(th)])         # vers l'intérieur (le bas)
    if n[1] < 0: n = -n
    p0 = np.array([0.0, c])                             # point du bord en x = 0
    d = JANTE
    for i, texte in enumerate([titre] + lignes):
        taille = 40 if i == 0 else 32
        h = taille * 1.35
        # longueur disponible à la profondeur la plus grande de la bande (là où le triangle est le plus étroit)
        q = p0 + (d + h) * n
        s1 = (xbord - q[0]) / u[0]                      # bord gauche / droit du tablier
        s2 = (BAS - q[1]) / u[1]                        # limite basse
        lo, hi = sorted((s1, s2))
        long = (hi - lo) - 30
        ft = ImageFont.truetype(POLICE, taille)
        while ft.getlength(texte) > long and taille > 18:
            taille -= 1; ft = ImageFont.truetype(POLICE, taille)
        h = taille * 1.35
        w = int(ft.getlength(texte)) + 36
        calque = Image.new('RGBA', (w, int(h)), (0, 0, 0, 0))
        dr = ImageDraw.Draw(calque)
        if i == 0:
            dr.rounded_rectangle((0, 0, w - 1, int(h) - 1), radius=8, fill=ROUGE)
            dr.text((w / 2, h / 2), texte, font=ft, fill=BLANC, anchor='mm')
        else:
            dr.text((w / 2, h / 2), texte, font=ft, fill=CREME, anchor='mm')
        # calée contre le bord extérieur du tablier (côté large du triangle), à mi-profondeur de la bande
        qc = p0 + (d + h / 2) * n
        sens = 1 if cote == 'g' else -1                 # du bord extérieur vers la pointe du V, le long de u
        centre = qc + ((xbord - qc[0]) / u[0] + sens * (w / 2 + 20)) * u
        r = calque.rotate(-math.degrees(th), resample=Image.BICUBIC, expand=True)
        tex.alpha_composite(r, (int(centre[0] - r.width / 2), int(centre[1] - r.height / 2)))
        d += h + (10 if i == 0 else 2)


for cote, (titre, lignes) in zip('gd', CARTES):
    ecrire(cote, titre, lignes)
tex.transpose(Image.FLIP_TOP_BOTTOM).save(chemin)
print(f'{g["texture"]} : instructions déplacées dans les triangles du tablier')
