#!/usr/bin/env python3
"""Table vierge 4 : DOUBLE RAMPE. Deux rampes symétriques en demi-tour (la gauche rend la bille au retour gauche, la
droite au retour droit), un trou JACKPOT au centre derrière un tourniquet, deux cibles rondes, deux couloirs du
haut. Défi : l'aller-retour (alterner les rampes).

  python3 table.py    → sortie/ (puis ./construire.sh)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'moteur'))
from plan import Table, cadre, arc, CX, sym

t = Table('DoubleRampe', 'Double rampe', 'aller-retour', [
    'Rampe gauche puis droite (ou l’inverse) : ALLER-RETOUR',
    'Chaque aller-retour vaut plus ; 6 = MULTIBALL',
    'Multiball : JACKPOT au trou du centre',
    'Cibles rondes : EXTRA BALL au trou du centre',
    'Couloirs du haut : bonus x2 … x5',
    'Tourniquet : 100 (x2 en multiball)',
])
cadre(t)

# couloirs du haut
for x in (177, 237, 297):
    t.rail([(x, 100), (x, 165)], 7, 35)
for i, x in enumerate((207, 267)):
    t.couloir(f'Haut{i + 1}', x, 135)
    t.lampe(f'haut{i}', x, 190, 10, '#ffd23f', str(i + 1))

for i, (x, y) in enumerate([(160, 250), (314, 250), (CX, 320)]):
    t.bumper(f'Bumper{i + 1}', x, y)

# cibles rondes de part et d'autre du trou jackpot (entre les deux rampes, qui masqueraient les côtés)
for nm, x in (('RondeG', 185), ('RondeD', sym(185))):
    t.cible(nm, x, 470, genre='ronde')
    t.lampe(nm.lower(), *t.devant(x, 470, 30), 8, '#c061cb')

# trou jackpot au centre, tourniquet devant
t.trou('Jackpot', CX, 430, ejection=(180, 8))
t.tourniquet('Tourniquet', CX, 560, 0, 34)
t.fleche('jackpot', CX, 495, 0, '#e01b24', texte='J')

# deux rampes symétriques
chemin = [(150, 690), (150, 480)] + arc(105, 480, 45, 90, -90)[1:] + [(60, 825)]
t.rampe('RampeG', chemin, [(0, 0), (190, 60), (350, 60), (1, 42)], capteurs=[('CapteurRampeG', 310)])
t.rampe('RampeD', [(sym(x), y) for x, y in chemin], [(0, 0), (190, 60), (350, 60), (1, 42)], capteurs=[('CapteurRampeD', 310)])
t.fleche('rampeg', 150, 735, 0, '#ffffff')
t.fleche('ramped', sym(150), 735, 0, '#ffffff')
for i in range(6):
    t.lampe(f'ar{i}', CX - 50 + 20 * i, 640, 7, '#ff7a1a')
t.etiquette(CX, 615, 'ALLER-RETOUR', 7)

for i, m in enumerate((2, 3, 4, 5)):
    t.lampe(f'x{m}', CX - 45 + 30 * i, 1000, 9, '#f6d32d', f'{m}X')
t.lampe('extra', CX, 950, 11, '#3584e4', 'EB')
t.lampe('sauve', CX, 1080, 10, '#57e389', 'S')
t.etiquette(CX, 400, 'JACKPOT', 8)
t.vitesse_lanceur = 30.0
t.ecrire(os.path.dirname(os.path.abspath(__file__)))
