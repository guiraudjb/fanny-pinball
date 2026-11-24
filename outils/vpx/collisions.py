#!/usr/bin/env python3
"""Colliders de la version d'origine pour la table VPX.

La physique du jeu (js/sim.js, Rapier) ne repose pas sur le plan 2D mais sur les colliders 3D de la CAO
(assets/cao/collision.glb), exportés pour la version native dans natif/donnees/monde.json : parois convexes,
poteaux cylindriques, surfaces maillées (rampe et ses pattes, bloc F-A-N-N-Y, mur des cibles, guides, plastiques…).
On les reprend tels quels comme primitives VPX invisibles et collidables : la bille rencontre exactement les mêmes
volumes que dans le jeu. Les éléments qui ont un rôle de jeu (bumpers, lance-pierres, cibles, capteurs, Cercle,
portillon) restent des éléments VPX ; le plateau et la vitre aussi.

Sortie : outils/vpx/donnees/collisions/ (même format que donnees/decor : collisions.json + c###.bin)
  python3 outils/vpx/collisions.py
"""
import json, os, shutil
import numpy as np
from scipy.spatial import ConvexHull

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '../..'))
MM = 1 / 0.54
SORTIE = os.path.join(ICI, 'donnees/collisions')
shutil.rmtree(SORTIE, ignore_errors=True)
os.makedirs(SORTIE)
monde = json.load(open(os.path.join(RACINE, 'natif/donnees/monde.json')))

# rôles gérés par des éléments VPX (ils ont déjà leur propre collision)
ROLES_VPX = {'bumper', 'sling', 'drop', 'standup', 'target', 'lane', 'lowerLane', 'saucer', 'ramp'}


def quat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def coque(P):
    """Enveloppe convexe, triangles orientés vers l'extérieur (règle de la main droite)."""
    h = ConvexHull(P)
    c = P.mean(0)
    T = []
    for s in h.simplices:
        a, b, d = P[s]
        if np.dot(np.cross(b - a, d - a), a - c) < 0:
            s = s[::-1]
        T.append(s)
    return np.array(T)


def cylindre(r, demi_h, n=20):
    """Cylindre Rapier : axe local y."""
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    bas = np.c_[r * np.cos(a), np.full(n, -demi_h), r * np.sin(a)]
    haut = np.c_[r * np.cos(a), np.full(n, demi_h), r * np.sin(a)]
    P = np.vstack([bas, haut])
    return P, coque(P)


groupes = []
total = 0
for k, f in enumerate(monde['fixes']):
    role = f.get('role') or {}
    t = role.get('type') if isinstance(role, dict) else None
    fo = f['forme']
    if f['capteur'] or t in ROLES_VPX:
        continue
    if fo['type'] == 'pave':
        continue                         # plateau, vitre, butée du portillon : VPX a les siens
    if fo['type'] == 'convexe':
        P = np.array(fo['pts'], float).reshape(-1, 3)
        T = coque(P)
    elif fo['type'] == 'cylindre':
        P, T = cylindre(fo['r'], fo['demiH'])
    elif fo['type'] == 'maillage':
        P = np.array(fo['pts'], float).reshape(-1, 3)
        T = np.array(fo['idx'], np.int64).reshape(-1, 3)
        # Rapier : les maillages collisionnent des deux côtés ; vpinball : seulement côté normale. Sans la face
        # retournée, une bille arrivant par l'arrière (dessous du bord d'entrée de la rampe…) traverse la surface.
        T = np.vstack([T, T[:, ::-1]])
    else:
        continue
    W = P @ quat(f['rot']).T + np.array(f['pos'])           # repère table, mètres, z vers le dessous
    V = np.c_[W[:, 0] * 1000 * MM, W[:, 1] * 1000 * MM, -W[:, 2] * 1000 * MM]
    T = T[:, ::-1]                                           # z retourné : même convention que le décor
    # normales par sommet (moyenne des faces) : seules les faces comptent pour la collision
    N = np.zeros_like(V)
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    for j in range(3):
        np.add.at(N, T[:, j], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    nom = f'c{len(groupes):03d}.bin'
    with open(os.path.join(SORTIE, nom), 'wb') as fh:
        fh.write(np.c_[V, N, np.zeros((len(V), 2))].astype('<f4').tobytes())
        fh.write(T.astype('<u4').tobytes())
    groupes.append({'fichier': nom, 'nom': role.get('nom') or t or fo['type'], 'forme': fo['type'], 'sommets': len(V), 'triangles': len(T),
                    'rebond': f['rebond'], 'frottement': f['frottement'], 'caoutchouc': f.get('caoutchouc'),
                    'min': V.min(0).round(1).tolist(), 'max': V.max(0).round(1).tolist()})
    total += len(T)
json.dump({'groupes': groupes}, open(os.path.join(SORTIE, 'collisions.json'), 'w'), indent=1)
print(f'{len(groupes)} colliders, {total} triangles → {SORTIE}')

# ------------------------------------------------------------------ points d'essai (balayage des zones de blocage)
# Grille de 20 mm sur le plateau : points où une bille posée ne touche aucun collider à hauteur de plateau
# (triangles entre 0 et 2 rayons de haut, élargis d'un rayon), plus des points sur la rampe.
table = json.load(open(os.path.join(ICI, 'donnees/table.json')))
R_BILLE = table['BALL_R']
PAS = 2.0                                                   # trame d'occupation, mm
nx, ny = int(table['W'] / PAS) + 1, int(table['H'] / PAS) + 1
occ = np.zeros((ny, nx), bool)
gx, gy = np.meshgrid(np.arange(nx) * PAS, np.arange(ny) * PAS)
from matplotlib.path import Path as Chemin
pts_grille = np.c_[gx.ravel(), gy.ravel()]


def remplir(poly):
    poly = np.asarray(poly, float)
    x0, y0 = poly.min(0); x1, y1 = poly.max(0)
    i0, i1 = max(int(y0 / PAS) - 1, 0), min(int(y1 / PAS) + 2, ny)
    j0, j1 = max(int(x0 / PAS) - 1, 0), min(int(x1 / PAS) + 2, nx)
    if i1 <= i0 or j1 <= j0:
        return
    sub = np.c_[gx[i0:i1, j0:j1].ravel(), gy[i0:i1, j0:j1].ravel()]
    occ[i0:i1, j0:j1] |= Chemin(poly).contains_points(sub, radius=PAS).reshape(i1 - i0, j1 - j0)


def trait(a, b):
    n = int(np.hypot(*(b - a)) / (PAS / 2)) + 2
    for t in np.linspace(0, 1, n):
        x, y = a + (b - a) * t
        if 0 <= x < table['W'] and 0 <= y < table['H']:
            occ[int(y / PAS), int(x / PAS)] = True


# 1. murs du plan (emprises pleines : blocs, parois épaisses)
for m in table['murs']:
    remplir(m['pts'])
# 2. colliders d'origine à hauteur de bille : faces remplies et arêtes (les faces verticales n'ont pas d'aire)
for g in groupes:
    a = np.fromfile(os.path.join(SORTIE, g['fichier']), '<f4', count=g['sommets'] * 8).reshape(-1, 8)[:, :3] * 0.54
    T = np.fromfile(os.path.join(SORTIE, g['fichier']), '<u4', offset=g['sommets'] * 32).reshape(-1, 3)
    colonne = g['forme'] in ('convexe', 'cylindre')
    if colonne and a[:, 2].min() < 2 * R_BILLE and a[:, 2].max() > 0.5:
        from scipy.spatial import ConvexHull as CH
        h = CH(a[:, :2]); remplir(a[h.vertices, :2]); continue
    for tri in a[T]:
        if tri[:, 2].min() > 2 * R_BILLE or tri[:, 2].max() < 0.5:
            continue
        remplir(tri[:, :2])
        for u, v in ((0, 1), (1, 2), (2, 0)):
            trait(tri[u, :2], tri[v, :2])
# 3. hors du plateau : au-dessus de l'ellipse du haut
el = monde['geo']['ellipse']
haut = gy < el['cy']
occ |= haut & (((gx - el['cx']) / el['rx']) ** 2 + ((gy - el['cy']) / el['ry']) ** 2 > 1)
# éléments VPX à rôle de jeu (bumpers, cibles, lance-pierres) : leur emprise aussi
for b in table['bumpers']:
    occ |= (gx - b['x']) ** 2 + (gy - b['y']) ** 2 < b['r'] ** 2
for c in table['cibles_tombantes'] + table['cibles_fixes'] + table['cibles_gauche']:
    occ |= (gx - c['x']) ** 2 + (gy - c['y']) ** 2 < 16 ** 2
for s in table['lance_pierres']:
    remplir(s['pts'])
# dilatation d'un rayon de bille (+1 mm)
r = int(np.ceil((R_BILLE + 1) / PAS))
libre = ~occ
dil = occ.copy()
for di in range(-r, r + 1):
    for dj in range(-r, r + 1):
        if di * di + dj * dj <= r * r:
            dil |= np.roll(np.roll(occ, di, 0), dj, 1)
points = []
for y in np.arange(20, table['tablier']['front'] - 30, 20.0):
    for x in np.arange(15, table['geo_play_right'] if 'geo_play_right' in table else 476, 20.0):
        i, j = int(y / PAS), int(x / PAS)
        if not dil[i, j]:
            points.append([round(x * MM, 1), round(y * MM, 1), round(R_BILLE * MM, 1)])
# sur la rampe : profil montée 25°, palier 48 mm, descente jusqu'à 34 mm (cao/modele.py)
rp = table['rampe']; L = rp['longueur']
pente = np.tan(np.radians(rp['pente_entree_deg'])); s_m = rp['z_haut'] / pente
for x, y, s in rp['pts'][::12]:
    z = min(s * pente, rp['z_haut']) if s < L / 3 else rp['z_haut'] + (rp['z_fin'] - rp['z_haut']) * (s - L / 3) / (L * 2 / 3)
    if s > s_m:
        points.append([round(x * MM, 1), round(y * MM, 1), round((z + R_BILLE + 4) * MM, 1)])
json.dump(points, open(os.path.join(SORTIE, 'points_essai.json'), 'w'))
print(f'{len(points)} points d’essai (grille 20 mm + rampe)')
