#!/usr/bin/env python3
"""Table du studio de flippers : fiche.json (titre, textes, couleurs, habillage) et composition.json (éléments du haut
du plateau) posés sur la base universelle de Fanny Pinball (moteur/plan.py table_studio : châssis, planche et bas de
table de Fanny à l'identique, écran de Fanny, cadrage validé).

  python3 table.py    → sortie/table.json, entete.vbs, images (puis ./construire.sh)
"""
import os, sys
ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, '..', 'moteur'))
import plan

if __name__ == '__main__':
    plan.ecrire_studio(ICI)
