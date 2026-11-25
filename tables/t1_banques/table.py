#!/usr/bin/env python3
"""Table vierge 1 : BANQUES. Deux banques de cibles tombantes (3 au centre, 5 à droite), un coffre (trou à droite),
une rampe à gauche en demi-tour qui rend la bille au retour gauche, trois couloirs du haut, trois bumpers.

  python3 table.py    → sortie/table.json, entete.vbs, images (puis ../moteur/construire.sh t1_banques)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'moteur'))
from plan import Table, cadre, arc, CX, sym

t = Table('Banques', 'Banques', 'cibles tombantes', [
    'Banque du centre : ouvre le COFFRE (trou de droite)',
    'COFFRE ouvert : 10 000 x banques tombées',
    'Les deux banques sur la même bille : MULTIBALL au COFFRE',
    'Multiball : RAMPE = JACKPOT (+5 000 à chaque fois)',
    '3 rampes : EXTRA BALL au COFFRE',
    'A-B-C : bonus x2 … x5 (les palettes décalent)',
])
cadre(t)

# couloirs du haut A B C et leurs guides
for x in (147, 207, 267, 327):
    t.rail([(x, 100), (x, 165)], 7, 35)
for i, x in enumerate((177, 237, 297)):
    t.couloir(f'Haut{"ABC"[i]}', x, 135)
    t.lampe(f'haut{i}', x, 190, 11, '#ffd23f', 'ABC'[i])

# bumpers
for i, (x, y) in enumerate([(180, 255), (294, 255), (237, 335)]):
    t.bumper(f'Bumper{i + 1}', x, y)

# banque du centre (3 cibles tombantes face au joueur) et banque de droite (5, tournée vers la palette gauche)
for i, nm in enumerate(t.banque('Centre', 197, 520, 277, 520, 3)):
    t.lampe(f'centre{i}', 210 + 27 * i - 13.5 + 0.5, 560, 8, '#ff7a1a')
for i, nm in enumerate(t.banque('Droite', 325, 620, 475, 620, 5)):
    c = next(c for c in t.cibles if c['nom'] == nm)
    t.lampe(f'droite{i}', c['x'] + c['nx'] * 34, c['y'] + c['ny'] * 34, 8, '#ff7a1a')

# coffre : trou en haut à droite, rend la bille vers le bas à gauche
t.trou('Coffre', 420, 345, ejection=(215, 9))
t.fleche('coffre', 385, 395, 40, '#33d17a')
t.lampe('mb', 237, 650, 13, '#e01b24', 'MB')
t.lampe('extra', 237, 960, 12, '#3584e4', 'EB')

# deux cibles debout à droite de la banque du centre (tir de la palette gauche ; à gauche, la rampe masquerait le tir)
for i, (x, y) in enumerate([(298, 505), (333, 514)]):
    t.cible(f'CibleH{i + 1}', x, y)
    t.lampe(f'cibleh{i}', *t.devant(x, y, 30), 7, '#c061cb')

# rampe gauche : montée vers le haut, demi-tour à gauche, descente le long du bord, chute sur le retour gauche
chemin = [(150, 670), (150, 470)] + arc(105, 470, 45, 90, -90)[1:] + [(60, 825)]
t.rampe('RampeG', chemin, [(0, 0), (190, 60), (335, 60), (1, 42)], capteurs=[('CapteurRampeG', 300)])
t.fleche('rampe', 150, 715, 0, '#ffffff')

# multiplicateur de bonus et sauvetage de bille
for i, m in enumerate((2, 3, 4, 5)):
    t.lampe(f'x{m}', CX - 45 + 30 * i, 1000, 9, '#f6d32d', f'{m}X')
t.lampe('sauve', CX, 1080, 10, '#57e389', 'S')

t.etiquette(420, 300, 'COFFRE', 9)
t.etiquette(237, 498, 'BANQUE CENTRE', 8)
t.etiquette(150, 745, 'RAMPE', 9)
t.vitesse_lanceur = 30.0
t.ecrire(os.path.dirname(os.path.abspath(__file__)))
