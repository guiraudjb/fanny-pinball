#!/usr/bin/env python3
"""Vérification sans IA de la composition d'une table du studio, avant fabrication et essais sur la Batocera.

    python3 moteur/verifier.py <dossier de la table>

Contrôles : éléments dans le haut libre (sous l'arche, au-dessus du bas de Fanny, à gauche du couloir du lanceur),
chevauchements, passages trop étroits pour la bille (bille coincée), cibles tournées vers les palettes, rampes.
Rend une liste de (niveau, message) ; niveau 'erreur' (la table ne doit pas être fabriquée) ou 'alerte'.
Le balayage sur la Batocera (moteur/essai.sh <table> balayage) reste le juge final des blocages.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan
from plan import BALL_R, HAUT_LIBRE, dist_polygone, dans_polygone

PASSAGE = 2 * BALL_R + 4          # écart minimal entre deux obstacles pour que la bille passe sans se coincer
FERME = 12.0                      # en dessous, la bille n'entre pas dans l'interstice (fermé)


def ecart(a, b):
    """écart entre deux obstacles (cercle (x, y, r) ou polygone) : < 0 chevauchement"""
    if a[0] == 'rond' and b[0] == 'rond':
        return math.hypot(a[1] - b[1], a[2] - b[2]) - a[3] - b[3]
    if a[0] == 'poly':
        a, b = b, a
    if a[0] == 'rond' and b[0] == 'poly':
        d = dist_polygone(a[1], a[2], b[1])
        return -1 if dans_polygone(a[1], a[2], b[1]) else d - a[3]
    pa, pb = a[1], b[1]                                   # deux polygones : distance des sommets (approchée)
    if any(dans_polygone(x, y, pb) for x, y in pa) or any(dans_polygone(x, y, pa) for x, y in pb):
        return -1
    return min(min(dist_polygone(x, y, pb) for x, y in pa), min(dist_polygone(x, y, pa) for x, y in pb))


def verifier(dossier):
    t, F, elements, base = plan.table_studio(dossier)
    msgs = []
    err = lambda m: msgs.append(('erreur', m))
    alerte = lambda m: msgs.append(('alerte', m))
    nouveaux = lambda cle: getattr(t, cle)[base.get(cle, 0):]

    def dans_haut(nom, x, y, r=0):
        if y + r > HAUT_LIBRE:
            err(f'{nom} : trop bas (y {y:.0f}), le bas de table de Fanny commence à y {HAUT_LIBRE:.0f}')
        elif x + r > plan.XD - 2 or not t.dans_jeu(x, y):
            err(f'{nom} : hors du plateau ou dans le couloir du lanceur ({x:.0f}, {y:.0f})')

    obst = []                                             # (nom, forme, groupe) des obstacles composés
    for b in nouveaux('bumpers'):
        dans_haut(b['nom'], b['x'], b['y'], b['r'])
        obst.append((b['nom'], ('rond', b['x'], b['y'], b['r']), None))
    for c in nouveaux('cibles'):
        dans_haut(c['nom'], c['x'], c['y'], 12)
        obst.append((c['nom'], ('rond', c['x'], c['y'], 12), 'cible'))
        vise = plan.direction(t.visee(c['x'], c['y']))
        if c['nx'] * vise[0] + c['ny'] * vise[1] < math.cos(math.radians(60)):
            alerte(f"{c['nom']} : cible non tournée vers les palettes (face imposée dans la composition)")
    for tr in nouveaux('trous'):
        dans_haut(tr['nom'], tr['x'], tr['y'], tr['r'])
    for tq in nouveaux('tourniquets'):
        dans_haut(tq['nom'], tq['x'], tq['y'], tq['long'] / 2)
    for l in nouveaux('lampes'):
        dans_haut(f"lampe {l['nom']}", l['x'], l['y'], 0)
    for c in nouveaux('couloirs'):
        if c['forme'] != 'invisible' or not c.get('surface'):
            dans_haut(c['nom'], c['x'], c['y'])
    for i, m in enumerate(nouveaux('murs')):
        if not m['collision'] or m['nom'] and m['nom'].startswith(('Jupe', 'Fond')):
            continue
        nom = m['nom'] or f'poteau/guide {i + 1}'
        for x, y in m['pts']:
            if y > HAUT_LIBRE + 40 or x > plan.XD + 2:
                err(f'{nom} : déborde dans le bas de table ou le couloir du lanceur ({x:.0f}, {y:.0f})')
                break
        obst.append((nom, ('poly', [tuple(p) for p in m['pts']]), None))
    for r in nouveaux('rampes'):
        x, y = r['chemin'][0]
        dans_haut(f"{r['nom']} (entrée)", x, y)
        for x, y in r['chemin']:
            if not t.dans_jeu(x, y) and y < HAUT_LIBRE:
                err(f"{r['nom']} : le tracé sort du plateau ({x:.0f}, {y:.0f})")
                break
    # obstacles entre eux, et contre le cadre (arche, bords, paroi du lanceur)
    cadre = [(m['nom'] or 'cadre', ('poly', [tuple(p) for p in m['pts']]), 'cadre') for m in t.murs[:base['murs']]
             if m['collision'] and m['nom'] and m['nom'].startswith(('Arche', 'Bord', 'ParoiLanceur', 'TeteParoi'))]
    for i, (na, fa, ga) in enumerate(obst):
        for nb, fb, gb in obst[i + 1:] + cadre:
            e = ecart(fa, fb)
            if ga == gb == 'cible' and e < PASSAGE:       # cibles d'une même banque : elles font un mur
                continue
            if e < 0:
                err(f'{na} et {nb} se chevauchent')
            elif FERME < e < PASSAGE:                     # assez large pour qu'elle y entre, trop étroit pour qu'elle passe
                alerte(f'{na} – {nb} : passage de {e:.0f} mm, la bille ({2 * BALL_R:.0f} mm) peut s\'y coincer')
    if not elements:
        alerte('composition vide : haut du plateau vierge')
    return msgs


if __name__ == '__main__':
    m = verifier(sys.argv[1])
    for niv, txt in m:
        print(f'{niv.upper():7} {txt}')
    print('OK' if not any(n == 'erreur' for n, _ in m) else 'ERREURS')
    sys.exit(1 if any(n == 'erreur' for n, _ in m) else 0)
