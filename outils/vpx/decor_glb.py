#!/usr/bin/env python3
"""Prépare le décor 3D de la table VPX à partir de la scène de la version native (natif/donnees/scene.glb,
exportée de la vue 3D du jeu web par outils/exporter_scene_natif.mjs) : les mêmes pièces, matières et textures
que le jeu d'origine.

Sortie : outils/vpx/donnees/decor/
  decor.json      liste des groupes (un par matière, plus un par pièce mobile) : matière, texture, fichiers
  g###.bin        sommets VPX (x, y, z, nx, ny, nz, u, v en float32, unités VP) puis indices uint32
  t###.png/.jpg   textures (le plateau peint devient la texture du plateau VPX)

Repère : le nœud « table » de la scène est en mm, x à droite, y vers le joueur, z vers le dessous du plateau ;
VPX a le même x et le même y, z vers le haut : on retourne z (et donc l'ordre des sommets des triangles).
On laisse de côté le café (salle_*), les pieds, le fronton (VPX a son propre fond), les inserts lampe_* (les
lampes VPX les remplacent) et le tourniquet (celui de VPX tourne).

  python3 outils/vpx/decor_glb.py [--scene natif/donnees/scene.glb]
  python3 outils/vpx/decor_glb.py --chassis --sortie tables/moteur/chassis
      châssis seul (caisse, baguettes, barre de verrouillage, boîtier du lanceur, boutons, quincaillerie ; sans le
      fronton, les pieds ni la tige du lanceur) : il habille les tables vierges de tables/, aux mêmes dimensions
"""
import argparse, io, json, os, shutil, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb import charger, acc, matrice

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '../..'))
MM = 1 / 0.54
ap = argparse.ArgumentParser()
ap.add_argument('--scene', default=os.path.join(RACINE, 'natif/donnees/scene.glb'))
ap.add_argument('--chassis', action='store_true', help='seulement le châssis (nœud parent de flanc_G)')
ap.add_argument('--bas', action='store_true', help="seulement le bas de table (y > 850 mm : tablier, guides, poteaux, "
                "plastiques des lance-pierres), sans pièces mobiles ni inserts : base des tables universelles")
ap.add_argument('--sortie', default=os.path.join(ICI, 'donnees/decor'))
a = ap.parse_args()
SORTIE = os.path.abspath(a.sortie)
shutil.rmtree(SORTIE, ignore_errors=True)
os.makedirs(SORTIE)

g, binr = charger(a.scene)
noeuds = g['nodes']
table = next(i for i, n in enumerate(noeuds) if n.get('name') == 'table')

EXCLURE_NOEUD = ('dyn_pied', 'dyn_fronton', 'dyn_tourniquet', 'pied', 'salle') \
    + (('dyn_palette', 'dyn_cible', 'dyn_lanceur', 'dyn_tige', 'dyn_bumper') if a.bas else ())   # élastiques ronds des lance-pierres (dyn_sling) gardés
# pièces mobiles animées par le script : nom du groupe VPX → préfixe du nœud
MOBILES = {'dyn_palette_L': 'PrimPaletteG', 'dyn_palette_R': 'PrimPaletteD',
           **{f'dyn_cible_{i}': f'PrimCible{i}' for i in range(5)},
           'dyn_tige_lanceur': 'PrimLanceur', **{f'dyn_lanceur_{i}': 'PrimLanceur' for i in range(8)}}


def srgb(c):
    c = np.clip(np.asarray(c[:3], float), 0, 1)
    s = np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return int(round(s[0] * 255)) << 16 | int(round(s[1] * 255)) << 8 | int(round(s[2] * 255))


textures = {}   # index image glTF → nom de fichier
alpha_tex = {}  # nom de fichier → 'masque' (alpha tout ou rien), 'fondu' (dégradés) ou None


def texture(ti):
    src = g['textures'][ti]['source']
    if src in textures:
        return textures[src]
    im = g['images'][src]
    bv = g['bufferViews'][im['bufferView']]
    data = binr[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
    img = Image.open(io.BytesIO(data))
    alpha = img.mode in ('RGBA', 'LA', 'P') and img.convert('RGBA').getchannel('A').getextrema()[0] < 250
    if alpha:
        nom = f't{src:03d}.png'
        rgba = img.convert('RGBA')
        A = np.asarray(rgba.getchannel('A'))
        alpha_tex[nom] = 'masque' if ((A > 10) & (A < 245)).mean() < 0.05 else 'fondu'
        rgba.save(os.path.join(SORTIE, nom), optimize=True)
    else:
        nom = f't{src:03d}.jpg'
        img.convert('RGB').save(os.path.join(SORTIE, nom), quality=90)
    textures[src] = nom
    return nom


groupes = {}    # clé → {sommets, indices, matiere}


def ajouter(cle, P, N, UV, I, mat):
    gr = groupes.setdefault(cle, {'P': [], 'N': [], 'UV': [], 'I': [], 'n': 0, 'mat': mat})
    gr['P'].append(P); gr['N'].append(N); gr['UV'].append(UV); gr['I'].append(I + gr['n']); gr['n'] += len(P)


def rec(i, M, mobile, exclu):
    nd = noeuds[i]
    nom = nd.get('name') or ''
    M = M @ matrice(nd)
    exclu = exclu or nom.startswith(EXCLURE_NOEUD)
    if nom in MOBILES:
        mobile = MOBILES[nom]
    if 'mesh' in nd and not exclu:
        for p in g['meshes'][nd['mesh']]['primitives']:
            if p.get('mode', 4) != 4:
                continue
            mi = p.get('material')
            m = g['materials'][mi] if mi is not None else {}
            mnom = m.get('name', '')
            if mnom.startswith(('salle_', 'lampe_')):
                continue
            pbr = m.get('pbrMetallicRoughness', {})
            # texture : couleur de base, sinon texture émissive (pièces éclairées de l'intérieur : afficheurs…)
            tinfo = pbr.get('baseColorTexture') or m.get('emissiveTexture') or {}
            tex = tinfo.get('index')
            par_emission = 'baseColorTexture' not in pbr and 'emissiveTexture' in m
            if tex is not None and g['textures'][tex]['source'] == 0:
                continue                                   # plateau peint : c'est la texture du plateau VPX
            P = acc(g, binr, p['attributes']['POSITION']).astype(np.float64)
            W = np.c_[P, np.ones(len(P))] @ M.T
            if a.bas and (W[:, 1].min() < 850 or np.ptp(W[:, 2]) < 0.5):
                continue                                   # haut de table, ou insert à plat
            N = acc(g, binr, p['attributes']['NORMAL']).astype(np.float64) if 'NORMAL' in p['attributes'] else np.zeros_like(P)
            R = np.linalg.inv(M[:3, :3]).T
            N = N @ R.T
            N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
            UV = acc(g, binr, p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in p['attributes'] else np.zeros((len(P), 2), np.float32)
            # KHR_texture_transform (three.js : repeat/offset) : VPX ne le connaît pas, on l'applique aux coordonnées
            tt = tinfo.get('extensions', {}).get('KHR_texture_transform')
            if tt:
                UV = UV * np.asarray(tt.get('scale', [1, 1]), np.float32) + np.asarray(tt.get('offset', [0, 0]), np.float32)
            I = acc(g, binr, p['indices']).reshape(-1, 3).astype(np.uint32) if 'indices' in p else np.arange(len(P), dtype=np.uint32).reshape(-1, 3)
            if np.linalg.det(M[:3, :3]) < 0:
                I = I[:, ::-1]
            # repère VPX : z vers le haut, unités VP ; z retourné → ordre des sommets inversé
            V = np.c_[W[:, 0] * MM, W[:, 1] * MM, -W[:, 2] * MM]
            Nv = np.c_[N[:, 0], N[:, 1], -N[:, 2]]
            I = I[:, ::-1]
            emis = m.get('emissiveFactor', [0, 0, 0])
            mat = {
                'couleur': 0xffffff if par_emission else srgb(pbr.get('baseColorFactor', [1, 1, 1, 1])),
                'opacite': float(pbr.get('baseColorFactor', [1, 1, 1, 1])[3]) if m.get('alphaMode') == 'BLEND' else 1.0,
                'metal': float(pbr.get('metallicFactor', 1.0)) > 0.5,
                'rugosite': float(pbr.get('roughnessFactor', 1.0)),
                'emissif': max(emis) > 0.05 or mnom.startswith('emis_') or par_emission
                           or 'KHR_materials_unlit' in m.get('extensions', {}),
                'deux_faces': bool(m.get('doubleSided')),
                'texture': texture(tex) if tex is not None else None,
            }
            mat['alpha'] = alpha_tex.get(mat['texture']) if mat['texture'] else None
            if m.get('alphaMode') == 'MASK':
                mat['alpha'] = 'masque'
            if V[:, 2].max() < -300:
                continue                                   # ombre portée au sol sous la caisse
            cle = (mobile or '', mi if mi is not None else -1)
            ajouter(cle, V, Nv, UV, I, mat)
    for c in nd.get('children', []):
        rec(c, M, mobile, exclu)


# on part des enfants de « table » : coordonnées en mm de plateau (sa matrice mène au repère three.js)
def contient(i, nom):
    return noeuds[i].get('name') == nom or any(contient(c, nom) for c in noeuds[i].get('children', []))


if a.bas:
    MOBILES = {}
    for c in noeuds[table].get('children', []):
        if not contient(c, 'flanc_G'):
            rec(c, np.eye(4), None, False)
elif a.chassis:
    # seul le lanceur (pommeau, tige, ressorts mobiles) reste mobile : PrimLanceur, poussé par le script
    MOBILES = {k: v for k, v in MOBILES.items() if v == 'PrimLanceur'}
    rec(next(c for c in noeuds[table]['children'] if contient(c, 'flanc_G')), np.eye(4), None, False)
else:
    for c in noeuds[table].get('children', []):
        rec(c, np.eye(4), None, False)
if 'mesh' in noeuds[table]:
    raise SystemExit('nœud table avec maillage : inattendu')

# plateau peint en haute définition
src0 = None if (a.chassis or a.bas) else g['images'][0]
if src0 is not None:
    bv = g['bufferViews'][src0['bufferView']]
    img = Image.open(io.BytesIO(binr[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')
    img.transpose(Image.FLIP_TOP_BOTTOM).save(os.path.join(SORTIE, 'plateau.jpg'), quality=92)   # rangée du haut = haut du plateau

liste = []
total = 0
for k, ((mobile, mi), gr) in enumerate(sorted(groupes.items(), key=lambda kv: (kv[0][0], kv[0][1]))):
    P = np.concatenate(gr['P']); N = np.concatenate(gr['N']); UV = np.concatenate(gr['UV']); I = np.concatenate(gr['I'])
    pivot = [0.0, 0.0, 0.0]
    if mobile:
        # pièces mobiles : maillage autour d'un pivot (centre de la palette, base de la cible, avant du lanceur)
        if mobile.startswith('PrimPalette'):
            pivot = None
        else:
            pivot = [float(P[:, 0].mean()), float(P[:, 1].mean()), 0.0]
    nom = f'g{k:03d}.bin'
    with open(os.path.join(SORTIE, nom), 'wb') as f:
        f.write(np.c_[P, N, UV].astype('<f4').tobytes())
        f.write(I.astype('<u4').tobytes())
    liste.append({'fichier': nom, 'mobile': mobile or None, 'matiere_gltf': mi, 'sommets': int(len(P)), 'triangles': int(len(I)),
                  'pivot': pivot, 'min': P.min(0).round(1).tolist(), 'max': P.max(0).round(1).tolist(), **gr['mat']})
    total += len(I)
json.dump({'groupes': liste, 'plateau': 'plateau.jpg'}, open(os.path.join(SORTIE, 'decor.json'), 'w'), indent=1)
print(f'{len(liste)} groupes, {total} triangles, {len(textures)} textures → {SORTIE}')
