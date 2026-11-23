"""Pièces de la CAO pour la vue 3D du jeu : cao/sortie/pieces/*.stl → assets/cao/pieces.glb,
cao/sortie/caisse/*.stl → assets/cao/caisse.glb

    python3 outils/cao_web.py

À relancer après chaque `freecadcmd cao/construire.py` (puis `python3 outils/pwa.py`).
Sans dépendance ni IA : lecture des STL binaires, sommets fusionnés, écriture d'un glTF binaire (GLB)
minimal (positions + indices, un maillage par pièce). Les coordonnées sont celles du jeu :
x, y (vers le joueur), z = −hauteur, en mm. Chaque nœud porte dans `extras` sa catégorie (qui choisit
la matière dans js/render3d.js) et son contour au ras du plateau (contours.json), qui sert à masquer
les volumes provisoires que la pièce remplace.
La caisse reste dans le repère de la caisse (X largeur, Y vers l'arrière depuis la façade, Z vers le haut) ;
la scène porte dans `extras` la place du plateau et du fronton, pour que la vue 3D les assemble.
"""
import json
import struct
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "cao"))
import modele as M  # noqa: E402

PIECES = RACINE / "cao/sortie/pieces"
CAISSE = RACINE / "cao/sortie/caisse"
SORTIE = RACINE / "assets/cao/pieces.glb"
SORTIE_CAISSE = RACINE / "assets/cao/caisse.glb"
SORTIE_COLLISION = RACINE / "assets/cao/collision.glb"
H = M.H

# catégorie → matière dans la vue 3D
CATEGORIES = [
    ("guide", ["arche", "guide_retour_*", "separateur_retour_*", "deflecteur_*", "guide_tour_*", "guide_bonus_*", "sep_lanceur"]),
    ("plastique", ["piece_bouchon", "bloc_fanny", "mur_cibles", "plastique_*"]),
    ("poteau", ["poteau_*"]),
    ("support", ["patte_rampe_*", "languette_rampe"]),
    ("tablier", ["tablier"]),
    ("cible", ["cible_pointer", "cible_tirer", "cible_bouchon", "cible_boule*"]),
    ("face", ["face_*"]),
]
# surfaces de collision de la physique (js/sim.js) : pièces passives de la CAO, par matière. Les pièces
# actives (palettes, bumpers, cibles, poteaux caoutchoutés) restent décrites par js/table.js ; le tablier est
# exclu (la bille passe dessous vers le trou d'évacuation).
CATEGORIES_COLLISION = [
    ("plastique", ["arche", "guide_retour_*", "separateur_retour_*", "deflecteur_*", "guide_tour_*", "guide_bonus_*",
                   "piece_bouchon", "bloc_fanny", "mur_cibles", "cible_pointer", "cible_tirer", "cible_bouchon"]),
    ("acrylique", ["plastique_*"]),
    ("rampe", ["rampe"]),              # rampe entière : une seule surface, sans jointure entre tronçons
    ("metal", ["patte_rampe_*", "languette_rampe"]),
]
CATEGORIES_CAISSE = [
    ("bois", ["flanc_*", "facade", "arriere", "fond", "dessus_arriere", "fronton_cote_*", "fronton_dessus", "fronton_dessous"]),
    ("fronton_fond", ["fronton_fond"]),
    ("pied", ["pied_*"]),
    ("quincaillerie", ["quincaillerie_*"]),
    ("barre", ["barre_verrouillage"]),
    ("baguette", ["baguette_*"]),
    ("lanceur", ["lanceur_boitier", "lanceur_ressort_*"]),
    ("lanceur_tige", ["lanceur_tige"]),
    ("pommeau", ["lanceur_pommeau"]),
    ("embout", ["lanceur_embout"]),
    ("charniere", ["charniere_*"]),
    ("finition_chrome", ["finition_grille_ventil", "finition_boulons"]),
    ("finition_noir", ["finition_ouies", "finition_ventilateur"]),
]


def lire_stl(p, table=True):
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
                pos += [x, H - Y, -z] if table else [x, Y, z]   # repère du jeu, ou celui de la caisse
            f.append(index[cle])
        if len(set(f)) == 3:
            tri.append(f)
    return pos, tri


def ecrire_glb(sortie, categories, dossier, table, extras_noeud, extras_scene=None):
    noeuds, maillages, accesseurs, vues, binaire = [], [], [], [], bytearray()

    def ajouter(octets, cible):
        while len(binaire) % 4:
            binaire.append(0)
        vues.append({"buffer": 0, "byteOffset": len(binaire), "byteLength": len(octets), "target": cible})
        binaire.extend(octets)
        return len(vues) - 1

    total = 0
    for cat, motifs in categories:
        fichiers = sorted({f for m in motifs for f in dossier.glob(f"{m}.stl")})
        for f in fichiers:
            pos, tri = lire_stl(f, table)
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
            noeuds.append({"name": f.stem, "mesh": len(maillages) - 1, "extras": {"categorie": cat, **extras_noeud(f.stem)}})
            total += len(tri)

    scene = {"nodes": list(range(len(noeuds)))}
    if extras_scene:
        scene["extras"] = extras_scene
    gltf = {"asset": {"version": "2.0", "generator": "fanny-pinball outils/cao_web.py"},
            "scene": 0, "scenes": [scene], "nodes": noeuds, "meshes": maillages,
            "accessors": accesseurs, "bufferViews": vues, "buffers": [{"byteLength": len(binaire)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(binaire) % 4:
        binaire.append(0)
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binaire))
    glb += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binaire), 0x004E4942) + bytes(binaire)
    sortie.parent.mkdir(parents=True, exist_ok=True)
    sortie.write_bytes(glb)
    print(f"{sortie.relative_to(RACINE)} : {len(noeuds)} pièces, {total} triangles, {len(glb) / 1e6:.2f} Mo")


def main():
    sortie = json.loads((RACINE / "cao/sortie/contours.json").read_text())
    contours = sortie["contours"]
    pieces = {p["id"]: p for p in M.PIECES}

    def extras_piece(nom):
        ex = {"contour": [[[x, H - Y] for x, Y in poly] for poly in contours.get(nom, [])]}
        p = pieces.get(nom)
        if p and p["type"] == "cible_face":           # face pendulaire : axe de rotation (repère du jeu, z = −hauteur)
            ex.update(axe=[p["axe"][0], p["axe"][1], -p["axe"][2]], axe_dir=list(p["axe_dir"]), n=list(p["n"]),
                      zc=p["zc"], r=p["r"], u_axe=p["u_axe"], cible=nom[len("face_"):])
        return ex
    ecrire_glb(SORTIE, CATEGORIES, PIECES, True, extras_piece, {"anneaux": M.ANNEAUX})
    ecrire_glb(SORTIE_COLLISION, CATEGORIES_COLLISION, PIECES, True, lambda nom: {"contour": extras_piece(nom)["contour"]})
    fr = M.V(M.CAISSE["fronton"])
    ecrire_glb(SORTIE_CAISSE, CATEGORIES_CAISSE, CAISSE, False, lambda nom: {}, {
        "plateau": {"x": M.X_PF, "y": M.Y_PF_AV, "z": M.Z_PF_AV, "pente_deg": M.V(M.PLATEAU["pente_deg"])},
        "caisse": {"largeur": M.LARG, "longueur": M.LONG, "ep": M.EPC, "h_avant": M.HAV, "h_arriere": M.HAR, "plat": M.PLAT},
        "fronton": {"l": fr["l"], "h": fr["h"], "p_haut": fr["p_haut"], "p_bas": fr["p_bas"]},
        "h_sol": sortie["h_sol"],
        "lanceur": {"axe": list(M.LANCEUR["axe"])},
        "charniere": {"y": M.CHARNIERE["y"], "z": M.CHARNIERE["z"]},
        "porte": {k: M.V(M.CAISSE["porte"])[k] + (M.EPC if k == "x_gauche" else 0) for k in ("x_gauche", "z_bas", "l", "h", "r")},
        # boutons : centre (repère caisse), diamètre, axe sortant
        "boutons": [{"nom": "start", "p": [M.EPC + t["x"], 0, t["z"]], "d": t["d"], "axe": [0, -1, 0]}
                    for t in M.PANNEAUX["facade"]["trous"] if t["fonction"] == "bouton START"]
                   + [{"nom": f"flipper_{c}", "p": [x, fp["x_avant"], fp["z"]], "d": fp["d"], "axe": [a, 0, 0]}
                      for c, x, a in (("G", 0, -1), ("D", M.LARG, 1)) for fp in [M.V(M.CAISSE["flipper_bouton"])]],
    })


if __name__ == "__main__":
    main()
