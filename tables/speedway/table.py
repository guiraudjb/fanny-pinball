#!/usr/bin/env python3
"""SPEEDWAY : habillage « grasstrack & speedway » de la table vierge 2 (Orbites). Même géométrie et mêmes règles,
textes du thème : les orbites sont les tours de piste, la rampe le virage, les combos des dérapages, le multiball
la finale. Illustrations Krea 2 (generer_images.py, choix dans CHOIX), bruitages par synthèse (sons.py),
musiques YuE2 (musique.py → sons/musique_*.mp3).

  python3 table.py    → sortie/ (puis ./construire.sh)
"""
import os, sys
ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, '..', 'moteur'))
sys.path.insert(0, os.path.join(ICI, '..', 't2_orbites'))
from plan import Table
from table import plan                     # géométrie de la table vierge 2

CHOIX = {'plateau': 'plateau_11', 'fronton': 'fronton_11', 'fond': 'fond_23', 'flanc': 'flanc_23'}
art = lambda k: os.path.join(ICI, 'retouche', CHOIX[k] + '.png') if os.path.exists(
    os.path.join(ICI, 'retouche', CHOIX[k] + '.png')) else os.path.join(ICI, 'brut', CHOIX[k] + '.png')

t = Table('Speedway', 'Speedway', 'grasstrack & speedway', [
    'Tours (orbites) et virage (rampe) : enchaînés en 4 s = DÉRAPAGE',
    'Dérapages x2 … x5 ; x5 = DÉRAPAGE PARFAIT : EXTRA BALL au virage',
    'M-O-T-O : bonus x2 … x5 ; deux fois = FINALE au virage',
    'Finale (2 billes) : chaque tour = JACKPOT',
    'Tourniquet : 100 x niveau des tours',
])
plan(t, textes={'combo': 'DÉRAPAGE', 'orbite': 'TOUR', 'rampe': 'VIRAGE', 'lettres': 'MOTO'})
t.art_plateau, t.art_fronton, t.art_fond = art('plateau'), art('fronton'), art('fond')
t.musiques = {'accueil': 'musique_accueil', 'jeu': 'musique_jeu'}
# finition (moteur/decor.py) : jaune et noir des plaques de course, bumpers numérotés, pilote du flanc sur les plastrons
t.deco = dict(c1='#f5c211', c2='#141414', c3='#e01b24', titre='SPEEDWAY', bumper='plaque', elastique='#e01b24',
              art_plastique=art('flanc'), art_cx=0.28)
t.blurb = 'Speedway : grasstrack & speedway (habillage de la table Orbites). Illustrations Krea 2, sons de synthèse, musiques YuE2.'
t.ecrire(ICI)
