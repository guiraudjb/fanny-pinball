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


def bloc(pts, h, r=0.0, marge=0.0, z0=0.0):
    return face_poly(pts, r, marge, z0).extrude(Vec(0, 0, h))


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


def construire_rallonge():
    """rallonge fixe, repère plateau : de Y = H à Y = H + h, encoche des câbles au milieu du bord arrière"""
    R = M.RALLONGE
    r = Part.makeBox(R["l"], R["h"], R["ep"], Vec(0, M.H, -R["ep"]))
    en = R["encoche"]
    return r.cut(Part.makeBox(en["l"], en["p"] + 1, R["ep"] + 2, Vec(R["l"] / 2 - en["l"] / 2, M.H + R["h"] - en["p"], -R["ep"] - 1)))


# ------------------------------------------------------------------ pièces
def construire_piece(p):
    k = p["type"]
    if k == "ruban":
        s = ruban(p["pts"], p["t"], p["h"])
        if p.get("decoupe_plateau"):
            s = s.common(Part.makeBox(M.W, M.H, 200, Vec(0, 0, -50)))
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
        if p["id"] == "piece_bouchon":                 # sous la rampe qui monte depuis l'entrée
            s = s.cut(gabarit_rampe(rampe, 2.0, lambda q: 60 < q[3] < 220))
        if p["id"] == "piece_bouchon":
            for q in M.POCHES_BOUCHON:                     # poche du boîtier de POINTER
                s = s.cut(bloc(q, p["h"] + 2, 0, 0, -1))
        if p["id"] == "mur_cibles":
            for x0, y0, l, w in M.POCHES_MUR:              # poches des unités de cible ronde, ouvertes vers le plateau
                s = s.cut(Part.makeBox(l, w, p["h"] + 2, tv(x0, y0 + w, -1)))
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
        for (x, y) in p.get("fix", []):
            s = s.cut(Part.makeCylinder(1.75, p["ep"] + 2, tv(x, y, p["z"] - 1)))
        if p.get("sous_rampe"):                        # échancré là où la rampe passe plus bas que lui ; on garde le gros morceau
            s = s.cut(gabarit_rampe(next(q for q in M.PIECES if q["id"] == "rampe"), 2.0, lambda q: q[3] < 220))
            s = max(s.Solids, key=lambda o: o.Volume)
        for (x, y) in p.get("entretoises", []):        # entretoises Ø 7 sous la plaque, vis M3 traversante
            e = Part.makeCylinder(3.5, p["h_entretoise"], tv(x, y, p["z"] - p["h_entretoise"]))
            s = s.fuse(e).cut(Part.makeCylinder(1.6, p["h_entretoise"] + p["ep"] + 2, tv(x, y, p["z"] - p["h_entretoise"] - 1)))
        return s.removeSplitter()
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


def section_rampe(x, y, z, dx, dy, p):
    """profil en U (fond + 2 flancs) perpendiculaire à la direction (dx, dy) — repère table"""
    nx, ny = -dy, dx
    hw, e, h = p["larg"] / 2, p["ep"], p["h"]
    prof = [(-hw - e, -e), (hw + e, -e), (hw + e, h), (hw, h), (hw, 0), (-hw, 0), (-hw, h), (-hw - e, h)]
    pts = [tv(x + nx * a, y + ny * a, z + b) for a, b in prof]
    return Part.makePolygon(pts + [pts[0]])


def gabarit_rampe(p, jeu, garde=lambda q: q[0] > 350 and q[1] > 330):
    """volume réservé à la rampe : de jeu mm sous son fond jusqu'à 200 mm, largeur hors tout + 2 × jeu,
    sur les points retenus par « garde » (par défaut : la descente le long du mur droit)"""
    fils = []
    hw = p["larg"] / 2 + p["ep"] + jeu
    q3 = [q for q in p["pts3d"] if garde(q)]
    for i, (x, y, z, s) in enumerate(q3):
        a = q3[max(0, i - 1)]; b = q3[min(len(q3) - 1, i + 1)]
        dx, dy = M.unit((b[0] - a[0], b[1] - a[1])); nx, ny = -dy, dx
        pts = [tv(x + nx * u, y + ny * u, z + w) for u, w in ((-hw, -jeu), (hw, -jeu), (hw, 200), (-hw, 200))]
        fils.append(Part.makePolygon(pts + [pts[0]]))
    solide = None
    for w1, w2 in zip(fils, fils[1:]):
        lo = Part.makeLoft([w1, w2], True, True)
        solide = lo if solide is None else solide.fuse(lo)
    return solide


def construire_rampe(p, s_min=None, s_max=None):
    pts = [q for q in p["pts3d"] if (s_min is None or q[3] >= s_min - 1e-6) and (s_max is None or q[3] <= s_max + 1e-6)]
    fils = []
    for i, (x, y, z, s) in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        d = M.unit((b[0] - a[0], b[1] - a[1]))
        fils.append(section_rampe(x, y, z + p["ep"], d[0], d[1], p))
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


def achats_caisse():
    """pièces achetées de la caisse (encombrements) : pieds, barre de verrouillage, vitre"""
    L, LG = M.LARG, M.LONG
    out = {}
    h_sol = M.H_SOL                       # hauteur du bas de caisse au-dessus du sol (barre de verrouillage ≈ 930 mm)
    recouv = M.PIED["recouvrement"]
    out.update(pieds())
    out["barre_verrouillage"] = Part.makeBox(L, 70, 25, Vec(0, -10, M.HAV))
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


def main():
    doc = App.newDocument("FannyPinball")
    rapport, contours, rendu = [], {}, {"bois": [], "imprime": [], "achat": [], "metal": [], "verre": [], "dessous": []}
    pl = plac_plateau()

    plateau = construire_plateau()
    Part.export([doc.addObject("Part::Feature", "plateau")], os.path.join(OUT, "plateau.step"))
    doc.getObject("plateau").Shape = plateau
    Part.export([doc.getObject("plateau")], os.path.join(OUT, "plateau.step"))
    contours["plateau"] = contour_xy(plateau, -M.EP / 2)
    pp = plateau.copy(); pp.Placement = pl; rendu["bois"].append(pp)
    ra = construire_rallonge()
    ra.Placement = pl                      # posée dans la caisse : exportée avec la caisse
    o = doc.addObject("Part::Feature", "rallonge"); o.Shape = ra
    Part.export([o], os.path.join(OUT, "caisse", "rallonge.step"))
    Mesh.export([o], os.path.join(OUT, "caisse", "rallonge.stl"))
    rendu["bois"].append(ra)
    rapport.append(("rallonge", "ok", round(ra.Volume / 1000, 1)))

    for p in M.PIECES:
        try:
            s = construire_piece(p)
            if s is None:
                continue
            o = doc.addObject("Part::Feature", p["id"]); o.Shape = s
            o.Label = p["nom"][:60]
            Part.export([o], os.path.join(OUT, "pieces", f"{p['id']}.step"))
            imprime = not p["achat"] and p["type"] not in ("zone",) and "alu" not in p["matiere"]
            if imprime and p["type"] != "rampe":
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

    # rampe en tronçons imprimables
    rp = next(p for p in M.PIECES if p["id"] == "rampe")
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
        Mesh.export([o], os.path.join(OUT, "caisse", f"{nom}.stl"))
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


main()
