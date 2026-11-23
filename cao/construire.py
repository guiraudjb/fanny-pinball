"""Construction 3D de la réplique avec FreeCAD (sans écran).

    freecadcmd cao/construire.py

Produit dans cao/sortie/ :
  pieces/<id>.step (+ .stl pour les pièces à imprimer), plateau.step, caisse/*.step,
  assemblage.FCStd, assemblage.step, rendu/<matière>.stl (pour Blender), contours.json (pour les plans).
"""
import json
import math
import os
import sys
import traceback

ICI = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "cao")
sys.path.insert(0, ICI)

import FreeCAD as App  # noqa: E402
import Mesh  # noqa: E402
import MeshPart  # noqa: E402
import Part  # noqa: E402

import modele as M  # noqa: E402
from cotes import CAISSE  # noqa: E402

Vec = App.Vector
OUT = os.path.join(ICI, "sortie")
for d in ("pieces", "caisse", "rendu"):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)


def tv(x, y, z=0.0):
    """repère table → repère plateau (Y depuis l'avant)"""
    return Vec(x, M.H - y, z)


# ------------------------------------------------------------------ briques
def stade(a, b, t, h, z0=0.0):
    """segment épais aux bouts arrondis, extrudé de z0 à z0 + h (repère table)"""
    A, B = tv(*a, z0), tv(*b, z0)
    d = B - A; l = d.Length
    solides = [Part.makeCylinder(t / 2, h, A), Part.makeCylinder(t / 2, h, B)]
    if l > 1e-6:
        bx = Part.makeBox(l, t, h)
        bx.translate(Vec(0, -t / 2, 0))
        bx.rotate(Vec(0, 0, 0), Vec(0, 0, 1), math.degrees(math.atan2(d.y, d.x)))
        bx.translate(A)
        solides.append(bx)
    s = solides[0]
    for o in solides[1:]:
        s = s.fuse(o)
    return s


def ruban(pts, t, h, z0=0.0):
    s = None
    for a, b in zip(pts, pts[1:]):
        p = stade(a, b, t, h, z0)
        s = p if s is None else s.fuse(p)
    return s.removeSplitter()


def face_poly(pts, r=0.0, marge=0.0, z=0.0):
    w = Part.makePolygon([tv(*p, z) for p in pts] + [tv(*pts[0], z)])
    f = Part.Face(w)
    try:
        if marge:
            f = f.makeOffset2D(marge, join=0)
        if r:
            f = f.makeOffset2D(-r, join=0).makeOffset2D(r, join=0)
    except Exception:
        pass
    return f


def coins_aigus(pts, max_deg):
    """sommets saillants d'angle intérieur < max_deg : [(point, angle en radians)]"""
    n = len(pts)
    aire = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    out = []
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        u, v = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
        lu, lv = math.hypot(*u), math.hypot(*v)
        if lu < 1e-6 or lv < 1e-6:
            continue
        ang = math.acos(max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))))
        saillant = (v[0] * u[1] - v[1] * u[0]) * aire > 0
        if saillant and ang < math.radians(max_deg):
            out.append((b, ang))
    return out


def bloc(pts, h, r=0.0, marge=0.0, z0=0.0):
    s = face_poly(pts, r, marge, z0).extrude(Vec(0, 0, h))
    # pointes aiguës (< 60°) : l'arrondi de r les raccourcissait fortement ; fusion 3D avec un arrondi fin (1,5 mm)
    # pour conserver l'angle complet en un seul solide continu (sans scinder la pièce)
    if r > 1.5:
        aigus = coins_aigus(pts, 60)
        if aigus:
            try:
                sp = face_poly(pts, 1.5, marge, z0).extrude(Vec(0, 0, h))
                for q, a in aigus:
                    rad = (r + max(0.0, marge)) / math.sin(a / 2) + 4.0
                    cyl = Part.makeCylinder(rad, h + 4.0, tv(*q, z0 - 2.0))
                    s = s.fuse(sp.common(cyl)).removeSplitter()
            except Exception:
                pass
    return s


def inserts(shape, fix, z0=0.0):
    """trous d'inserts M3 (Ø 4 × 6) depuis le dessous de la pièce"""
    for (x, y) in fix:
        shape = shape.cut(Part.makeCylinder(2.0, 6.0, tv(x, y, z0)))
    return shape


def oblong_outil(x, y, l, w, ang, h, z0):
    a = math.radians(ang)
    dx, dy = math.cos(a) * (l - w) / 2, math.sin(a) * (l - w) / 2
    return stade((x - dx, y - dy), (x + dx, y + dy), w, h, z0)


# ------------------------------------------------------------------ plateau
def construire_plateau():
    pf = Part.makeBox(M.W, M.H, M.EP, Vec(0, 0, -M.EP))
    en = M.ENCOCHE_CABLES
    pf = pf.cut(Part.makeBox(en["l"], en["p"] + 1, M.EP + 2, Vec(M.W / 2 - en["l"] / 2, M.H - en["p"], -M.EP - 1)))
    outils = []
    for t in M.TROUS:
        if t["forme"] == "rond":
            outils.append(Part.makeCylinder(t["d"] / 2, M.EP + 2, tv(t["x"], t["y"], -M.EP - 1)))
        elif t["forme"] == "oblong":
            outils.append(oblong_outil(t["x"], t["y"], t["l"], t["w"], t["angle"], M.EP + 2, -M.EP - 1))
    for o in outils:
        pf = pf.cut(o)
    return pf


def construire_cible(p):
    """cible fixe imprimée, repère local (u vers la bille, v en travers, z vers le haut) puis posée au point (x, y)"""
    cf = M.V(M.CIBLES["fixe"])
    r, zc, za, w, ua, prof = p["r"], p["zc"], p["z_axe"], p["w"], p["u_axe"], p["prof"]
    pa, fe, ad = cf["paroi"], cf["face_ep"], cf["axe_d"]
    if p["type"] == "cible_face":
        # disque + bras qui monte à l'axe + moyeu percé Ø axe + 0,2
        s = Part.makeCylinder(r, fe, Vec(-fe / 2, 0, zc), Vec(1, 0, 0))
        s = s.fuse(Part.makeBox(3, 8, za - zc, Vec(-fe / 2 - 3, -4, zc)))
        s = s.fuse(Part.makeBox(abs(ua) - fe / 2, 8, 6, Vec(ua, -4, za - 3)))
        moyeu = Part.makeCylinder(3.5, w - 2 * pa - 2 * cf["jeu"], Vec(ua, -(w / 2 - pa - cf["jeu"]), za), Vec(0, 1, 0))
        s = s.fuse(moyeu).cut(Part.makeCylinder(ad / 2 + 0.2, w, Vec(ua, -w / 2, za), Vec(0, 1, 0)))
    else:
        # socle, deux joues percées pour l'axe, paroi du fond qui porte le KW11 (levier vers le dos de la face)
        s = Part.makeBox(prof - fe / 2 - 2, w, 3, Vec(-prof, -w / 2, 0))
        for sv in (-1, 1):
            j = Part.makeBox(prof, pa, za + 6, Vec(-prof, (w / 2 - pa) if sv > 0 else -w / 2, 0))
            s = s.fuse(j)
        s = s.fuse(Part.makeBox(pa, w, za + 6, Vec(-prof, -w / 2, 0)))
        s = s.cut(Part.makeCylinder(ad / 2 + 0.1, w + 2, Vec(ua, -w / 2 - 1, za), Vec(0, 1, 0)))
        kw = M.V(M.DETECTION["kw11"])
        s = s.cut(Part.makeBox(kw["e"], kw["l"], kw["h"], Vec(-prof + pa, -kw["l"] / 2, zc - kw["h"] / 2)))   # logement KW11
        s = s.cut(Part.makeCylinder(4, 4, Vec(-prof + 14, 0, -1)))                                         # passe-fil
    ang = math.degrees(math.atan2(-p["n"][1], p["n"][0]))        # u (repère table) → repère plateau (y inversé)
    s.rotate(Vec(0, 0, 0), Vec(0, 0, 1), ang)
    s.translate(tv(p["x"], p["y"]))
    return inserts(s, p["fix"]) if p["type"] == "cible" else s


# ------------------------------------------------------------------ pièces
def construire_piece(p):
    k = p["type"]
    if k == "ruban":
        s = ruban(p["pts"], p["t"], p["h"])
        if p.get("decoupe_plateau"):
            s = s.common(Part.makeBox(M.W, M.H, 200, Vec(0, 0, -50)))
        if p["id"] == "deflecteur_1":
            s = inserts(s, p["fix"], p["h"] - 6)           # inserts en haut : entretoises de plastique_tirer
        return inserts(s, p["fix"])
    if k == "bloc":
        s = bloc(p["pts"], p["h"], p.get("r", 0)).common(Part.makeBox(M.W, M.H, 200, Vec(0, 0, -50)))
        if p.get("creux"):                             # carcasse : parois de « creux » mm, plots Ø 9 aux fixations
            s = s.cut(bloc(p["pts"], p["h"] + 2, p.get("r", 0), -p["creux"], -1))
            for (x, y) in p["fix"]:
                s = s.fuse(Part.makeCylinder(4.5, p["h"], tv(x, y)))
            s = inserts(s.removeSplitter(), p["fix"], p["h"] - 6)    # inserts en haut : entretoises du plastique
        rampe = next(q for q in M.PIECES if q["id"] == "rampe")
        if p["id"] == "bloc_fanny":                    # sous la rampe qui redescend : 2 mm de jeu sous son fond
            s = s.cut(gabarit_rampe(rampe, 2.0))
        if p["id"] == "piece_bouchon":                 # sous la rampe qui monte depuis l'entrée : ses parois la portent
            s = s.cut(gabarit_rampe(rampe, 0.0, lambda q: 60 < q[3] < 220))
        if p["id"] == "piece_bouchon":
            for q in M.POCHES_BOUCHON:                     # poche du boîtier de POINTER
                s = s.cut(bloc(q, p["h"] + 2, 0, 0, -1))
        if p["id"] == "mur_cibles":
            for x0, y0, l, w in M.POCHES_MUR:              # poches des unités de cible ronde, ouvertes vers le plateau
                s = s.cut(Part.makeBox(l, w, p["h"] + 2, tv(x0, y0 + w, -1)))
            s = inserts(s, p["fix"], p["h"] - 6)           # inserts en haut : entretoises du plastique
        return inserts(s, p["fix"])
    if k == "poteau":
        s = Part.makeCylinder(p["d"] / 2, p["h"], tv(p["x"], p["y"]))
        s = s.cut(Part.makeCylinder(2.0, 6.0, tv(p["x"], p["y"])))                    # insert M3 en bas
        s = s.cut(Part.makeCylinder(2.0, 6.0, tv(p["x"], p["y"], p["h"] - 6)))        # et en haut (plastique)
        if p.get("gorge"):                                                            # gorge de l'anneau caoutchouc
            gd, gz, gh = p["gorge"]
            bague = Part.makeCylinder(p["d"] / 2 + 1, gh, tv(p["x"], p["y"], gz - gh / 2))
            s = s.cut(bague.cut(Part.makeCylinder(gd / 2, gh, tv(p["x"], p["y"], gz - gh / 2))))
        return s
    if k == "tablier":
        # coque : dessus et lèvre de ep mm, ouverte en dessous ; plots de fixation (inserts M3) sous le dessus
        s = bloc(p["pts"], p["h"]).cut(bloc(p["pts"], p["h"] - p["ep"], 0, -p["ep"], -1))
        for (x, y) in p["fix"]:
            s = s.fuse(Part.makeCylinder(4.5, p["h"] - p["ep"] + 0.5, tv(x, y)))
        return inserts(s.removeSplitter(), p["fix"])
    if k == "plaque":
        s = bloc(p["pts"], p["ep"], p.get("r", 0), p.get("marge", 0), p["z"])
        if p.get("decoupe_plateau"):
            s = s.common(Part.makeBox(M.W, M.H, 200, Vec(0, 0, -50)))
        for (x, y) in p.get("fix", []) + p.get("vis", []):
            s = s.cut(Part.makeCylinder(1.75, p["ep"] + 2, tv(x, y, p["z"] - 1)))
        if p.get("sous_rampe"):                        # échancré là où la rampe passe plus bas que lui ; on garde le gros morceau
            s = s.cut(gabarit_rampe(next(q for q in M.PIECES if q["id"] == "rampe"), 2.0, lambda q: q[3] < 220))
            s = max(s.Solids, key=lambda o: o.Volume)
        for (x, y) in p.get("entretoises", []):        # entretoises Ø 7 sous la plaque, vis M3 traversante
            e = Part.makeCylinder(3.5, p["h_entretoise"], tv(x, y, p["z"] - p["h_entretoise"]))
            s = s.fuse(e).cut(Part.makeCylinder(1.6, p["h_entretoise"] + p["ep"] + 2, tv(x, y, p["z"] - p["h_entretoise"] - 1)))
        return s.removeSplitter()
    if k == "patte":
        # tôle pliée sous la rampe (dessus 0,5 mm sous le fond de rampe, suivant la pente dz/ds, arrêtée au ras
        # du flanc opposé pour ne jamais dépasser ni traverser la rampe PVC) ; retour plié dans l'axe exact du support.
        (nx, ny), (dx, dy), x, y, z = p["n"], p["d"], p["x"], p["y"], p["z"]
        dz = p.get("dz", 0.0)
        hw_int = M.V(M.RAMPE["larg_int"]) / 2.0        # 19,5 mm : affleure le flanc PVC opposé sans le dépasser
        z_top = z - 0.5                                # 0,5 mm sous la peau PVC (zéro traversée / z-fighting)
        def plaque(a0, a1, z0, h, pente=False):
            zb_fn = (lambda b: z0 + b * dz) if pente else (lambda _b: z0)
            q = [tv(x + nx * a + dx * b, y + ny * a + dy * b, zb_fn(b)) for a, b in ((a0, -9), (a1, -9), (a1, 9), (a0, 9))]
            return Part.Face(Part.makePolygon(q + [q[0]])).extrude(Vec(0, 0, h))
        bord = p["bord"]
        if bord == "caisse":                           # vissée à plat sur le flanc bois de la caisse
            jeu_c = (M.LARG - 2 * M.EPC - M.W) / 2.0   # 3,4 mm entre le bord du plateau et la face intérieure du bois
            x_mur = -jeu_c if nx < 0 else M.W + jeu_c
            d_mur = (x_mur - x) / nx if abs(nx) > 0.1 else p["dist"] + jeu_c
            y_mur = y + ny * d_mur
            bras = plaque(-hw_int, d_mur + 22, z_top - 3, 3, pente=True)
            bras = bras.common(Part.makeBox(M.W + 2 * jeu_c, M.H + 200, 120, Vec(-jeu_c, -100, z - 20)))
            demi_y = 9.0 / max(0.35, abs(nx)) + 3.0
            x0 = -jeu_c if nx < 0 else M.W + jeu_c - 3.0
            retour = Part.makeBox(3.0, 2 * demi_y, 24.0, Vec(x0, M.H - (y_mur + demi_y), z_top - 3))
            s = bras.fuse(retour)
        elif bord == "separateur":                     # berceau sous rampe + col plié descendant vers sep_lanceur (x = 480)
            ls_x = M.GEO["laneSep"]["x"]               # 480,0 mm (ne déborde jamais dans le couloir de lancement)
            y_sep = y + ny * ((ls_x - x) / nx if abs(nx) > 0.1 else p["dist"] + 2.0)
            demi_y = 9.0 / max(0.35, abs(nx)) + 1.5
            # berceau strictement sous la rampe (suivant la pente dz/ds)
            berceau = plaque(-hw_int, hw_int, z_top - 3, 3, pente=True)
            if abs(dz) > 0.02 or p["dist"] > hw_int + 15:
                # patte longue / rampe en descente (patte_rampe_10) : tôle pliée en Z depuis le flanc droit de la rampe
                # jusqu'au sommet du séparateur (x = 480, z = 29,5), en restant > 6 mm au-dessus de la bille (Ø 27)
                p1x = x + nx * (hw_int - 1.5)
                p1y = y + ny * (hw_int - 1.5)
                p2x = ls_x
                p2y = y_sep
                zb1 = z_top - 3.0 - abs(9.0 * dz)
                zb2 = 29.5
                # col incliné entre le bord droit du berceau et la selle sur sep_lanceur (épaisseur 3 mm)
                pts_col = [
                    tv(p1x, p1y - 9, zb1), tv(p2x - 1.5, p2y - 9, zb2),
                    tv(p2x - 1.5, p2y + 9, zb2), tv(p1x, p1y + 9, zb1),
                ]
                col = Part.Face(Part.makePolygon(pts_col + [pts_col[0]])).extrude(Vec(0, 0, 3.0))
                selle = Part.makeBox(3.5, 2 * demi_y, 3.0, Vec(ls_x - 1.75, M.H - (y_sep + demi_y), zb2))
                s = berceau.fuse(col).fuse(selle)
            else:
                d_sep = (ls_x + 1.5 - x) / nx if abs(nx) > 0.1 else p["dist"] + 3.5
                bras = plaque(-hw_int, d_sep + 18, z_top - 3, 3, pente=True)
                bras = bras.common(Part.makeBox(ls_x + 1.5, M.H + 200, 120, Vec(0, -100, z - 20)))
                pied_sep = Part.makeBox(3.0, 2 * demi_y, max(4.0, z_top - 29.5), Vec(ls_x - 1.5, M.H - (y_sep + demi_y), 29.5))
                s = bras.fuse(pied_sep)
        else:                                          # arche : centrée sur le fil supérieur (ellipse + 3 mm, z = 32)
            d_arc = p["dist"] + 3.0
            s = plaque(-hw_int, d_arc + 1.5, z_top - 3, 3, pente=True).fuse(
                plaque(d_arc - 1.5, d_arc + 1.5, 31.5, z_top - 31.5))
        return s.removeSplitter()
    if k == "enseigne":
        # plaque inclinée de « incl » vers le joueur (bord avant en bas), à cheval sur la rampe ; deux pattes
        # verticales collées sur la face extérieure des flancs
        rp = next(q for q in M.PIECES if q["id"] == "rampe")
        (mx, my), (ux, uy), (vx, vy) = p["M"], p["u"], p["v"]
        c, sn = math.cos(math.radians(p["incl"])), math.sin(math.radians(p["incl"]))
        P3 = lambda k, a, z: tv(mx + vx * k + ux * a, my + vy * k + uy * a, z)  # noqa: E731
        a0, a1, z0, z1 = p["a"], p["a"] + p["prof"] * c, p["z"], p["z"] + p["prof"] * sn
        d = p["demi"]
        q = [P3(-d, a0, z0), P3(d, a0, z0), P3(d, a1, z1), P3(-d, a1, z1)]
        s = Part.Face(Part.makePolygon(q + [q[0]])).extrude(Vec(0, 0, p["ep"]))
        haut = lambda a: M.z_rampe(a) + rp["ep"] + rp["h"]  # noqa: E731
        for sg in (-1, 1):
            k0 = sg * (demi_rampe(rp, a0) + rp["ep"] + 0.2)          # contre le flanc là où il est le plus large
            t = [P3(k0, a0, haut(a0) - 4), P3(k0, a1, haut(a1) - 4), P3(k0, a1, z1 + 1), P3(k0, a0, z0 + 1)]
            s = s.fuse(Part.Face(Part.makePolygon(t + [t[0]])).extrude(Vec(vx * sg * 2.5, -vy * sg * 2.5, 0)))
        return s.removeSplitter()
    if k == "languette":
        # tôle d'entrée : coin de 0 à h sur l mm devant la bouche, pointe enfoncée de « enfonce » mm dans une
        # feuillure du plateau, prolongé de « ext » mm à plat sur le début du fond de rampe (« recouvre » mm au-dessus) :
        # la bille ne rencontre jamais une arête de face (plateau → tôle, tôle → fond de rampe)
        (mx, my), (ux, uy), hw, l, h = p["M"], p["u"], p["hw"], p["l"], p["h"]
        e, ext, rc = p["enfonce"], p["ext"], p["recouvre"]
        prof = [(-l, -e), (ext, h + ext * h / l + rc), (ext, -e)]
        q = [tv(mx + ux * a + uy * hw, my + uy * a - ux * hw, z) for a, z in prof]
        return Part.Face(Part.makePolygon(q + [q[0]])).extrude(Vec(-uy * 2 * hw, -ux * 2 * hw, 0))   # Vec : y inversé (tv)
    if k == "palette":
        f = p["flip"]
        verts = next(fl["verts"] for fl in M.G["flippers"] if fl["def"]["side"] == f["side"])
        return bloc([tuple(v) for v in verts], 22, 0, 0, 3)
    if k == "bumper":
        x, y = p["x"], p["y"]
        jupe = Part.makeCylinder(p["r"] + 3, 4, tv(x, y))
        corps = Part.makeCylinder(p["r"] - 6, 34, tv(x, y))
        anneau = Part.makeCylinder(p["r"], 6, tv(x, y, 14)).cut(Part.makeCylinder(p["r"] - 4, 6, tv(x, y, 14)))
        chapeau = Part.makeSphere(p["cap"], tv(x, y, 34 - p["cap"] * 0.55)).common(Part.makeCylinder(p["cap"], 40, tv(x, y, 34)))
        return jupe.fuse(corps).fuse(anneau).fuse(chapeau)
    if k == "drop":
        # lame : section l × e, coins hauts arrondis, dépasse du plateau de h_dessus et descend dans la banque
        d = M.V(M.CIBLES["drop"])
        l, e, r, z0, z1 = d["l"], d["e"], d["r_haut"], -M.EP - d["h_dessous"], d["h_dessus"]
        b = Part.makeBox(l, e, z1 - r - z0, Vec(-l / 2, -e / 2, z0))
        b = b.fuse(Part.makeBox(l - 2 * r, e, z1 - z0, Vec(-l / 2 + r, -e / 2, z0)))
        for sx in (-1, 1):
            b = b.fuse(Part.makeCylinder(r, e, Vec(sx * (l / 2 - r), -e / 2, z1 - r), Vec(0, 1, 0)))
        b.rotate(Vec(0, 0, 0), Vec(0, 0, 1), -math.degrees(p["angle"]))
        b.translate(tv(p["x"], p["y"]))
        return b
    if k == "banque":
        # châssis en tôle sous le plateau : platine (gabarit DWG), deux joues, peigne de guidage des lames,
        # bobine de remise et barre de remise
        bq = M.V(M.CIBLES["banque"]); l, w = p["dims"]; ep, h = bq["ep"], bq["h"]
        z = -M.EP
        s = Part.makeBox(l, w, ep, Vec(-l / 2, -w / 2, z - ep))                                   # platine sous le plateau
        for sx in (-1, 1):
            s = s.fuse(Part.makeBox(ep, w, h, Vec(sx * (l / 2) - (ep if sx > 0 else 0), -w / 2, z - h)))   # joues
        s = s.fuse(Part.makeBox(l, ep, h * 0.6, Vec(-l / 2, -ep / 2 + 6, z - h * 0.6)))             # peigne des lames
        s = s.fuse(Part.makeBox(l - 2 * ep, 10, 4, Vec(-l / 2 + ep, -w / 2 + 6, z - h + 10)))      # barre de remise
        bd, bl = bq["bobine"]
        s = s.fuse(Part.makeCylinder(bd / 2, bl, Vec(0, -w / 2 + 25, z - h + 2), Vec(0, 0, 1)))   # bobine
        s.rotate(Vec(0, 0, 0), Vec(0, 0, 1), -p["angle"])
        s.translate(tv(p["x"], p["y"]))
        return s
    if k in ("cible", "cible_face"):
        return construire_cible(p)
    if k == "rollover":
        x, y = p["x"], p["y"]
        support = Part.makeBox(16, 56, 24, tv(x - 8, y + 28, -M.EP - 24))             # sous le plateau
        kw = Part.makeBox(6.4, 20, 10.3, tv(x - 3.2, y + 10, -M.EP - 14))
        fil = stade((x, y - 15), (x, y + 15), 1.5, 6, 0)                               # fil en U qui affleure
        return support.cut(kw).fuse(kw).fuse(fil)
    if k == "cuvette":
        x, y = p["x"], p["y"]
        c = Part.makeCylinder(20, 18 + M.EP, tv(x, y, -M.EP - 18)).cut(Part.makeCylinder(16, 18 + M.EP, tv(x, y, -M.EP - 15)))
        kw = Part.makeBox(20, 6.4, 10.3, tv(x - 10, y + 3.2, -M.EP - 30))
        return c.fuse(kw)
    if k == "bac":
        x, y = p["x"], p["y"]
        L = M.GEO["plunger"]["x"] - x + 20
        b = Part.makeBox(L, 40, 36, tv(x - 20, y + 20, -M.EP - 36))
        return b.cut(Part.makeBox(L - 6, 30, 33, tv(x - 17, y + 15, -M.EP - 33)))
    if k == "zone":
        l, w = p["dims"]
        b = Part.makeBox(l, w, 60, Vec(-l / 2, -w / 2, 0))
        b.rotate(Vec(0, 0, 0), Vec(0, 0, 1), -p.get("angle", 0))
        b.translate(tv(p["x"], p["y"], -M.EP - 60))
        return b
    if k == "rampe":
        return construire_rampe(p)
    raise ValueError(k)


def demi_rampe(p, s):
    """demi-largeur intérieure de la rampe à l'abscisse s : bouche évasée qui se resserre sur « evase » mm"""
    return p["larg"] / 2 + max(0.0, (p["bouche"] - p["larg"]) / 2 * (1 - s / p["evase"]))


def section_rampe(x, y, z, dx, dy, p, s=1e9):
    """profil en U (fond + 2 flancs) perpendiculaire à la direction (dx, dy) — repère table"""
    nx, ny = -dy, dx
    hw, e, h = demi_rampe(p, s), p["ep"], p["h"]
    prof = [(-hw - e, -e), (hw + e, -e), (hw + e, h), (hw, h), (hw, 0), (-hw, 0), (-hw, h), (-hw - e, h)]
    pts = [tv(x + nx * a, y + ny * a, z + b) for a, b in prof]
    return Part.makePolygon(pts + [pts[0]])


def gabarit_rampe(p, jeu, garde=lambda q: q[0] > 350 and q[1] > 330):
    """volume réservé à la rampe : de jeu mm sous son fond jusqu'à 200 mm, largeur hors tout + 2 × jeu,
    sur les points retenus par « garde » (par défaut : la descente le long du mur droit)"""
    fils = []
    q3 = [q for q in p["pts3d"] if garde(q)]
    for i, (x, y, z, s) in enumerate(q3):
        hw = demi_rampe(p, s) + p["ep"] + jeu
        a = q3[max(0, i - 1)]; b = q3[min(len(q3) - 1, i + 1)]
        dx, dy = M.unit((b[0] - a[0], b[1] - a[1])); nx, ny = -dy, dx
        pts = [tv(x + nx * u, y + ny * u, z + w) for u, w in ((-hw, -jeu), (hw, -jeu), (hw, 200), (-hw, 200))]
        fils.append(Part.makePolygon(pts + [pts[0]]))
    # un seul lissage réglé par toutes les sections : fusionner les lissages deux à deux échouait sans bruit sur
    # les longues parties droites (faces coplanaires) et le gabarit perdait la montée de la rampe
    return Part.makeLoft(fils, True, True)


def point_rampe(pts3d, s):
    """point du chemin de la rampe à l'abscisse s (interpolation linéaire entre les points échantillonnés)"""
    for a, b in zip(pts3d, pts3d[1:]):
        if a[3] <= s <= b[3]:
            t = (s - a[3]) / (b[3] - a[3]) if b[3] > a[3] else 0.0
            return tuple(a[i] + (b[i] - a[i]) * t for i in range(3)) + (s,)
    return pts3d[0] if s < pts3d[0][3] else pts3d[-1]


def construire_rampe(p, s_min=None, s_max=None):
    # sections exactement aux bornes du tronçon : deux tronçons voisins partagent la même section (sans elles, il
    # manquait entre eux un pas d'échantillonnage du chemin, soit un trou de 3 à 8 mm dans le fond de la rampe)
    q3 = p["pts3d"]
    pts = [q for q in q3 if (s_min is None or q[3] > s_min + 1.0) and (s_max is None or q[3] < s_max - 1.0)]   # 1 mm : pas de section dégénérée
    if s_min is not None:
        pts.insert(0, point_rampe(q3, s_min))
    if s_max is not None:
        pts.append(point_rampe(q3, s_max))
    fils = []
    for i, (x, y, z, s) in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        d = M.unit((b[0] - a[0], b[1] - a[1]))
        fils.append(section_rampe(x, y, z + p["ep"], d[0], d[1], p, s))
    solide = None
    for w1, w2 in zip(fils, fils[1:]):
        lo = Part.makeLoft([w1, w2], True, True)
        solide = lo if solide is None else solide.fuse(lo)
    return solide.removeSplitter() if solide else None


# ------------------------------------------------------------------ caisse
def panneau_yz(contour, ep, x0):
    pts = [Vec(x0, y, z) for y, z in contour]
    return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(Vec(ep, 0, 0))


def panneau_xz(contour, ep, y0, x0=0.0, z0=0.0):
    pts = [Vec(x0 + x, y0, z0 + z) for x, z in contour]
    return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(Vec(0, ep, 0))


def panneau_xy(contour, ep, z0, x0=0.0, y0=0.0):
    pts = [Vec(x0 + x, y0 + y, z0) for x, y in contour]
    return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(Vec(0, 0, ep))


def rect_arrondi(x, z, l, h, r, y0, ep, plan="xz"):
    f = Part.Face(Part.makePolygon([Vec(x, y0, z), Vec(x + l, y0, z), Vec(x + l, y0, z + h), Vec(x, y0, z + h), Vec(x, y0, z)]))
    f = f.makeOffset2D(-r, join=0).makeOffset2D(r, join=0)
    return f.extrude(Vec(0, ep, 0))


def construire_caisse():
    P = M.PANNEAUX; E = M.EPC; L = M.LARG; LG = M.LONG
    out = {}
    for nom, x0 in (("flanc_G", 0.0), ("flanc_D", L - E)):
        f = panneau_yz(P[nom]["contour"], E, x0)
        for t in P[nom]["trous"]:
            f = f.cut(Part.makeCylinder(t["d"] / 2, E + 2, Vec(x0 - 1, t["y"], t["z"]), Vec(1, 0, 0)))
        for en in P[nom]["encoches"]:
            f = f.cut(Part.makeBox(E + 2, en["l"], en["h"], Vec(x0 - 1, en["y"] - en["l"] / 2, 0)))
        # rainure de la vitre : 5 × 6 mm, 22 mm sous l'arête haute (côté intérieur)
        y1, y2 = 40.0, LG - M.PLAT - 30
        rain = Part.makeBox(6, y2 - y1, 5, Vec(0, 0, -2.5))
        rain.rotate(Vec(0, 0, 0), Vec(1, 0, 0), math.degrees(math.atan((M.HAR - M.HAV) / (LG - M.PLAT))))
        rain.translate(Vec(x0 + (E - 6 if nom == "flanc_G" else 0), y1, M.z_dessus_flanc(y1) - 22))
        f = f.cut(rain)
        out[nom] = f
    fa = P["facade"]
    f = panneau_xz(fa["contour"], E, 0.0, E)
    po = fa["porte"]
    f = f.cut(rect_arrondi(po["x_gauche"], po["z_bas"], po["l"], po["h"], po["r"], -1, E + 2))
    for t in fa["trous"]:
        f = f.cut(Part.makeCylinder(t["d"] / 2, E + 2, Vec(E + t["x"], -1, t["z"]), Vec(0, 1, 0)))
    out["facade"] = f
    ar = P["arriere"]
    f = panneau_xz(ar["contour"], E, LG - E, E)
    ob = ar["oblongs"]
    for x in (ob["x_gauche"], L - 2 * E - ob["x_gauche"] - ob["l"]):
        f = f.cut(rect_arrondi(E + x, ob["z"] - ob["h"] / 2, ob["l"], ob["h"], ob["h"] / 2 - 0.5, LG - E - 1, E + 2))
    ve = ar["ventil"]
    f = f.cut(Part.makeCylinder(ve["d"] / 2, E + 2, Vec(E + ve["x"], LG - E - 1, ve["z"]), Vec(0, 1, 0)))
    for sx in (-1, 1):
        for sz in (-1, 1):
            f = f.cut(Part.makeCylinder(ve["vis"] / 2, E + 2, Vec(E + ve["x"] + sx * ve["entraxe"] / 2, LG - E - 1,
                                                                  ve["z"] + sz * ve["entraxe"] / 2), Vec(0, 1, 0)))
    out["arriere"] = f
    out["fond"] = panneau_xy(P["fond"]["contour"], E, 0.0, E, E)
    da = P["dessus_arriere"]
    f = panneau_xy(da["contour"], E, M.HAR - E, E, LG - M.PLAT)
    oc = da["oblong_cables"]
    f = f.cut(Part.makeBox(oc["l"], oc["h"], E + 2, Vec(L / 2 - oc["l"] / 2, LG - M.PLAT / 2 - oc["h"] / 2, M.HAR - E - 1)))
    out["dessus_arriere"] = f
    # tasseaux de soutien du plateau (20 × 30), parallèles au plateau, vissés sur les flancs
    s, l = M.TASSEAU["section"], M.TASSEAU["longueur"]
    for nom, x0 in (("tasseau_G", E), ("tasseau_D", L - E - s[0])):
        t = Part.makeBox(s[0], l, s[1], Vec(0, 0, -s[1]))
        t.rotate(Vec(0, 0, 0), Vec(1, 0, 0), math.degrees(M.PENTE_PF))
        t.translate(Vec(x0, M.Y_PF_AV + 20, 0) + Vec(0, 0, M.Z_PF_AV - M.EP + 20 * math.tan(M.PENTE_PF)))
        out[nom] = t
    # fronton
    fr = M.V(CAISSE["fronton"])
    X0 = (L - fr["l"]) / 2
    cont = [(LG - a, b) for a, b in P["fronton_cote"]["contour"]]
    for nom, x in (("fronton_cote_G", X0), ("fronton_cote_D", X0 + fr["l"] - E)):
        out[nom] = panneau_yz(cont, E, x).translate(Vec(0, 0, M.HAR)) or panneau_yz(cont, E, x)
        out[nom] = panneau_yz(cont, E, x); out[nom].translate(Vec(0, 0, M.HAR))
    out["fronton_dessous"] = panneau_xy(P["fronton_dessous"]["contour"], E, M.HAR, X0 + E, LG - fr["p_bas"])
    out["fronton_dessus"] = panneau_xy(P["fronton_dessus"]["contour"], E, M.HAR + fr["h"] - E, X0 + E, LG - fr["p_haut"])
    out["fronton_fond"] = panneau_xz(P["fronton_fond"]["contour"], 6.0, LG - 6.0, X0 + E, M.HAR + E)
    # boulons des pieds : 2 trous par angle, en diagonale à 45° à travers l'arête de la caisse
    pd = M.PIED
    for _, xc, yc, sx, sy in M.COINS_PIEDS:
        d = Vec(sx, sy, 0).normalize()
        for z in pd["z_trous"]:
            outil = Part.makeCylinder(pd["d_trou"] / 2, 120, Vec(xc - sx * 30, yc - sy * 30, z), d)
            for nom in ("flanc_G" if sx > 0 else "flanc_D", "facade" if sy > 0 else "arriere"):
                out[nom] = out[nom].cut(outil)
    return out


def pieds():
    """pieds achetés : cornière effilée, boulons en diagonale, platine d'angle intérieure, vérin (cotes.py : PW / HYP)"""
    pd, E = M.PIED, M.EPC
    t = pd["ep"]
    bo, pl, ve = M.V(CAISSE["pied_boulons"]), M.V(CAISSE["pied_platine"]), M.V(CAISSE["verin"])
    z_droit = pd["z_haut"] - pd["droit"]
    out = {}
    for nom, xc, yc, sx, sy in M.COINS_PIEDS:
        # repère local du coin : u vers l'intérieur selon X, v vers l'intérieur selon Y
        q = lambda u, v, z: Vec(xc + sx * u, yc + sy * v, z)  # noqa: E731

        def prisme(poly, z0, h):
            pts = [q(u, v, z0) for u, v in poly]
            return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(Vec(0, 0, h))

        # cornière : une aile sur le flanc, une sur la façade (ou l'arrière)
        prof = [(-t, pd["z_bas"]), (pd["aile_bas"] - t, pd["z_bas"]), (pd["aile_haut"] - t, z_droit),
                (pd["aile_haut"] - t, pd["z_haut"]), (-t, pd["z_haut"])]
        a = [q(-t, w, z) for w, z in prof]
        b = [q(w, -t, z) for w, z in prof]
        aile_a = Part.Face(Part.makePolygon(a + [a[0]])).extrude(Vec(sx * t, 0, 0))
        aile_b = Part.Face(Part.makePolygon(b + [b[0]])).extrude(Vec(0, sy * t, 0))
        c = pd["aile_bas"] * 0.42
        jambe = aile_a.fuse(aile_b).fuse(prisme([(-t, -t), (pd["aile_bas"] - t, -t), (-t, pd["aile_bas"] - t)], pd["z_bas"], 4))
        diag = Vec(sx, sy, 0).normalize()
        quinc = []
        for z in pd["z_trous"]:
            jambe = jambe.cut(Part.makeCylinder(pd["d_trou"] / 2, 40, q(-20, -20, z), diag))
            tete = q(-t, -t, z) - diag * 6
            quinc.append(Part.makeCylinder(bo["tete"] / 2, 6, tete, diag))
            quinc.append(Part.makeSphere(bo["tete"] / 2 * 0.85, tete))
            quinc.append(Part.makeCylinder(4.7, bo["l"], q(-t, -t, z), diag))
        # platine d'angle intérieure : face diagonale + deux ailes vissées sur les faces intérieures
        s = pl["retrait"] * math.sqrt(2)
        e = pl["ep"] * math.sqrt(2)
        zp = sum(pd["z_trous"]) / 2 - pl["h"] / 2
        quinc.append(prisme([(E, s - E), (s - E, E), (s - E + e, E), (E, s - E + e)], zp, pl["h"]))
        quinc.append(prisme([(E, s - E), (E + pl["ep"], s - E), (E + pl["ep"], s - E + pl["ailes"]), (E, s - E + pl["ailes"])], zp, pl["h"]))
        quinc.append(prisme([(s - E, E), (s - E, E + pl["ep"]), (s - E + pl["ailes"], E + pl["ep"]), (s - E + pl["ailes"], E)], zp, pl["h"]))
        # vérin : contre-écrou sous la plaque, tige, patin au sol
        r6 = ve["contre_ecrou"] / math.sqrt(3)
        quinc.append(prisme([(c + r6 * math.cos(k * math.pi / 3), c + r6 * math.sin(k * math.pi / 3)) for k in range(6)], pd["z_bas"] - 8, 8))
        quinc.append(Part.makeCylinder(ve["d"] / 2, ve["saillie"] + 14 - ve["h_patin"], q(c, c, -M.H_SOL + ve["h_patin"])))
        quinc.append(Part.makeCone(ve["patin"] / 2, ve["patin"] / 2 * 0.55, ve["h_patin"], q(c, c, -M.H_SOL)))
        out[f"pied_{nom}"] = jambe
        q0 = quinc[0]
        for k in quinc[1:]:
            q0 = q0.fuse(k)
        out[f"quincaillerie_{nom}"] = q0
    return out


def barre_verrouillage():
    """barre WPC : coque d'inox brossé, dessus plat bombé vers l'avant, jupe avant qui coiffe le haut de la façade,
    jupe arrière courte au-dessus de la vitre, bouts arrondis en plan ; ouverte dessous"""
    b = M.V(CAISSE["barre"])
    lb, d, h, ep = b["l"], b["p"], b["h"], b["ep"]

    def profil(t):                         # section dans le plan Y-Z (x = 0), décalée de t vers l'intérieur
        ra, rr = b["r_av"] - t, b["r_ar"] - t
        y0, y1, z1 = t, d - t, h - t
        p = lambda y, z: Vec(0, y, z)
        c = math.sqrt(0.5)
        bords = [Part.LineSegment(p(y0, -1), p(y0, z1 - ra)),
                 Part.Arc(p(y0, z1 - ra), p(y0 + ra * (1 - c), z1 - ra * (1 - c)), p(y0 + ra, z1)),
                 Part.LineSegment(p(y0 + ra, z1), p(y1 - rr, z1)),
                 Part.Arc(p(y1 - rr, z1), p(y1 - rr * (1 - c), z1 - rr * (1 - c)), p(y1, z1 - rr)),
                 Part.LineSegment(p(y1, z1 - rr), p(y1, -1)),
                 Part.LineSegment(p(y1, -1), p(y0, -1))]
        return Part.Face(Part.Wire([Part.Edge(e) for e in bords]))

    def plan(t):                           # contour en plan, bouts arrondis
        f = Part.Face(Part.makePolygon([Vec(t, t, -2), Vec(lb - t, t, -2), Vec(lb - t, d - t, -2), Vec(t, d - t, -2), Vec(t, t, -2)]))
        return f.makeOffset2D(-(b["r_bout"] - t), join=0).makeOffset2D(b["r_bout"] - t, join=0).extrude(Vec(0, 0, h + 4))

    ext = profil(0).extrude(Vec(lb, 0, 0)).common(plan(0))
    inte = profil(ep).extrude(Vec(lb + 2, 0, 0)); inte.translate(Vec(-1, 0, 0))
    s = ext.cut(inte.common(plan(ep)))
    s = s.cut(Part.makeBox(lb + 2, d, 1.0 + 0.01, Vec(-1, 0, -1)))                          # dessous ouvert
    s = s.cut(Part.makeBox(lb + 2, ep + 2, h - b["jupe_ar"] + 1, Vec(-1, d - ep - 1, -1)))   # jupe arrière courte
    s.translate(Vec((M.LARG - lb) / 2, -b["debord_av"], M.HAV - b["sous_dessus"]))
    return s


def baguettes():
    """baguettes latérales : cornière d'inox sur l'arête haute de chaque flanc, du devant jusqu'au plat du fronton ;
    aile du dessus (déborde un peu au-dessus de la vitre), aile extérieure effilée vers l'avant (sous la barre)"""
    g = M.V(CAISSE["baguette"])
    ep, a = g["ep"], math.atan((M.HAR - M.HAV) / (M.LONG - M.PLAT))
    ls = (M.LONG - M.PLAT) / math.cos(a)
    r = g["r_bout"]
    dessus = Part.Face(Part.makePolygon([Vec(-ep, 0, 0), Vec(g["dessus"] - ep, 0, 0), Vec(g["dessus"] - ep, ls, 0), Vec(-ep, ls, 0), Vec(-ep, 0, 0)]))
    dessus = dessus.makeOffset2D(-r, join=0).makeOffset2D(r, join=0).extrude(Vec(0, 0, ep))
    e0, e1 = g["effile"]
    aile = Part.Face(Part.makePolygon([Vec(-ep, s, z) for s, z in
                                       [(0, ep), (ls, ep), (ls, -g["retour"]), (e1, -g["retour"]), (e0, -g["pointe"]), (0, -g["pointe"]), (0, ep)]]))
    aile = aile.makeOffset2D(-3, join=0).makeOffset2D(3, join=0).extrude(Vec(ep, 0, 0))
    s = dessus.fuse(aile).removeSplitter()
    d = s.mirror(Vec(M.LARG / 2, 0, 0), Vec(1, 0, 0))
    for p in (s, d):
        p.rotate(Vec(0, 0, 0), Vec(1, 0, 0), math.degrees(a))
        p.translate(Vec(0, 0, M.HAV))
    return {"baguette_G": s, "baguette_D": d}


def lanceur():
    """lanceur à ressort (Williams B-12445), construit le long de son axe (w = 0 : embout au repos contre la bille,
    w croissant vers le joueur) puis posé dans le repère caisse. Pièces mobiles : tige, pommeau, embout."""
    la = M.LANCEUR
    ax = Vec(*la["axe"])
    pose = App.Placement(Vec(*la["bout"]), App.Rotation(Vec(0, 0, 1), ax)).toMatrix()
    co = math.cos(M.PENTE_PF)
    w_int, w_ext = la["w_facade"] - M.EPC / 2 / co, la["w_facade"] + M.EPC / 2 / co

    def cyl(r, w0, w1):
        return Part.makeCylinder(r, w1 - w0, Vec(0, 0, w0))

    def ressort(d, fil, w0, w1):
        n = max(2, int((w1 - w0) / (fil * 2.6)))
        return Part.Compound([Part.makeTorus(d / 2, fil / 2, Vec(0, 0, w0 + (w1 - w0) * (i + 0.5) / n)) for i in range(n)])

    def place(s):
        s = s.copy(); s.transformShape(pose); return s

    db, lb = la["boitier"]
    cl, ch, ce = la["collerette"]
    dn, ln = la["nez"]
    dre, fre, lre = la["ressort_ext"]
    dp, tp = la["pommeau"]
    w_nez = w_ext + ce
    w_k = w_nez + ln + lre                  # dos du pommeau
    out = {}
    out["lanceur_embout"] = place(cyl(la["embout"][0] / 2, 0, la["embout"][1]))
    tige = cyl(la["tige"] / 2, la["embout"][1] - 1, w_k + tp)
    tige = tige.fuse(cyl(8.0, 28.0, 29.5))                                       # rondelle et circlip
    out["lanceur_tige"] = place(tige)
    out["lanceur_ressort_int"] = place(ressort(la["ressort_int"][0], la["ressort_int"][1], 29.5, w_int - lb + M.EPC))
    out["lanceur_ressort_ext"] = place(ressort(dre, fre, w_nez + ln, w_k))
    cap = Part.makeSphere(dp / 2).cut(Part.makeBox(dp, dp, dp, Vec(-dp / 2, -dp / 2, -dp)))
    m = App.Matrix(); m.scale(1, 1, 0.55)
    cap = cap.transformGeometry(m); cap.translate(Vec(0, 0, w_k + tp))
    out["lanceur_pommeau"] = place(cyl(7.0, w_k, w_k + tp + 0.5).fuse(cap))
    # boîtier : tube à travers la façade, nez chromé ; collerette et platine de fixation à plat sur les faces de la façade
    boit = place(cyl(db / 2, w_int - lb + M.EPC, w_nez).fuse(cyl(dn / 2, w_nez, w_nez + ln)))
    xc, zc = la["trou_facade"]
    zf = zc + (M.EPC / 2) * math.tan(M.PENTE_PF)         # l'axe sur la face avant de la façade (y = 0)
    col = rect_arrondi(xc - cl / 2, zf - ch / 2, cl, ch, 6.0, -ce, ce)
    for dz in (-ch / 2 + 7, ch / 2 - 7):
        col = col.fuse(Part.makeSphere(3.5, Vec(xc, -ce, zf + dz)).cut(Part.makeBox(10, 10, 10, Vec(xc - 5, -ce, zf + dz - 5))))
    pl = Part.makeBox(la["platine"] / math.sqrt(2), 2.0, la["platine"] / math.sqrt(2), Vec(-la["platine"] / math.sqrt(8), 0, -la["platine"] / math.sqrt(8)))
    pl.rotate(Vec(0, 0, 0), Vec(0, 1, 0), 45)
    pl.translate(Vec(xc, M.EPC, zc - (M.EPC / 2) * math.tan(M.PENTE_PF)))
    out["lanceur_boitier"] = boit.fuse(col).fuse(pl)
    return out


def charnieres():
    """charnières du fronton, à l'extérieur des flancs : plaque en goutte (pivot arrondi autour du boulon, haut droit
    sous le fronton) plaquée contre la face extérieure du flanc, en dehors de l'aile de la baguette ; patte repliée à
    plat sous le débord du fond du fronton, 3 boulons avec écrous dans le fronton ; boulon de charnière à travers le
    flanc, écrou dedans. Pièces solidaires du fronton : elles basculent avec lui (le boulon est sur l'axe)."""
    ch = M.CHARNIERE
    E, L, ep, rp = M.EPC, M.LARG, ch["ep"], ch["r_pivot"]
    fr = M.V(CAISSE["fronton"])
    yp, zp = ch["y"], ch["z"]
    lp, wp = ch["patte"]
    ya = M.LONG - fr["p_bas"] + ch["y_patte"]           # début de la patte, sous le fond du fronton
    zb = M.HAR                                           # dessous du fond du fronton
    pts = [(yp + rp * math.cos(a), zp + rp * math.sin(a)) for a in [i * math.pi / 16 for i in range(32)]]
    pts += [(ya, zb), (ya + lp, zb), (ya + lp, zb - 40)]
    # enveloppe convexe (chaîne monotone)
    pts = sorted(set((round(y, 3), round(z, 3)) for y, z in pts))
    def demi(ps):
        h = []
        for p in ps:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    env = demi(pts)[:-1] + demi(pts[::-1])[:-1]
    x1 = -M.V(CAISSE["baguette"])["ep"] - ch["jeu_baguette"]   # face intérieure de la plaque (côté gauche)
    x0 = x1 - ep
    plaque = Part.Face(Part.makePolygon([Vec(x0, y, z) for y, z in env + [env[0]]])).extrude(Vec(ep, 0, 0))
    plaque = plaque.cut(Part.makeCylinder(ch["boulon"] / 2 + 0.3, ep + 2, Vec(x0 - 1, yp, zp), Vec(1, 0, 0)))
    s = plaque.fuse(Part.makeBox(wp, lp, ep, Vec(x0 - wp + ep, ya, zb - ep)))         # patte, vers l'extérieur
    for k in range(ch["vis"]):
        yg, xg = ya + lp * (k + 0.5) / ch["vis"], x0 - wp * 0.5 + ep
        s = s.fuse(Part.makeCylinder(5.5, 4, Vec(xg, yg, zb - ep - 4)))                # tête sous la patte
        s = s.fuse(Part.makeCylinder(3, E + ep + 6, Vec(xg, yg, zb - ep)))
        s = s.fuse(Part.Face(Part.makePolygon([Vec(xg + 5.5 * math.cos(a), yg + 5.5 * math.sin(a), zb + E)
                                               for a in [i * math.pi / 3 for i in range(7)]])).extrude(Vec(0, 0, 5)))
    # boulon de charnière : tête bombée dehors, tige à travers plaque et flanc, écrou dedans
    ra, hc = ch["boulon"] * 1.1, 5.5
    rs = (ra * ra + hc * hc) / (2 * hc)
    s = s.fuse(Part.makeSphere(rs, Vec(x0 + rs - hc, yp, zp)).common(Part.makeBox(hc, 2 * ra, 2 * ra, Vec(x0 - hc, yp - ra, zp - ra))))
    s = s.fuse(Part.makeCylinder(ch["boulon"] / 2, E - x0 + 8, Vec(x0, yp, zp), Vec(1, 0, 0)))
    s = s.fuse(Part.Face(Part.makePolygon([Vec(E, yp + 10 * math.cos(a), zp + 10 * math.sin(a))
                                           for a in [i * math.pi / 3 + math.pi / 6 for i in range(7)]])).extrude(Vec(8, 0, 0)))
    return {"charniere_G": s, "charniere_D": s.mirror(Vec(L / 2, 0, 0), Vec(1, 0, 0))}


def finitions_caisse():
    """finitions des perçages de la caisse : grille chromée et ventilateur 80 mm derrière le trou Ø 86 du panneau
    arrière, grilles à lames noires dans les 2 oblongs d'aération, boulons à tête bombée chromés dans les trous des
    flancs (supports ; le trou de charnière reçoit le boulon de la charnière)"""
    P, E, L, LG = M.PANNEAUX, M.EPC, M.LARG, M.LONG
    out = {}
    # ventilateur (dans la caisse, plaqué sur la face intérieure) et grille de protection (dehors)
    ve = P["arriere"]["ventil"]
    xc, zc, a = E + ve["x"], ve["z"], ve["entraxe"] / 2
    corps = Part.makeBox(80, 25, 80, Vec(xc - 40, LG - E - 25, zc - 40))
    corps = corps.cut(Part.makeCylinder(38, 27, Vec(xc, LG - E - 26, zc), Vec(0, 1, 0)))
    moyeu = Part.makeCylinder(14, 25, Vec(xc, LG - E - 25, zc), Vec(0, 1, 0))
    pales = []
    for i in range(7):
        p = Part.makeBox(22, 1.5, 12, Vec(13, -0.75, -6))
        p.rotate(Vec(0, 0, 0), Vec(1, 0, 0), 30)
        p.rotate(Vec(0, 0, 0), Vec(0, 1, 0), i * 360 / 7)
        p.translate(Vec(xc, LG - E - 12, zc))
        pales.append(p)
    out["finition_ventilateur"] = corps.fuse(moyeu).fuse(Part.Compound(pales))
    y = LG + 1.5
    g = [Part.makeTorus(r, 0.9, Vec(xc, y, zc), Vec(0, 1, 0)) for r in (10, 19, 28, 37, 44)]
    for ang in (45, 135):
        b = Part.makeCylinder(0.9, 2 * (a + 7) * math.sqrt(2), Vec(-(a + 7) * math.sqrt(2), 0, 0), Vec(1, 0, 0))
        b.rotate(Vec(0, 0, 0), Vec(0, 1, 0), ang); b.translate(Vec(xc, y, zc)); g.append(b)
    for sx in (-1, 1):
        for sz in (-1, 1):
            g.append(Part.makeCylinder(6, 1.2, Vec(xc + sx * a, LG, zc + sz * a), Vec(0, 1, 0)))       # pattes vissées
            g.append(Part.makeSphere(4.5, Vec(xc + sx * a, LG + 1.2, zc + sz * a)).common(
                Part.makeBox(10, 5, 10, Vec(xc + sx * a - 5, LG + 1.2, zc + sz * a - 5))))           # têtes de vis
    out["finition_grille_ventil"] = Part.Compound(g)
    # grilles d'aération à lames dans les oblongs : cadre plaqué dehors, lames inclinées dans l'épaisseur
    ob = P["arriere"]["oblongs"]
    gr = []
    for x in (ob["x_gauche"], L - 2 * E - ob["x_gauche"] - ob["l"]):
        x0, z0, l, h = E + x, ob["z"] - ob["h"] / 2, ob["l"], ob["h"]
        cadre = rect_arrondi(x0 - 7, z0 - 7, l + 14, h + 14, h / 2 + 7 - 0.5, LG, 3).cut(
            rect_arrondi(x0, z0, l, h, h / 2 - 0.5, LG - 1, 5))
        trou = rect_arrondi(x0, z0, l, h, h / 2 - 0.5, LG - E, E + 2)
        for k in range(5):
            lame = Part.makeBox(l + 2, 1.6, 14, Vec(-1, -0.8, -7))
            lame.rotate(Vec(0, 0, 0), Vec(1, 0, 0), -40)
            lame.translate(Vec(x0, LG - 6, z0 + h * (k + 0.75) / 5.5))
            cadre = cadre.fuse(lame.common(trou))
        gr.append(cadre)
    out["finition_ouies"] = Part.Compound(gr)
    # boulons de carrosserie : tête bombée sur la face extérieure des flancs
    bo = []
    for t in P["flanc_G"]["trous"]:
        if not t["fonction"].startswith("fixation") or (t["y"], t["z"]) == (M.CHARNIERE["y"], M.CHARNIERE["z"]):
            continue                      # le trou de charnière reçoit le boulon de la charnière
        ra, hc = t["d"] * 1.1, 4.5 + t["d"] * 0.08
        rs = (ra * ra + hc * hc) / (2 * hc)
        tete = Part.makeSphere(rs, Vec(rs - hc, t["y"], t["z"])).common(Part.makeBox(hc, 2 * ra, 2 * ra, Vec(-hc, t["y"] - ra, t["z"] - ra)))
        bo += [tete, tete.mirror(Vec(L / 2, 0, 0), Vec(1, 0, 0))]
    out["finition_boulons"] = Part.Compound(bo)
    return out


def achats_caisse():
    """pièces achetées de la caisse (encombrements) : pieds, barre de verrouillage, baguettes, lanceur, vitre"""
    L, LG = M.LARG, M.LONG
    out = {}
    h_sol = M.H_SOL                       # hauteur du bas de caisse au-dessus du sol (barre de verrouillage ≈ 930 mm)
    recouv = M.PIED["recouvrement"]
    out.update(pieds())
    out["barre_verrouillage"] = barre_verrouillage()
    out.update(baguettes())
    out.update(lanceur())
    out.update(finitions_caisse())
    out.update(charnieres())
    ang = math.atan((M.HAR - M.HAV) / (LG - M.PLAT))
    v = Part.makeBox(L - 2 * M.EPC + 10, 1000, 4, Vec(M.EPC - 5, 0, 0))
    v.rotate(Vec(0, 0, 0), Vec(1, 0, 0), math.degrees(ang))
    v.translate(Vec(0, 45, M.z_dessus_flanc(45) - 24))
    out["vitre"] = v
    return out, h_sol, recouv


# ------------------------------------------------------------------ assemblage, exports
def plac_plateau():
    return App.Placement(Vec(M.X_PF, M.Y_PF_AV, M.Z_PF_AV), App.Rotation(Vec(1, 0, 0), math.degrees(M.PENTE_PF)))


def contour_xy(shape, z=1.0):
    polys = []
    try:
        for w in shape.slice(Vec(0, 0, 1), z):
            pts = w.discretize(Deflection=0.3)
            polys.append([(round(p.x, 2), round(p.y, 2)) for p in pts])
    except Exception:
        pass
    return polys


def exporter_rampe(doc, rapport):
    """rampe en tronçons imprimables (STL) et rampe entière d'un seul tenant (rampe.stl : surface de collision du
    jeu, sans jointure entre tronçons)"""
    rp = next(p for p in M.PIECES if p["id"] == "rampe")
    entiere = doc.getObject("rampe")
    if entiere is None:
        entiere = doc.addObject("Part::Feature", "rampe"); entiere.Shape = construire_rampe(rp)
    Mesh.export([entiere], os.path.join(OUT, "pieces", "rampe.stl"))
    tmax = M.V(M.RAMPE["troncon_max"]); s0, k = 0.0, 1
    while s0 < M.L_RAMPE - 1:
        s1 = min(M.L_RAMPE, s0 + tmax)
        try:
            t = construire_rampe(rp, s0, s1)
            o = doc.addObject("Part::Feature", f"rampe_troncon_{k}"); o.Shape = t
            Mesh.export([o], os.path.join(OUT, "pieces", f"rampe_troncon_{k}.stl"))
            rapport.append((f"rampe_troncon_{k}", "ok", round(t.Volume / 1000, 1)))
        except Exception as e:
            rapport.append((f"rampe_troncon_{k}", f"ÉCHEC {e}", 0))
        s0, k = s1, k + 1


def main():
    if "--rampe" in sys.argv:          # seulement la rampe (tronçons et pièce entière), sans l'assemblage
        doc, rapport = App.newDocument("Rampe"), []
        exporter_rampe(doc, rapport)
        print("ok", rapport)
        return
    doc = App.newDocument("FannyPinball")
    rapport, contours, rendu = [], {}, {"bois": [], "imprime": [], "achat": [], "metal": [], "verre": [], "dessous": []}
    pl = plac_plateau()

    plateau = construire_plateau()
    Part.export([doc.addObject("Part::Feature", "plateau")], os.path.join(OUT, "plateau.step"))
    doc.getObject("plateau").Shape = plateau
    Part.export([doc.getObject("plateau")], os.path.join(OUT, "plateau.step"))
    contours["plateau"] = contour_xy(plateau, -M.EP / 2)
    pp = plateau.copy(); pp.Placement = pl; rendu["bois"].append(pp)

    for p in M.PIECES:
        try:
            s = construire_piece(p)
            if s is None:
                continue
            o = doc.addObject("Part::Feature", p["id"]); o.Shape = s
            o.Label = p["nom"][:60]
            Part.export([o], os.path.join(OUT, "pieces", f"{p['id']}.step"))
            imprime = not p["achat"] and p["type"] not in ("zone",) and "alu" not in p["matiere"]
            if (imprime and p["type"] != "rampe") or p["type"] == "patte" or p["id"] == "sep_lanceur":     # pattes et séparateur alu : STL pour la vue 3D
                Mesh.export([o], os.path.join(OUT, "pieces", f"{p['id']}.stl"))
            z = p.get("z", 0) + 1 if p["type"] == "plaque" else 1.0
            contours[p["id"]] = contour_xy(s, z)
            c = s.copy(); c.Placement = pl.multiply(c.Placement)
            cat = "dessous" if p["type"] in ("zone", "banque", "rollover", "cuvette", "bac") else \
                  "metal" if p["type"] in ("bumper",) or "alu" in p["matiere"] else \
                  "achat" if p["achat"] else "imprime"
            rendu[cat].append(c)
            rapport.append((p["id"], "ok", round(s.Volume / 1000, 1)))
        except Exception as e:
            rapport.append((p["id"], f"ÉCHEC {e}", 0))
            traceback.print_exc()

    exporter_rampe(doc, rapport)

    caisse = construire_caisse()
    for nom, s in caisse.items():
        o = doc.addObject("Part::Feature", nom); o.Shape = s
        Part.export([o], os.path.join(OUT, "caisse", f"{nom}.step"))
        Mesh.export([o], os.path.join(OUT, "caisse", f"{nom}.stl"))      # vue 3D du jeu (outils/cao_web.py)
        rendu["bois"].append(s)
        rapport.append((nom, "ok", round(s.Volume / 1000, 1)))
    achats, h_sol, recouv = achats_caisse()
    for nom, s in achats.items():
        o = doc.addObject("Part::Feature", nom); o.Shape = s
        # maillage borné : les tores des ressorts donneraient des dizaines de Mo au maillage par défaut
        fin = "ressort" not in nom
        MeshPart.meshFromShape(Shape=s, LinearDeflection=0.15 if fin else 0.4, AngularDeflection=0.35 if fin else 0.9).write(
            os.path.join(OUT, "caisse", f"{nom}.stl"))
        rendu["verre" if nom == "vitre" else "metal"].append(s)

    # objets placés dans l'assemblage (plateau et pièces inclinés)
    for o in doc.Objects:
        if o.Name == "plateau" or any(o.Name == p["id"] for p in M.PIECES) or o.Name.startswith("rampe_troncon"):
            o.Placement = pl.multiply(o.Placement)
    doc.recompute()
    doc.saveAs(os.path.join(OUT, "assemblage.FCStd"))
    Part.export([o for o in doc.Objects if not o.Name.startswith("rampe_troncon") or True], os.path.join(OUT, "assemblage.step"))

    for cat, shapes in rendu.items():
        if shapes:
            m = Mesh.Mesh()
            for s in shapes:
                m.addMesh(Mesh.Mesh(s.tessellate(0.4)))
            m.write(os.path.join(OUT, "rendu", f"{cat}.stl"))

    json.dump({"contours": contours, "h_sol": h_sol, "recouvrement_pieds": recouv}, open(os.path.join(OUT, "contours.json"), "w"))
    with open(os.path.join(OUT, "rapport.txt"), "w") as f:
        for r in rapport:
            f.write(f"{r[0]:28s} {r[1]:12s} {r[2]} cm³\n")
    print("ok", len(rapport), "objets ;", sum(1 for r in rapport if r[1] != "ok"), "échecs")


if __name__ == "__main__":
    main()
