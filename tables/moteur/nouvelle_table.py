#!/usr/bin/env python3
"""Nouvelle table du studio : clone TOUJOURS la table universelle (t0_universelle), avec son cadrage validé.

    python3 moteur/nouvelle_table.py <dossier> "<Titre>" ["sous-titre"]

Crée tables/<dossier>/ : table.py et construire.sh (génériques), regles.vbs (règles de base de l'universelle,
à compléter), fiche.json (titre, textes, couleurs) et composition.json vide (haut du plateau à composer).
"""
import json
import os
import re
import shutil
import sys
import unicodedata

ICI = os.path.dirname(os.path.abspath(__file__))
TABLES = os.path.dirname(ICI)
MODELE = os.path.join(TABLES, 't0_universelle')


def nom_fichier(titre):
    s = unicodedata.normalize('NFKD', titre).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Za-z0-9]+', '', s.title()) or 'Table'


def creer(dossier, titre, sous_titre=''):
    cible = os.path.join(TABLES, dossier)
    if os.path.exists(cible):
        raise SystemExit(f'{cible} existe déjà')
    os.makedirs(cible)
    for f in ('table.py', 'construire.sh', 'regles.vbs'):
        shutil.copy2(os.path.join(MODELE, f), os.path.join(cible, f))
    fiche = json.load(open(os.path.join(MODELE, 'fiche.json')))
    fiche.update(nom=nom_fichier(titre), titre=titre, sous_titre=sous_titre, blurb=f'{titre} : table du studio sur la base Fanny Pinball.',
                 regles=['Lance-pierres : 10 ; couloirs de retour : 500 ; sorties : 1 000'])
    fiche['deco'] = dict(fiche['deco'], titre=titre.upper())
    json.dump(fiche, open(os.path.join(cible, 'fiche.json'), 'w'), ensure_ascii=False, indent=1)
    json.dump({'elements': []}, open(os.path.join(cible, 'composition.json'), 'w'), ensure_ascii=False, indent=1)
    return cible


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    print(creer(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ''))
