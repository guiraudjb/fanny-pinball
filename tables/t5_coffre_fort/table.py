#!/usr/bin/env python3
"""Table vierge 5 : COFFRE-FORT. Un coffre (trou) au fond d'une alcôve fermée par trois cibles tombantes, une rampe
en virage terminée par un verrou (trou sur la rampe), un couloir droit avec tourniquet, quatre couloirs du haut,
kickback à gauche. Défi : le chrono (valeur qui fond tant que le coffre n'est pas touché).

  python3 table.py    → sortie/ (puis ./construire.sh)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'moteur'))
from plan import Table, cadre, arc, epaissir, CX

t = Table('CoffreFort', 'Coffre-fort', 'chrono et verrou', [
    'Les 3 cibles tombées : CHRONO, la valeur du coffre fond',
    'Bille dans le coffre avant la fin : la valeur restante',
    'Rampe : bille verrouillée ; 2 verrous = MULTIBALL',
    'Couloir droit : +5 s au chrono ; tourniquet x5 pendant le chrono',
    'Cibles de gauche : KICKBACK allumé',
    'Couloirs du haut : bonus x2 … x5 (les palettes décalent)',
])
cadre(t, kickback=True)

# couloirs du haut
for x in (137, 187, 237, 287, 337):
    t.rail([(x, 100), (x, 165)], 7, 35)
for i, x in enumerate((162, 212, 262, 312)):
    t.couloir(f'Haut{i + 1}', x, 135)
    t.lampe(f'haut{i}', x, 190, 10, '#ffd23f', str(i + 1))

for i, (x, y) in enumerate([(130, 260), (344, 260)]):
    t.bumper(f'Bumper{i + 1}', x, y)

# alcôve du coffre : deux parois et un toit, trois cibles tombantes devant, le coffre au fond
t.mur(epaissir([(194, 398), (194, 266), (280, 266), (280, 398)], 8), 40, 'Mur', nom='Alcove')
t.trou('Coffre', CX, 318, ejection=(180, 7))
t.banque('Porte', 199, 390, 275, 390, 3)
for i in range(3):
    t.lampe(f'porte{i}', 212 + 25 * i, 425, 7, '#ff7a1a')
t.fleche('coffre', CX, 470, 0, '#33d17a')
t.lampe('chrono', CX, 520, 12, '#e01b24', 'C')

# couloir droit et tourniquet
t.rail([(428, 300), (428, 600)], 8, 40)
t.tourniquet('Tourniquet', 452, 470, 0, 34)
t.couloir('CouloirDroit', 452, 380)
t.fleche('couloird', 452, 630, 0, '#33d17a')

# cibles debout de gauche : kickback
t.cible('CibleK1', 22, 590)
t.cible('CibleK2', 22, 630)
t.lampe('ck0', 54, 586, 7, '#c061cb')
t.lampe('ck1', 54, 626, 7, '#c061cb')

# rampe du verrou : montée, virage à gauche, palier où le trou garde la bille
chemin = [(130, 700), (130, 480)] + arc(85, 480, 45, 90, 0)[1:] + [(50, 435)]
t.rampe('Rampe', chemin, [(0, 0), (190, 60), (1, 60)], capteurs=[('CapteurRampe', 240)])
t.trou('Verrou', 62, 435, ejection=(90, 4), r=18, surface='Rampe2')
t.fleche('rampe', 130, 745, 0, '#ffffff')
t.lampe('verrou0', 105, 790, 8, '#3584e4', '1')
t.lampe('verrou1', 155, 790, 8, '#3584e4', '2')

for i, m in enumerate((2, 3, 4, 5)):
    t.lampe(f'x{m}', CX - 45 + 30 * i, 1000, 9, '#f6d32d', f'{m}X')
t.lampe('extra', CX, 950, 11, '#3584e4', 'EB')
t.lampe('sauve', CX, 1080, 10, '#57e389', 'S')
t.etiquette(CX, 290, 'COFFRE', 7)
t.etiquette(130, 820, 'VERROU', 8)
t.vitesse_lanceur = 30.0
t.ecrire(os.path.dirname(os.path.abspath(__file__)))
