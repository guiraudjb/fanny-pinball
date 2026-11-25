#!/usr/bin/env python3
"""Table 0 : UNIVERSELLE. Base commune des nouvelles tables : châssis, planche et bas de table de Fanny Pinball à
l'identique (couloirs du bas, guides, lance-pierres, palettes, tablier, lanceur et portillon), haut du plateau
vierge, aucun insert lumineux (les emplacements sont libres pour la composition de chaque table).

  python3 table.py    → sortie/table.json, entete.vbs, images (puis ./construire.sh)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'moteur'))
import plan
plan.XD, plan.CX = 478.0, 239.0          # géométrie de Fanny : paroi du lanceur à 478 mm, axe des palettes à 239 mm
from plan import Table, cadre_fanny

REGLES = [
    'Base universelle : planche et bas de table de Fanny Pinball',
    'Haut du plateau vierge, à composer',
    'Lance-pierres : 10 ; couloirs de retour : 500 ; sorties : 1 000',
]


def plan_universel(t):
    cadre_fanny(t)


if __name__ == '__main__':
    t = Table('Universelle', 'Universelle', 'base Fanny Pinball', REGLES)
    plan_universel(t)
    t.ecran_fanny = True                    # écran : disposition de Fanny (fronton assemblé, signature)
    t.vitesse_lanceur = 30.3                # LANCEUR_V de Fanny
    t.deco = dict(c1='#d0d4da', c2='#2b2f36', c3='#5e6672', titre='UNIVERSELLE', elastique='#c01c28')
    t.blurb = 'Base universelle : châssis, planche et bas de table de Fanny Pinball, haut vierge.'
    t.ecrire(os.path.dirname(os.path.abspath(__file__)))
