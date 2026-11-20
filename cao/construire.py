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
            outils.append(oblong_outil(t["x"], t["y"], t["l"], t["w"], -t["angle"], M.EP + 2, -M.EP - 1))
    for o in outils:
        pf = pf.cut(o)
    return pf


# ------------------------------------------------------------------ pièces
def construire_piece(p):
    k = p["type"]
    if k == "ruban":
        s = ruban(p["pts"], p["t"], p["h"])
        if p.get("decoupe_plateau"):
            s = s.common(Part.makeBox(M.W, M.H, 200, Vec(0, 0, -50)))
        return inserts(s, p["fix"])
    if k == "bloc":
        return inserts(bloc(p["pts"], p["h"], p.get("r", 0)).common(Part.makeBox(M.W, M.H, 200, Vec(0, 0, -50))), p["fix"])
    if k == "poteau":
        s = Part.makeCylinder(p["d"] / 2, p["h"], tv(p["x"], p["y"]))
        s = s.cut(Part.makeCylinder(2.0, 6.0, tv(p["x"], p["y"])))                    # insert M3 en bas
        return s.cut(Part.makeCylinder(2.0, 6.0, tv(p["x"], p["y"], p["h"] - 6)))      # et en haut (plastique)
    if k == "plaque":
        s = bloc(p["pts"], p["ep"], p.get("r", 0), p.get("marge", 0), p["z"])
        for (x, y) in p.get("fix", []):
            s = s.cut(Part.makeCylinder(1.75, p["ep"] + 2, tv(x, y, p["z"] - 1)))
        return s
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
        b = Part.makeBox(24, 4, 36, Vec(-12, -2, 0))
        b.rotate(Vec(0, 0, 0), Vec(0, 0, 1), -math.degrees(p["angle"]))
        b.translate(tv(p["x"], p["y"]))
        return b
    if k == "cible":
        x, y, r, n = p["x"], p["y"], p["r"], p["n"]
        ang = math.degrees(math.atan2(-n[1], n[0]))              # direction de la face dans le repère plateau
        face = Part.makeCylinder(r, 4, Vec(0, 0, 0), Vec(1, 0, 0))
        face.translate(Vec(-2, 0, max(r, 12)))
        boitier = Part.makeBox(22, 32, 28, Vec(-24, -16, 0))
        u = face.fuse(boitier)
        u.rotate(Vec(0, 0, 0), Vec(0, 0, 1), ang)
        u.translate(tv(x, y))
        return inserts(u, p["fix"])
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
    return out


def achats_caisse():
    """pièces achetées de la caisse (encombrements) : pieds, barre de verrouillage, vitre"""
    L, LG = M.LARG, M.LONG
    out = {}
    h_sol = 930.0 - M.HAV                 # hauteur du bas de caisse au-dessus du sol (barre de verrouillage ≈ 930 mm)
    recouv = M.V(CAISSE["pieds"])["l"] - h_sol
    for nom, x, y in (("pied_AVG", -63, 0), ("pied_AVD", L, 0), ("pied_ARG", -63, LG - 63), ("pied_ARD", L, LG - 63)):
        out[nom] = Part.makeBox(63, 63, M.V(CAISSE["pieds"])["l"], Vec(x if x >= 0 else 0 - 63 + 63 * 0, y, -h_sol))
        out[nom] = Part.makeBox(63, 63, M.V(CAISSE["pieds"])["l"], Vec(x, y, -h_sol))
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
            cat = "dessous" if p["type"] in ("zone", "rollover", "cuvette", "bac") else \
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
        rendu["bois"].append(s)
        rapport.append((nom, "ok", round(s.Volume / 1000, 1)))
    achats, h_sol, recouv = achats_caisse()
    for nom, s in achats.items():
        o = doc.addObject("Part::Feature", nom); o.Shape = s
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
