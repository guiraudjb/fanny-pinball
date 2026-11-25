#!/usr/bin/env python3
"""Table vierge 3 : TROIS PALETTES. Une palette haute à droite, une rampe le long du bord gauche qui dépose la bille
au-dessus des couloirs du haut, quatre cibles debout Q-U-A-T (à gauche, sous la rampe), un trou MYSTÈRE au centre,
un kickback dans la sortie gauche. Défi : les récompenses mystère.

  python3 table.py    → sortie/ (puis ./construire.sh)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'moteur'))
from plan import Table, cadre, arc, CX

t = Table('TroisPalettes', 'Trois palettes', 'palette haute et mystère', [
    'Couloirs 1-2-3 : MYSTERE allumé au trou du centre (et bonus x2 … x5)',
    'MYSTERE : points, kickback, extra ball, bonus ou multiball',
    'Q-U-A-T (cibles de gauche) : KICKBACK allumé',
    'Rampe : la bille retombe sur les couloirs du haut',
    '3 rampes : MULTIBALL au trou du centre',
    'Multiball : RAMPE = JACKPOT',
])
cadre(t, kickback=True)

# palette haute, à droite
t.palette('PaletteHaute', 452, 545, 'D', long=50)
t.lampe('haute', 420, 610, 7, '#f6d32d')

# couloirs du haut 1 2 3
for x in (207, 267, 327, 387):
    t.rail([(x, 175), (x, 235)], 7, 35)
for i, x in enumerate((237, 297, 357)):
    t.couloir(f'Haut{i + 1}', x, 205)
    t.lampe(f'haut{i}', x, 258, 10, '#ffd23f', str(i + 1))

# bumpers
for i, (x, y) in enumerate([(285, 330), (380, 330), (332, 410)]):
    t.bumper(f'Bumper{i + 1}', x, y)

# trou mystère au centre
t.trou('Mystere', CX, 470, ejection=(185, 8))
t.fleche('mystere', CX, 530, 0, '#33d17a', texte='?')
t.lampe('mb', CX, 600, 12, '#e01b24', 'MB')

# cibles Q-U-A-T à gauche, assez haut pour que le tir de la palette droite passe sous la rampe déjà en hauteur
for i, y in enumerate((145, 180, 215, 250)):
    t.cible('Cible' + 'QUAT'[i], 22, y)
    t.lampe('c' + 'quat'[i], 52, y, 8, '#c061cb', 'QUAT'[i])

# rampe gauche : monte le long du bord, tourne à droite et dépose la bille au-dessus des couloirs du haut
chemin = [(125, 690), (95, 560), (90, 215)] + arc(170, 215, 80, -90, 0)[1:] + [(205, 135)]
t.rampe('Rampe', chemin, [(0, 0), (40, 8), (200, 48), (1, 40)], capteurs=[('CapteurRampe', 420)])   # adoucie : 48 mm, départ progressif (60 mm : seul le tir fort passait)
t.fleche('rampe', 130, 735, -13, '#ffffff')

for i, m in enumerate((2, 3, 4, 5)):
    t.lampe(f'x{m}', CX - 45 + 30 * i, 1000, 9, '#f6d32d', f'{m}X')
t.lampe('extra', CX, 950, 11, '#3584e4', 'EB')
t.lampe('sauve', CX, 1080, 10, '#57e389', 'S')
t.etiquette(CX, 440, 'MYSTERE', 8)
t.etiquette(130, 770, 'RAMPE', 9)
t.vitesse_lanceur = 30.0
t.ecrire(os.path.dirname(os.path.abspath(__file__)))
