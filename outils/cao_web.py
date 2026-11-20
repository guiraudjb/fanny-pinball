"""Pièces de la CAO pour la vue 3D du jeu : cao/sortie/pieces/*.stl → assets/cao/pieces.glb

    python3 outils/cao_web.py

À relancer après chaque `freecadcmd cao/construire.py` (puis `python3 outils/pwa.py`).
Sans dépendance ni IA : lecture des STL binaires, sommets fusionnés, écriture d'un glTF binaire (GLB)
minimal (positions + indices, un maillage par pièce). Les coordonnées sont celles du jeu :
x, y (vers le joueur), z = −hauteur, en mm. Chaque nœud porte dans `extras` sa catégorie (qui choisit
la matière dans js/render3d.js) et son contour au ras du plateau (contours.json), qui sert à masquer
les volumes provisoires que la pièce remplace.
"""
import json
import struct
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
PIECES = RACINE / "cao/sortie/pieces"
SORTIE = RACINE / "assets/cao/pieces.glb"
H = 1067.0

# catégorie → matière dans la vue 3D
CATEGORIES = [
    ("guide", ["arche", "guide_retour_*", "separateur_retour_*", "deflecteur_*", "guide_tour_*", "entree_rampe"]),
    ("plastique", ["piece_bouchon", "bloc_fanny", "mur_cibles", "plastique_sling_*"]),
    ("poteau", ["poteau_*"]),
    ("support", ["support_rampe_*"]),
    ("tablier", ["tablier"]),
]


def lire_stl(p):
    data = p.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + 50 * n:
        raise ValueError(f"{p.name} : STL ASCII ou tronqué")
    index, pos, tri = {}, [], []
    for i in range(n):
        v = struct.unpack_from("<9f", data, 84 + 50 * i + 12)
        f = []
        for k in range(3):
            x, Y, z = v[3 * k:3 * k + 3]
            cle = (round(x, 3), round(Y, 3), round(z, 3))
            if cle not in index:
                index[cle] = len(pos) // 3
                pos += [x, H - Y, -z]          # repère du jeu
            f.append(index[cle])
        if len(set(f)) == 3:
            tri.append(f)
    return pos, tri


def main():
    contours = json.loads((RACINE / "cao/sortie/contours.json").read_text())["contours"]
    noeuds, maillages, accesseurs, vues, binaire = [], [], [], [], bytearray()

    def ajouter(octets, cible):
        while len(binaire) % 4:
            binaire.append(0)
        vues.append({"buffer": 0, "byteOffset": len(binaire), "byteLength": len(octets), "target": cible})
        binaire.extend(octets)
        return len(vues) - 1

    total = 0
    for cat, motifs in CATEGORIES:
        fichiers = sorted({f for m in motifs for f in PIECES.glob(f"{m}.stl")})
        for f in fichiers:
            pos, tri = lire_stl(f)
            nv = len(pos) // 3
            xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
            vp = ajouter(struct.pack(f"<{len(pos)}f", *pos), 34962)
            accesseurs.append({"bufferView": vp, "componentType": 5126, "count": nv, "type": "VEC3",
                               "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
            a_pos = len(accesseurs) - 1
            plat = [i for t in tri for i in t]
            court = nv < 65536
            vi = ajouter(struct.pack(f"<{len(plat)}{'H' if court else 'I'}", *plat), 34963)
            accesseurs.append({"bufferView": vi, "componentType": 5123 if court else 5125, "count": len(plat), "type": "SCALAR"})
            maillages.append({"name": f.stem, "primitives": [{"attributes": {"POSITION": a_pos}, "indices": len(accesseurs) - 1}]})
            contour = [[[x, H - Y] for x, Y in poly] for poly in contours.get(f.stem, [])]
            noeuds.append({"name": f.stem, "mesh": len(maillages) - 1, "extras": {"categorie": cat, "contour": contour}})
            total += len(tri)

    gltf = {"asset": {"version": "2.0", "generator": "fanny-pinball outils/cao_web.py"},
            "scene": 0, "scenes": [{"nodes": list(range(len(noeuds)))}], "nodes": noeuds, "meshes": maillages,
            "accessors": accesseurs, "bufferViews": vues, "buffers": [{"byteLength": len(binaire)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(binaire) % 4:
        binaire.append(0)
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binaire))
    glb += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binaire), 0x004E4942) + bytes(binaire)
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_bytes(glb)
    print(f"{SORTIE.relative_to(RACINE)} : {len(noeuds)} pièces, {total} triangles, {len(glb) / 1e6:.2f} Mo")


if __name__ == "__main__":
    main()
