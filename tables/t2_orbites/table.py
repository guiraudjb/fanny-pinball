#!/usr/bin/env python3
"""Table vierge 2 : ORBITES. Une orbite complète (couloir le long des bords gauche, haut et droit, tourniquet à
gauche), une rampe centrale en demi-tour qui rend la bille au retour droit, quatre cibles debout O-R-B-E, trois
bumpers dans la boucle. Défi : les combos (tirs majeurs enchaînés).

  python3 table.py    → sortie/ (puis ./construire.sh)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'moteur'))
from plan import Table, cadre, arc, CX

REGLES = [
    'Orbites et rampe : tirs majeurs ; enchaînés en 4 s = COMBO',
    'COMBO x2 … x5 : chaque tir vaut plus ; x5 = SUPER COMBO',
    'SUPER COMBO : EXTRA BALL à la rampe',
    'O-R-B-E : bonus x2 … x5 ; deux fois = MULTIBALL à la rampe',
    'Multiball : orbites = JACKPOT',
    'Tourniquet : 100 x niveau des orbites',
]


def plan(t, textes={}):
    """géométrie de la table (réutilisée par les habillages, ex. ../speedway) ; textes : étiquettes du plateau"""
    cadre(t)

    # orbite complète : entrée gauche (y 600), le long des bords gauche, haut et droit, sortie par le couloir droit
    # (entre le guide x 433 et la paroi du lanceur) ; un tir dans une orbite ressort par l'autre. Le lanceur la rejoint
    # en haut à droite (portillon : pas de retour dans le couloir du lanceur) et part vers la gauche.
    # Ouverture de 130 mm dans le guide du haut, au-dessus des bumpers : une bille rapide la franchit et fait le tour,
    # une bille lente (ou un lancement dosé) tombe dans les bumpers.
    t.rail([(42, 600), (42, 150)] + arc(150, 150, 108, -90, 0)[1:] + [(200, 42)], 8, 40, nom='GuideOrbiteG')
    t.rail([(330, 42), (391, 42)] + arc(391, 84, 42, 0, 90)[1:] + [(433, 600)], 8, 40, nom='GuideOrbiteD')
    t.tourniquet('Tourniquet', 19, 450, 0, 32)
    t.couloir('OrbiteG', 19, 540, forme='invisible', dx=16, dy=10)
    t.couloir('OrbiteD', 455, 540, forme='invisible', dx=16, dy=10)
    t.fleche('orbg', 21, 640, 0, '#33d17a')
    t.fleche('orbd', 455, 640, 0, '#33d17a')
    t.lampe('spin', 19, 400, 8, '#f6d32d')

    # déflecteur au-dessus de la colonne de cibles : une bille tombée du haut ne reste pas sur le dos de la cible du haut
    t.rail([(46, 236), (92, 276)], 8, 40, nom='DeflecteurCibles')

    # bumpers sous l'ouverture du haut
    for i, (x, y) in enumerate([(180, 158), (268, 140), (222, 232)]):
        t.bumper(f'Bumper{i + 1}', x, y)

    # cibles debout O-R-B-E en colonne à gauche, tournées vers la palette droite (à droite, la descente de la
    # rampe couperait le tir)
    for i, y in enumerate((300, 350, 400, 450)):
        t.cible('Cible' + 'ORBE'[i], 62, y)
        t.lampe('c' + 'orbe'[i], 96, y - 4, 9, '#c061cb', textes.get('lettres', 'ORBE')[i])

    # rampe centrale : montée, demi-tour à droite, descente vers le retour droit
    chemin = [(237, 620), (237, 440)] + arc(282, 440, 45, -90, 90)[1:] + [(405, 600), (405, 825)]
    t.rampe('Rampe', chemin, [(0, 0), (40, 7), (180, 42), (321, 42), (1, 34)], capteurs=[('CapteurRampe', 250)])   # adoucie : 42 mm, départ progressif (60 mm d'un trait : tir v30 juste)
    t.fleche('rampe', 237, 670, 0, '#ffffff')
    t.lampe('mb', 237, 720, 12, '#e01b24', 'MB')

    # niveau de combo, extra ball, sauvetage
    for i in range(5):
        t.lampe(f'combo{i + 1}', CX - 60 + 30 * i, 1000, 9, '#ff7a1a', f'{i + 1}')
    t.lampe('extra', CX, 950, 11, '#3584e4', 'EB')
    for i, m in enumerate((2, 3, 4, 5)):                     # multiplicateur de bonus (lettres complétées)
        t.lampe(f'x{m}', CX - 45 + 30 * i, 1040, 9, '#f6d32d', f'{m}X')
    t.lampe('sauve', CX, 1080, 10, '#57e389', 'S')
    t.etiquette(CX, 1030, textes.get('combo', 'COMBO'), 8)
    t.etiquette(19, 600, textes.get('orbite', 'ORBITE'), 7, angle=90)
    t.etiquette(237, 770, textes.get('rampe', 'RAMPE'), 9)
    t.vitesse_lanceur = 40.0      # orbite complète au lancement (30, réglage de Fanny : la bille retombe du coin)


if __name__ == '__main__':
    t = Table('Orbites', 'Orbites', 'orbites et combos', REGLES)
    plan(t)
    t.ecrire(os.path.dirname(os.path.abspath(__file__)))
