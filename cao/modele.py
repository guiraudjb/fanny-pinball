"""Modèle de construction commun à la CAO (FreeCAD) et aux plans cotés (matplotlib).

Repère « table » (celui de js/table.js) : x vers la droite, y vers le BAS, origine coin haut gauche.
Repère « plateau » des plans : X depuis le bord GAUCHE, Y depuis le bord AVANT (côté joueur), Z vers le haut.
  → X = x, Y = H − y.

Rien ici ne dépend de FreeCAD : uniquement des listes de points, de trous et de pièces.
"""
import json
import math
from pathlib import Path

from cotes import CAISSE, CAOUTCHOUCS, CIBLES, DETECTION, LAMPES, MECA, PLATEAU, RAMPE, VISSERIE

ICI = Path(__file__).resolve().parent
G = json.load(open(ICI / "geometrie.json", encoding="utf-8"))
W, H, CX, BALL_R = G["W"], G["H"], G["CX"], G["BALL_R"]
GEO = G["GEO"]
V = lambda d: d["v"]  # noqa: E731

EP = V(PLATEAU["ep"])
H_PAROI = V(PLATEAU["h_paroi"])
PAS_FIX = V(VISSERIE["pas_fixation"])
T_VIS = V(VISSERIE["vis_m3_dessous"])["trou_plateau"]


def P(x, y):
    """table → plateau"""
    return (x, H - y)


# ------------------------------------------------------------------ outils géométriques (repère table)
def dist(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def unit(v):
    l = math.hypot(*v) or 1
    return (v[0] / l, v[1] / l)


def le_long(pts, pas, marge=10):
    """Points régulièrement espacés le long d'une polyligne (au plus « pas » entre deux), marges aux bouts."""
    segs = [(pts[i], pts[i + 1], dist(pts[i], pts[i + 1])) for i in range(len(pts) - 1)]
    L = sum(s[2] for s in segs)
    if L <= 2 * marge:
        return [((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)]
    n = max(1, math.ceil((L - 2 * marge) / pas))
    cibles = [marge + (L - 2 * marge) * k / n for k in range(n + 1)]
    out, acc, i = [], 0.0, 0
    for s in cibles:
        while i < len(segs) - 1 and acc + segs[i][2] < s:
            acc += segs[i][2]; i += 1
        a, b, l = segs[i]
        t = (s - acc) / (l or 1)
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def dans_poly(p, poly):
    x, y = p; c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def d_seg(p, a, b):
    ab = sub(b, a); ap = sub(p, a)
    t = max(0, min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) or 1)))
    return dist(p, (a[0] + ab[0] * t, a[1] + ab[1] * t))


def d_bord(p, poly):
    return min(d_seg(p, poly[i - 1], poly[i]) for i in range(len(poly)))


def fixations_poly(poly, marge=7, pas=None):
    """Points de fixation d'une pièce pleine : grille intérieure à « marge » des bords, au plus « pas » d'écart."""
    pas = pas or PAS_FIX * 0.75
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    cand = []
    nx = max(1, math.ceil((max(xs) - min(xs)) / pas)); ny = max(1, math.ceil((max(ys) - min(ys)) / pas))
    for i in range(nx + 1):
        for j in range(ny + 1):
            p = (min(xs) + (max(xs) - min(xs)) * (i + 0.5) / (nx + 1), min(ys) + (max(ys) - min(ys)) * (j + 0.5) / (ny + 1))
            if dans_poly(p, poly) and d_bord(p, poly) >= marge:
                cand.append(p)
    if not cand:   # pièce fine : on cherche le point le plus intérieur
        best = max(((min(xs) + (max(xs) - min(xs)) * i / 20, min(ys) + (max(ys) - min(ys)) * j / 20)
                    for i in range(21) for j in range(21)),
                   key=lambda p: d_bord(p, poly) if dans_poly(p, poly) else -1)
        cand = [best]
    return cand


# ------------------------------------------------------------------ pièces posées sur le plateau
PIECES = []      # dict : id, nom, type, matiere, achat, …
TROUS = []       # dict : id, fonction, forme ('rond'|'oblong'|'poly'), x, y (table), d | (l, w, angle) | pts, src, traversant


def piece(**k):
    k.setdefault("achat", False); k.setdefault("matiere", "PETG imprimé"); k.setdefault("fix", [])
    PIECES.append(k)
    for i, f in enumerate(k["fix"]):
        TROUS.append({"id": f"{k['id']}.F{i + 1}", "fonction": f"fixation {k['nom']} (vis M3 par dessous → insert)",
                      "forme": "rond", "x": f[0], "y": f[1], "d": T_VIS, "src": "choix", "groupe": "fixation"})
    return k


def trou(id, fonction, x, y, d=None, src="choix", groupe="mécanisme", **k):
    TROUS.append({"id": id, "fonction": fonction, "forme": k.pop("forme", "rond"), "x": x, "y": y, "d": d,
                  "src": src, "groupe": groupe, **k})


def ruban(id, nom, pts, t, h=H_PAROI, **k):
    return piece(id=id, nom=nom, type="ruban", pts=pts, t=t, h=h, fix=le_long(pts, PAS_FIX), **k)


# --- guide d'arche (face intérieure = l'ellipse du jeu), coupé au bord du plateau
e = GEO["ellipse"]
arc = []
for i in range(73):
    a = math.pi + math.pi * i / 72
    nx, ny = math.cos(a) / e["rx"], math.sin(a) / e["ry"]; nl = math.hypot(nx, ny)
    arc.append((e["cx"] + e["rx"] * math.cos(a) + nx / nl * 5, e["cy"] + e["ry"] * math.sin(a) + ny / nl * 5))
arc_fix = [p for p in le_long(arc, PAS_FIX, 40) if 6 < p[0] < W - 6 and p[1] > 6]
piece(id="arche", nom="Guide d'arche", type="ruban", pts=arc, t=10, h=H_PAROI, decoupe_plateau=True,
      fix=arc_fix, note="en tronçons de 200 mm maxi ; face intérieure = arrondi du jeu")

# --- séparateur du couloir de lancement
ls = GEO["laneSep"]
ruban("sep_lanceur", "Séparateur du couloir de lancement (s'arrête au tablier)", [(ls["x"], ls["y1"]), (ls["x"], GEO["apron"]["lane"] - 6)], ls["t"],
      matiere="plat alu 4 × 30", achat=True)

# --- guides des couloirs de retour (dans le prolongement des flippers) : ils s'arrêtent avant l'anneau du poteau d'entrée
Z_CAOUT = V(CAOUTCHOUCS["z"])
_cp = V(CAOUTCHOUCS["poteau"])


def recule(pts, d):
    """polyligne raccourcie de d à son début"""
    u = unit(sub(pts[1], pts[0]))
    return [(pts[0][0] + u[0] * d, pts[0][1] + u[1] * d)] + [tuple(p) for p in pts[1:]]


for i, s in enumerate(GEO["separators"]):
    ruban(f"guide_retour_{'GD'[i]}", f"Guide de couloir de retour {'gauche droit'.split()[i]}", recule(s, 6), 8)
for i, s in enumerate(GEO.get("dividers", [])):
    ruban(f"separateur_retour_{'GD'[i]}", f"Séparateur des couloirs de retour {'gauche droit'.split()[i]}", recule(s, 6), 8)
# --- déflecteur
for i, d in enumerate(GEO["deflectors"]):
    ruban(f"deflecteur_{i + 1}", "Déflecteur latéral", d, 8)
# --- guide du couloir bonus (vers T-O-U-R)
for i, bg in enumerate(GEO.get("bonusGuides", [])):
    ruban(f"guide_bonus_{i + 1}", "Guide du couloir bonus (vers T-O-U-R)", recule(bg, 6), 8)
# --- guides des couloirs T-O-U-R
for i, lp in enumerate(GEO["lanePosts"]):
    ruban(f"guide_tour_{i + 1}", f"Guide de couloir T-O-U-R n° {i + 1}", [(lp["x"], lp["y1"]), (lp["x"], lp["y2"])], 6)

# --- entrée de rampe : pas de parois, la rampe elle-même s'évase en bouche de 52 mm (voir la pièce « rampe »)

# --- blocs : carcasse du bouchon (creuse, parois de 6 mm, plots de fixation), mur des cibles rondes, banque F-A-N-N-Y
EP_CARCASSE = 6.0
_bp = GEO["bouchonPiece"]
_bras = [_bp[i] for i in (2, 3, 4, 5)]                 # bras entre le couloir du bouchon et l'entrée de rampe : un plot au milieu
_fix_bp = fixations_poly(_bp, marge=9, pas=28) + [(sum(p[0] for p in _bras) / 4, sum(p[1] for p in _bras) / 4)]
piece(id="piece_bouchon", nom="Carcasse du bouchon (parois 6 mm, creuse, plots Ø 9)", type="bloc", pts=_bp, r=9,
      h=H_PAROI, creux=EP_CARCASSE, fix=_fix_bp, decoupe_plateau=True)
for wb in G["walls"]:
    if wb.get("plugin") and wb["plugin"].get("housing"):
        pts = [tuple(v) for v in wb["verts"]]
        cx = sum(p[0] for p in pts) / len(pts)
        if cx < W / 2:
            pid, nom = "mur_cibles", "Mur des cibles rondes (3 poches pour les unités de cible)"
        else:
            pid, nom = "bloc_fanny", "Bloc arrière de la banque F-A-N-N-Y"
        piece(id=pid, nom=nom, type="bloc", pts=pts, r=6, h=H_PAROI, fix=fixations_poly(pts), decoupe_plateau=True)

# --- poteaux (caoutchouc acheté) : coins des lance-pierres, bouts des guides
POTEAU_D = 10
_cs = V(CAOUTCHOUCS["sling"])


def poteaux_sling(s):
    """poteaux d'un lance-pierre : centres définis directement dans js/table.js (GEO['slings'][i]['posts']),
    de sorte que l'anneau (gorge + corde = 8 mm) affleure le couloir de 34 mm, la ligne parallèle au guide
    et la face de frappe (entraxe 101 mm du gabarit 500-5849)."""
    if "posts" in s:
        return [tuple(p) for p in s["posts"]]
    pts = [tuple(p) for p in s["pts"]]
    off = _cs["gorge_d"] / 2 + _cs["cord"]
    A, C = pts[s["face"][0]], pts[s["face"][1]]
    B = [p for k, p in enumerate(pts) if k not in s["face"]][0]
    m = ((A[0] + C[0]) / 2, (A[1] + C[1]) / 2)
    e_ = unit(sub(C, A)); n = (-e_[1], e_[0])
    if n[0] * (B[0] - m[0]) + n[1] * (B[1] - m[1]) < 0:
        n = (-n[0], -n[1])
    A2, C2 = (A[0] + n[0] * off, A[1] + n[1] * off), (C[0] + n[0] * off, C[1] + n[1] * off)
    # B : intersection des deux côtés BA et BC décalés vers l'intérieur
    def dec(P, Q):
        u = unit(sub(Q, P)); v = (-u[1], u[0])
        cen = ((A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3)
        if v[0] * (cen[0] - P[0]) + v[1] * (cen[1] - P[1]) < 0:
            v = (-v[0], -v[1])
        return (P[0] + v[0] * off, P[1] + v[1] * off), u
    (p1, u1), (p2, u2) = dec(B, A), dec(B, C)
    det = u1[0] * (-u2[1]) - u1[1] * (-u2[0])
    t = ((p2[0] - p1[0]) * (-u2[1]) - (p2[1] - p1[1]) * (-u2[0])) / det
    B2 = (p1[0] + u1[0] * t, p1[1] + u1[1] * t)
    out = list(pts)
    out[s["face"][0]], out[s["face"][1]] = A2, C2
    out[[k for k in range(3) if k not in s["face"]][0]] = B2
    return out


poteaux = []          # (x, y, type d'anneau)
for s in GEO["slings"]:
    poteaux += [(x, y, "sling") for x, y in poteaux_sling(s)]
for s in GEO["separators"] + GEO.get("dividers", []) + GEO.get("bonusGuides", []):
    poteaux.append((s[0][0], s[0][1], "poteau"))
for i, (x, y, ty) in enumerate(poteaux):
    g = V(CAOUTCHOUCS[ty])
    piece(id=f"poteau_{i + 1}", nom=f"Poteau Ø 10, gorge Ø {g['gorge_d']:g} (anneau caoutchouc acheté)", type="poteau",
          x=x, y=y, d=POTEAU_D, h=H_PAROI + 6, fix=[(x, y)], gorge=(g["gorge_d"], Z_CAOUT, g["cord"] + 0.5))

# caoutchoucs achetés (vue 3D, nomenclature) : anneaux des poteaux d'entrée, anneaux des lance-pierres
_tailles, _tension = V(CAOUTCHOUCS["tailles"]), V(CAOUTCHOUCS["tension"])


def taille_anneau(perimetre):
    """anneau du commerce (ID en pouces) le plus proche de l'ID tendu voulu"""
    voulu = _tension * perimetre / math.pi / 25.4
    return min(_tailles, key=lambda t: abs(t - voulu))


ANNEAUX = []
for x, y, ty in poteaux:
    if ty == "poteau":
        ANNEAUX.append({"type": "poteau", "x": x, "y": y, "z": Z_CAOUT, "r": _cp["gorge_d"] / 2, "cord": _cp["cord"],
                        "id_pouces": 0.125})
for s in GEO["slings"]:
    ps = poteaux_sling(s)
    rc = _cs["gorge_d"] / 2 + _cs["cord"] / 2               # rayon de la ligne moyenne de la corde autour d'un poteau
    perim = sum(dist(ps[k], ps[(k + 1) % 3]) for k in range(3)) + 2 * math.pi * rc
    ANNEAUX.append({"type": "sling", "poteaux": ps, "z": Z_CAOUT, "r": _cs["gorge_d"] / 2, "cord": _cs["cord"],
                    "face": s["face"], "id_pouces": taille_anneau(perim)})

# --- lance-pierres : plastique décoré posé sur les 3 poteaux (+2 mm autour du caoutchouc) + mécanisme acheté
for i, s in enumerate(GEO["slings"]):
    pps = poteaux_sling(s)
    piece(id=f"plastique_sling_{'GD'[i]}", nom=f"Plastique de lance-pierre {'gauche droit'.split()[i]}", type="plaque",
          pts=pps, r=0, ep=3, z=H_PAROI + 6, marge=s.get("rPlast", 10), vis=pps,
          matiere="PETG 3 mm décoré (ou acrylique 3 mm)")
    A, C = pps[s["face"][0]], pps[s["face"][1]]          # poteaux de la face : le gabarit du mécanisme s'y pose
    m = ((A[0] + C[0]) / 2, (A[1] + C[1]) / 2)
    B = [p for k, p in enumerate(pps) if k not in s["face"]][0]
    n = unit(sub(B, m))
    # gabarit Pinball Makers posé sur les deux poteaux de la face : milieu sur milieu, axe sur axe, « intérieur » vers B
    gb = V(MECA["sling_gabarit"])
    g1, g2 = gb["poteaux"]
    gm = ((g1[0] + g2[0]) / 2, (g1[1] + g2[1]) / 2)
    gd = unit(sub(g2, g1)); gv = (-gd[1], gd[0])
    if A[1] < C[1]:
        A, C = C, A                       # A = poteau avant (côté flippers), comme le poteau bas du gabarit
    e_ = unit(sub(C, A))
    nv = (-e_[1], e_[0])
    if (nv[0] * (B[0] - m[0]) + nv[1] * (B[1] - m[1])) < 0:
        nv = (-nv[0], -nv[1])
    sgn_g = 1 if sum((p[0] - gm[0]) * gv[0] + (p[1] - gm[1]) * gv[1] for p in gb["passages"]) > 0 else -1

    def gab(p):
        r = sub(p, gm)
        u_, v_ = r[0] * gd[0] + r[1] * gd[1], (r[0] * gv[0] + r[1] * gv[1]) * sgn_g
        return (m[0] + e_[0] * u_ + nv[0] * v_, m[1] + e_[1] * u_ + nv[1] * v_)
    b1, b2 = gab(gb["bras"][0]), gab(gb["bras"][1])
    bras = ((b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2)
    ang = math.degrees(math.atan2(b2[1] - b1[1], b2[0] - b1[0]))
    l, w = V(MECA["sling_lumiere"])
    trou(f"sling_{'GD'[i]}.bras", "lumière du bras de lance-pierre", *bras, forme="oblong", l=l, w=w, angle=ang, src="PM")
    piece(id=f"meca_sling_{'GD'[i]}", nom="Ensemble lance-pierre (acheté)", type="zone", x=bras[0], y=bras[1],
          dims=V(MECA["sling_zone"]), angle=ang, achat=True, matiere="acheté (type 500-5849)")
    for k, p in enumerate(gb["passages"]):   # contacts à lames derrière le caoutchouc (gabarit)
        trou(f"sling_{'GD'[i]}.lame{k + 1}", "passage du contact à lames (gabarit)", *gab(p), d=gb["d_passage"], src="PM")

# --- flippers (achetés)
for f in GEO["flippers"]:
    trou(f"flipper_{f['side']}", "bague du flipper", f["px"], f["py"], d=V(MECA["flipper_bague"]), src=MECA["flipper_bague"]["src"])
    fz = V(MECA["flipper_zone"])
    piece(id=f"meca_flipper_{f['side']}", nom=f"Mécanisme de flipper {'gauche' if f['side'] == 'L' else 'droit'} (acheté)",
          type="zone", x=f["px"] + (1 if f["side"] == "L" else -1) * fz["centre"][0], y=f["py"] + fz["centre"][1], dims=fz["dims"], angle=0,
          achat=True, matiere="acheté")
    piece(id=f"palette_{f['side']}", nom="Palette de flipper 3\" (achetée)", type="palette", flip=f, achat=True, matiere="acheté")

# --- bumpers (ensembles achetés, chapeau imprimé)
for i, b in enumerate(GEO["bumpers"]):
    trou(f"bumper_{i + 1}.base", "base du bumper (+ 2 encoches de clavette à 45°)", b["x"], b["y"], d=V(MECA["bumper_centre"]), src="PM")
    ex = V(MECA["bumper_entraxe_tiges"]) / 2
    for k, sg in enumerate((-1, 1)):
        trou(f"bumper_{i + 1}.tige{k + 1}", "tige de l'anneau du bumper", b["x"] + sg * ex, b["y"], d=V(MECA["bumper_tiges"]), src="PM")
    bv = V(MECA["bumper_vis"])
    for k, (dx, dy) in enumerate(bv["pos"]):
        trou(f"bumper_{i + 1}.vis{k + 1}", "avant-trou de vis de la base du bumper", b["x"] + dx, b["y"] - dy, d=bv["d"], src="PM")
    piece(id=f"bumper_{i + 1}", nom="Ensemble bumper (acheté) + chapeau « boule de pétanque » imprimé", type="bumper",
          x=b["x"], y=b["y"], r=b["r"], cap=b["cap"], achat=True, matiere="acheté + chapeau PETG translucide")
    piece(id=f"meca_bumper_{i + 1}", nom="Bobine du bumper (achetée)", type="zone", x=b["x"], y=b["y"],
          dims=V(MECA["bumper_zone"]), angle=0, achat=True, matiere="acheté")

# --- cibles tombantes F-A-N-N-Y (banque achetée)
l, w = V(MECA["drop_lumiere"])
for i, d in enumerate(GEO["drops"]):
    trou(f"drop_{d['letter']}{i + 1}", f"lumière de la cible tombante {d['letter']}", d["x"], d["y"], forme="oblong", l=l, w=w,
         angle=math.degrees(d["angle"]), src=MECA["drop_lumiere"]["src"])
    piece(id=f"cible_drop_{i + 1}", nom=f"Cible tombante {d['letter']} (lame de la banque achetée)", type="drop", x=d["x"], y=d["y"],
          angle=d["angle"], achat=True, matiere="acheté", lettre=d["letter"])
d0, d4 = GEO["drops"][0], GEO["drops"][-1]
piece(id="meca_drop", nom="Banque de 5 cibles tombantes (achetée) : châssis, bobine de remise, barre", type="banque",
      x=(d0["x"] + d4["x"]) / 2, y=(d0["y"] + d4["y"]) / 2, dims=V(MECA["drop_zone"]), angle=math.degrees(d0["angle"]),
      achat=True, matiere="acheté")

# --- cibles fixes : POINTER, TIRER, cochonnet, et les 3 cibles rondes du mur gauche (unités imprimées)
# Repère d'une cible : u vers la bille (normale de la face), v en travers, z vers le haut. La face (disque + bras) pend
# sous un axe acier Ø 3 tenu par les deux joues du boîtier ; le levier du KW11, sur la paroi du fond, la rappelle en avant.
CF = V(CIBLES["fixe"])
VISEE = (CX, H - 200)   # les faces regardent vers les flippers


def cible_fixe(cid, label, x, y, r, n, dans_mur=False):
    t = (-n[1], n[0])
    P_ = lambda u, v: (x + n[0] * u + t[0] * v, y + n[1] * u + t[1] * v)  # noqa: E731
    zc = max(r + 1, Z_CAOUT)                                 # centre de la face
    z_axe = zc + r + 3
    w = 2 * r + 2 * CF["jeu"] + 2 * CF["paroi"]               # largeur hors tout du boîtier
    geo = {"x": x, "y": y, "r": r, "n": n, "zc": zc, "z_axe": z_axe, "w": w, "u_axe": -CF["recul_axe"],
           "prof": CF["profondeur"]}
    fix = [P_(-CF["profondeur"] + 7, w / 2 - 5), P_(-CF["profondeur"] + 7, -(w / 2 - 5))]
    piece(id=f"cible_{cid}", nom=f"Boîtier de la cible {label} (joues, axe Ø 3, KW11)", type="cible", fix=fix, **geo)
    piece(id=f"face_{cid}", nom=f"Face pendulaire de la cible {label} (Ø {2 * r:.0f})", type="cible_face", **geo,
          axe=(*P_(geo["u_axe"], 0), z_axe), axe_dir=t)
    dos = P_(-CF["profondeur"] + 14, 0)
    trou(f"cible_{cid}.fils", f"passe-fil du KW11 de la cible {label}", *dos, d=V(VISSERIE["passe_fil"]), groupe="passe-fil")
    return geo


# POINTER : encastrée dans la pièce du bouchon, à gauche de la bouche du couloir (normale du jeu)
POCHES_BOUCHON = []
for s in GEO["standups"]:
    if s.get("n"):
        n = (s["n"]["x"], s["n"]["y"])
    elif s["id"] == "bouchon":
        L = GEO["bouchonLane"]; n = (-L["u"]["x"], -L["u"]["y"])
    else:
        n = unit(sub(VISEE, (s["x"], s["y"])))
    g = cible_fixe(s["id"], s["label"], s["x"], s["y"], s["r"], n)
    if s.get("n"):                                           # poche : boîtier + 0,5 de jeu, ouverte vers le plateau
        t, a, b = (-n[1], n[0]), g["w"] / 2 + 0.5, g["prof"] + 1
        P_ = lambda u, v: (s["x"] + n[0] * u + t[0] * v, s["y"] + n[1] * u + t[1] * v)  # noqa: E731
        POCHES_BOUCHON.append([P_(8, -a), P_(8, a), P_(-b, a), P_(-b, -a)])
# cibles rondes : face avant à x + 1 (bord du corps de rebond du jeu), logées dans des poches du mur
POCHES_MUR = []
for t_ in GEO["leftTargets"]:
    g = cible_fixe(t_["id"], f"ronde {t_['id'][-1]}", t_["x"] - 1, t_["y"], t_["r"], (1.0, 0.0), dans_mur=True)
    POCHES_MUR.append((g["x"] - g["prof"] - 1, g["y"] - g["w"] / 2 - 0.5, g["prof"] + 4, g["w"] + 1))
# fixations de la pièce du bouchon hors de la poche de POINTER
_pb = next(p for p in PIECES if p["id"] == "piece_bouchon")
_dans_pb = lambda f: any(dans_poly(f, q) or d_bord(f, q) < 5 for q in POCHES_BOUCHON)  # noqa: E731
_ids = {f"piece_bouchon.F{i + 1}" for i, f in enumerate(_pb["fix"]) if _dans_pb(f)}
TROUS[:] = [t for t in TROUS if t["id"] not in _ids]
_pb["fix"] = [f for f in _pb["fix"] if not _dans_pb(f)]
# fixations du mur hors des poches
_mur = next(p for p in PIECES if p["id"] == "mur_cibles")
_dans = lambda f: any(x0 - 4 <= f[0] <= x0 + l + 4 and y0 - 4 <= f[1] <= y0 + w + 4 for x0, y0, l, w in POCHES_MUR)  # noqa: E731
_ids = {f"mur_cibles.F{i + 1}" for i, f in enumerate(_mur["fix"]) if _dans(f)}
TROUS[:] = [t for t in TROUS if t["id"] not in _ids]
_mur["fix"] = [f for f in _mur["fix"] if not _dans(f)]

# --- couloirs T-O-U-R et couloirs du bas : rollovers à fil
l, w = V(DETECTION["rollover_lumiere"])
for ln in GEO["lanes"]:
    trou(f"rollover_{ln['letter']}", f"lumière du rollover {ln['letter']}", ln["x"], ln["y"], forme="oblong", l=l, w=w, angle=90)
    piece(id=f"rollover_{ln['letter']}", nom=f"Rollover {ln['letter']} : support imprimé + KW11 + fil", type="rollover",
          x=ln["x"], y=ln["y"])
for ln in GEO.get("lowerLanes", []):
    trou(f"rollover_{ln['id']}", f"lumière du rollover bas {ln['id']}", ln["x"], ln["y"], forme="oblong", l=l, w=w, angle=90)
    piece(id=f"rollover_{ln['id']}", nom=f"Rollover bas {ln['id']} : support imprimé + KW11 + fil", type="rollover",
          x=ln["x"], y=ln["y"])

# --- le Cercle (cuvette + éjecteur sous le plateau)
sc = GEO["saucer"]
trou("cercle", "cuvette du Cercle", sc["x"], sc["y"], d=V(DETECTION["cercle_trou"]))
piece(id="cuvette_cercle", nom="Cuvette du Cercle (KW11 au fond, doigt d'éjection)", type="cuvette", x=sc["x"], y=sc["y"])

# --- couloir de lancement, autolanceur, bac, évacuation
pl = GEO["plunger"]
l, w = V(DETECTION["shooter_lumiere"])
trou("lancement.contact", "levier du KW11 sous la bille au repos", pl["x"], pl["ballY"], forme="oblong", l=l, w=w, angle=90)
l, w = V(DETECTION["lanceur_lumiere"])
trou("lancement.doigt", "doigt de l'autolanceur", pl["x"], pl["ballY"] + 22, forme="oblong", l=l, w=w, angle=90)
trou("bac.montee", "montée de la bille du bac vers le couloir", pl["x"], H - 22, d=V(DETECTION["montee_bac"]))
l, w = V(DETECTION["evacuation"])
AP = GEO["apron"]
APRON_Y = AP["front"]
trou("evacuation", "évacuation (devant la lèvre du tablier)", CX, APRON_Y - 2 - w / 2, forme="oblong", l=l, w=w, angle=0)


def conge(a, p, b, r, n=6):
    """coin p de la polyligne a-p-b arrondi au rayon r (points de l'arc)"""
    u = [(a[0] - p[0]), (a[1] - p[1])]; v = [(b[0] - p[0]), (b[1] - p[1])]
    lu, lv = math.hypot(*u), math.hypot(*v); u = [c / lu for c in u]; v = [c / lv for c in v]
    th = math.acos(max(-1, min(1, u[0] * v[0] + u[1] * v[1])))
    d = r / math.tan(th / 2)
    t1 = (p[0] + u[0] * d, p[1] + u[1] * d); t2 = (p[0] + v[0] * d, p[1] + v[1] * d)
    bis = [u[0] + v[0], u[1] + v[1]]; lb = math.hypot(*bis)
    c = (p[0] + bis[0] / lb * r / math.sin(th / 2), p[1] + bis[1] / lb * r / math.sin(th / 2))
    a1, a2 = math.atan2(t1[1] - c[1], t1[0] - c[0]), math.atan2(t2[1] - c[1], t2[0] - c[0])
    while a2 - a1 > math.pi: a2 -= 2 * math.pi
    while a1 - a2 > math.pi: a2 += 2 * math.pi
    return [(c[0] + r * math.cos(a1 + (a2 - a1) * k / n), c[1] + r * math.sin(a1 + (a2 - a1) * k / n)) for k in range(n + 1)]


# tablier : coque noire en V (même bord avant que les bras du jeu, coins du fond R 30), lèvre de AP["lip"] mm.
# Il couvre le bas du plateau, le bac, la montée de la bille et l'autolanceur, et porte les cartes d'instructions.
_yb = lambda x: AP["side"] + (AP["front"] - AP["side"]) * (x / (CX - AP["half"]) if x < CX else (GEO["playRight"] - x) / (GEO["playRight"] - CX - AP["half"]))
_xl, _xr, _xd = CX - AP["half"], CX + AP["half"], GEO["playRight"] - 2
BORD_TABLIER = ([(2, _yb(2))] + conge((0, AP["side"]), (_xl, APRON_Y), (_xr, APRON_Y), 30)
                + conge((_xl, APRON_Y), (_xr, APRON_Y), (GEO["playRight"], AP["side"]), 30) + [(_xd, _yb(_xd)), (_xd, AP["lane"])])
piece(id="tablier", nom="Tablier (apron) : coque noire en V, cartes d'instructions", type="tablier",
      pts=BORD_TABLIER + [(W - 2, AP["lane"]), (W - 2, H - 2), (2, H - 2)], h=AP["lip"], ep=3,
      matiere="PETG noir 3 mm (3 tronçons collés) + cartes plastifiées",
      fix=[(30, H - 37), (CX, H - 32), (GEO["playRight"] - 30, H - 37)],
      note="bord avant = bras du jeu ; la lèvre ramène vers l'évacuation la bille des couloirs extérieurs")
piece(id="bac", nom="Bac à billes (3 billes, 3 KW11) sous le plateau", type="bac", x=CX, y=H - 40)

# --- portillon à sens unique (haut du couloir de lancement)
g = GEO["gate"]
for k, x in enumerate((g["x1"] + 3, g["x2"] - 3)):
    trou(f"portillon.{k + 1}", "support du portillon (fil acier)", x, g["y"] + 6, d=T_VIS)

# --- lampes : inserts + WS2812B
for lp in G["lamps"]:
    trou(f"lampe_{lp['led']:02d}", f"insert de la lampe {lp['name']} (LED n° {lp['led']})", lp["x"], lp["y"],
         d=2 * lp["r"] + V(LAMPES["insert_jeu"]), groupe="lampe")

# ------------------------------------------------------------------ rampe : chemin, hauteur, supports, tronçons
r0 = GEO["rampEntries"][0]
chemin = [(p[0], p[1]) for p in G["ramp"]]          # part de la bouche M (js/table.js buildRamp)
acc = [0.0]
for i in range(1, len(chemin)):
    acc.append(acc[-1] + dist(chemin[i - 1], chemin[i]))
L_RAMPE = acc[-1]
Z_HAUT = V(RAMPE["z_haut"]); PENTE = math.tan(math.radians(V(RAMPE["pente_entree"])))
Z_FIN = 34.0               # fond au-dessus du plateau en sortie (> Ø 27 mm : aucune bille coincée dessous, retombe dans le couloir)
L_DESC = L_RAMPE * (2.0 / 3.0)   # pente descendante douce dès le premier tiers de la rampe (s = L / 3)


# Profil en long : montée, palier, puis légère pente descendante dès le premier tiers jusqu'à Z_FIN en sortie.
# Chaque changement de pente est un raccord parabolique (tôle cintrée) : une cassure franche faisait décoller
# la bille. Raccords : (abscisse, variation de pente, demi-longueur) ; rayon de courbure = 2 × demi-longueur / variation.
# Le fond part avec la pente de la languette d'entrée (P0) : pas de bosse où la bille décollerait.
L_LANG = 30.0; P0 = V(RAMPE["ep"]) / L_LANG
_S1 = 20.0
_S2 = (Z_HAUT + (PENTE - P0) * _S1) / PENTE
_S3 = L_RAMPE - L_DESC
RACCORDS = [(_S1, PENTE - P0, 20.0), (_S2, -PENTE, 50.0), (_S3, -(Z_HAUT - Z_FIN) / L_DESC, 60.0)]


def z_rampe(s):
    z = P0 * max(0.0, s)
    for sk, dm, h in RACCORDS:
        x = s - sk
        z += dm * (0.0 if x < -h else x if x > h else (x + h) ** 2 / (4 * h))
    return max(0.0, z)


RAMPE_3D = [(p[0], p[1], z_rampe(s), s) for p, s in zip(chemin, acc)]
# Supports : pas de poteaux dans le plateau (la bille y roule) ; des pattes murales en tôle de 3 mm, posées sous
# la rampe, la relient au bord le plus proche côté extérieur : caisse (vissée), guide d'arche ou séparateur du
# couloir de lancement (posée dessus). Le bras reste à la hauteur de la rampe : la bille passe dessous. Une patte
# longue doit être à plus de 40 mm du plateau ; plus bas, elle ne sort pas de l'emprise de la rampe.
# Au départ (s < 130), la rampe repose sur la carcasse du bouchon.
_E = GEO["ellipse"]; _ls = GEO["laneSep"]


def bord_exterieur(x, y, nx, ny):
    """distance au premier bord rencontré le long de (nx, ny), et ce bord : 'caisse', 'arche' ou 'separateur'"""
    for d in range(0, 250):
        px, py = x + nx * d, y + ny * d
        if px <= 0 or px >= W:
            return d, "caisse"
        if py >= _ls["y1"] and px >= _ls["x"] - _ls["t"] / 2:
            return d, "separateur"
        if py < _E["cy"] and ((px - _E["cx"]) / _E["rx"]) ** 2 + ((py - _E["cy"]) / _E["ry"]) ** 2 > 1:
            return d, "arche"
    return None, None


_hw_rampe = V(RAMPE["larg_int"]) / 2 + V(RAMPE["ep"])
supports = []          # (x, y, z, s) : point de la rampe porté
PATTES = []
s_next = 200.0
for i, (x, y, z, s) in enumerate(RAMPE_3D):
    if s < s_next or s > L_RAMPE - 60:
        continue
    a, b = RAMPE_3D[max(0, i - 1)], RAMPE_3D[min(len(RAMPE_3D) - 1, i + 1)]
    dx, dy = unit((b[0] - a[0], b[1] - a[1]))
    choix = []
    for sg in (1, -1):
        d, bord = bord_exterieur(x, y, -dy * sg, dx * sg)
        if d is not None:
            choix.append((d, bord, (-dy * sg, dx * sg)))
    d, bord, n = min(choix)
    if z < 40 and d > _hw_rampe + 10:
        continue
    supports.append((x, y, z, s)); s_next = s + V(RAMPE["pas_supports"])
    dz = (b[2] - a[2]) / max(1e-3, b[3] - a[3])
    PATTES.append({"x": x, "y": y, "z": z, "dz": dz, "d": (dx, dy), "n": n, "dist": d, "bord": bord})
for i, pt in enumerate(PATTES):
    piece(id=f"patte_rampe_{i + 1}", nom=f"Patte de rampe ({pt['bord']}), tôle 3 mm", type="patte", **pt,
          hw=_hw_rampe, matiere="alu 3 mm plié (ou PETG 4 mm)")
S_IR = L_RAMPE - 120
piece(id="rampe", nom="Rampe (tronçons PETG, barrière IR en sortie)", type="rampe", pts3d=RAMPE_3D, s_ir=S_IR,
      larg=V(RAMPE["larg_int"]), ep=V(RAMPE["ep"]), h=V(RAMPE["h_flanc"]), bouche=2 * r0["half"], evase=r0["evase"])
# Languette d'entrée : plan incliné collé au plateau devant la bouche, qui rattrape l'épaisseur du fond de rampe
# (sans elle, la marche de 3 mm fait sauter la bille) ; le fond continue à la même pente.
piece(id="languette_rampe", nom="Languette d'entrée de rampe", type="languette", M=(r0["M"]["x"], r0["M"]["y"]),
      u=(r0["u"]["x"], r0["u"]["y"]), hw=r0["half"] + V(RAMPE["ep"]), l=L_LANG, h=V(RAMPE["ep"]),
      enfonce=0.6, ext=12.0, recouvre=0.3)


def sous_rampe(p, jeu):
    """le point (x, y) est-il dans l'emprise de la rampe là où elle passe sous z_max (jeu compris) ?"""
    hw = V(RAMPE["larg_int"]) / 2 + V(RAMPE["ep"]) + jeu
    return any(d_seg(p, a[:2], b[:2]) < hw for a, b in zip(RAMPE_3D, RAMPE_3D[1:]) if a[3] < 200)


# --- plastiques décorés sur entretoises (comme sur un vrai flipper) :
#  • au-dessus de la carcasse du bouchon, 4 mm de débord sur les couloirs, posé sur ses plots ; échancré sous la rampe
#  • enseigne « ESCALE » inclinée vers le joueur au-dessus du début de la rampe, sur deux pattes collées aux flancs
H_ENTRETOISE = 6.0
_pb = next(p for p in PIECES if p["id"] == "piece_bouchon")
piece(id="plastique_bouchon", nom="Plastique du bouchon (sur entretoises de 6 mm)", type="plaque", pts=GEO["bouchonPiece"],
      r=9, ep=3, z=H_PAROI + H_ENTRETOISE, marge=4, decoupe_plateau=True, sous_rampe=True, matiere="PETG 3 mm décoré (ou acrylique 3 mm)",
      entretoises=[f for f in _pb["fix"] if not sous_rampe(f, 8)], h_entretoise=H_ENTRETOISE)
piece(id="plastique_mur_cibles", nom="Plastique du mur des cibles rondes (sur entretoises de 6 mm)", type="plaque",
      pts=_mur["pts"], r=6, ep=3, z=H_PAROI + H_ENTRETOISE, marge=4, decoupe_plateau=True,
      matiere="PETG 3 mm décoré (ou acrylique 3 mm)", entretoises=_mur["fix"], h_entretoise=H_ENTRETOISE)
_df1 = next(p for p in PIECES if p["id"] == "deflecteur_1")
piece(id="plastique_tirer", nom="Plastique de la cible TIRER (sur entretoises de 6 mm)", type="plaque",
      pts=GEO["tirerPlastic"], r=6, ep=3, z=H_PAROI + H_ENTRETOISE, marge=4, decoupe_plateau=True,
      matiere="PETG 3 mm décoré (ou acrylique 3 mm)", entretoises=_df1["fix"], h_entretoise=H_ENTRETOISE)
_en = GEO["enseigneRampe"]
_z_en = z_rampe(_en["a"]) + V(RAMPE["ep"]) + 27 + 20.0         # bord avant : 20 mm au-dessus d'une bille sur la rampe (marge aux rebonds)
piece(id="plastique_rampe", nom="Enseigne de rampe « ESCALE » (inclinée de 40°, pattes collées sur les flancs)", type="enseigne",
      M=(r0["M"]["x"], r0["M"]["y"]), u=(r0["u"]["x"], r0["u"]["y"]), v=(r0["v"]["x"], r0["v"]["y"]), a=_en["a"], prof=_en["prof"],
      incl=_en["incl"], demi=_en["demi"], ep=3, z=_z_en, matiere="PETG 3 mm décoré (ou acrylique 3 mm)")


# ------------------------------------------------------------------ caisse (repère caisse : X largeur, Y vers l'arrière depuis la façade, Z vers le haut)
EPC = V(CAISSE["ep"]); LARG = V(CAISSE["largeur"]); LONG = V(CAISSE["longueur"])
HAV = V(CAISSE["h_avant"]); HAR = V(CAISSE["h_arriere"]); PLAT = V(CAISSE["plat_fronton"])
FLANC = [(0, 0), (LONG, 0), (LONG, HAR), (LONG - PLAT, HAR), (0, HAV)]   # (Y depuis l'avant, Z depuis le bas)


def z_dessus_flanc(y):
    return HAV + (HAR - HAV) * min(1, y / (LONG - PLAT))


PENTE_PF = math.radians(V(PLATEAU["pente_deg"]))
Z_PF_AV = V(CAISSE["z_plateau_avant"])
Y_PF_AV = EPC + 12           # bord avant du plateau, juste derrière la façade
X_PF = (LARG - W) / 2        # plateau centré entre les flancs
LIBRE_PF = LARG - 2 * EPC - W


def plateau_vers_caisse(X, Y, Z=0.0):
    """Point du repère plateau (X, Y depuis l'avant, Z au-dessus du plateau) → repère caisse."""
    c, s = math.cos(PENTE_PF), math.sin(PENTE_PF)
    return (X_PF + X, Y_PF_AV + Y * c - Z * s, Z_PF_AV + Y * s + Z * c)


# lanceur à ressort : axe parallèle au plateau dans le couloir de lancement, à hauteur du centre de la bille ;
# l'embout au repos touche la bille posée (butée du couloir), la tige traverse la façade
_pl = GEO["plunger"]
LANCEUR = {**V(CAISSE["lanceur"]), "bout": plateau_vers_caisse(_pl["x"], H - _pl["top"], BALL_R),
           "axe": (0.0, -math.cos(PENTE_PF), -math.sin(PENTE_PF))}        # vers le joueur
LANCEUR["w_facade"] = (LANCEUR["bout"][1] - EPC / 2) / math.cos(PENTE_PF)   # abscisse du milieu de la façade le long de l'axe
LANCEUR["trou_facade"] = (LANCEUR["bout"][0], LANCEUR["bout"][2] - LANCEUR["w_facade"] * math.sin(PENTE_PF))

# charnière du fronton : axe de pivot = boulon du trou Ø 13 des flancs (le premier des trous du plan WPC)
_yr, _zp, _ = V(CAISSE["trous_flanc"])[0]
CHARNIERE = {**V(CAISSE["charniere"]), "y": LONG - _yr, "z": _zp}

fp = V(CAISSE["flipper_bouton"])
PANNEAUX = {
    "flanc_G": {"nom": "Flanc gauche", "contour": FLANC, "ep": EPC, "trous": [
        {"y": fp["x_avant"], "z": fp["z"], "d": fp["d"], "fonction": "bouton de flipper"},
        *[{"y": LONG - yr, "z": z, "d": d, "fonction": "fixation (plan WPC)"} for yr, z, d in V(CAISSE["trous_flanc"])]],
        "encoches": [{"y": V(CAISSE["encoche_flanc"])["x_avant"], "h": V(CAISSE["encoche_flanc"])["h"], "l": EPC}]},
}
PANNEAUX["flanc_D"] = {**PANNEAUX["flanc_G"], "nom": "Flanc droit (symétrique)"}
fa, po, st = V(CAISSE["facade"]), V(CAISSE["porte"]), V(CAISSE["start"])
PANNEAUX["facade"] = {"nom": "Façade", "contour": [(0, 0), (LARG - 2 * EPC, 0), (LARG - 2 * EPC, fa["h"]), (0, fa["h"])], "ep": EPC,
                      "porte": po, "trous": [{"x": st["x"] - EPC, "z": fa["h"] - st["z_haut"], "d": st["d"], "fonction": "bouton START"},
                                             {"x": LANCEUR["trou_facade"][0] - EPC, "z": LANCEUR["trou_facade"][1],
                                              "d": LANCEUR["trou"], "fonction": "boîtier du lanceur à ressort"}]}
ar = V(CAISSE["arriere"])
PANNEAUX["arriere"] = {"nom": "Panneau arrière", "contour": [(0, 0), (LARG - 2 * EPC, 0), (LARG - 2 * EPC, HAR - EPC), (0, HAR - EPC)],
                       "ep": EPC, "oblongs": V(CAISSE["arriere_oblongs"]), "ventil": V(CAISSE["arriere_ventil"])}
PANNEAUX["fond"] = {"nom": "Fond", "contour": [(0, 0), (LARG - 2 * EPC, 0), (LARG - 2 * EPC, LONG - 2 * EPC), (0, LONG - 2 * EPC)], "ep": EPC}
PANNEAUX["dessus_arriere"] = {"nom": "Dessus arrière (sous le fronton)", "contour": [(0, 0), (LARG - 2 * EPC, 0),
                              (LARG - 2 * EPC, PLAT - EPC), (0, PLAT - EPC)], "ep": EPC,
                              "oblong_cables": {"l": 160, "h": 50}}
fr = V(CAISSE["fronton"])
PANNEAUX["fronton_cote"] = {"nom": "Côté du fronton (×2)", "contour": [(0, 0), (fr["p_bas"], 0), (fr["p_haut"], fr["h"]), (0, fr["h"])], "ep": EPC}
PANNEAUX["fronton_dessus"] = {"nom": "Dessus du fronton", "contour": [(0, 0), (fr["l"] - 2 * EPC, 0), (fr["l"] - 2 * EPC, fr["p_haut"]),
                              (0, fr["p_haut"])], "ep": EPC}
PANNEAUX["fronton_dessous"] = {"nom": "Dessous du fronton", "contour": [(0, 0), (fr["l"] - 2 * EPC, 0), (fr["l"] - 2 * EPC, fr["p_bas"]),
                               (0, fr["p_bas"])], "ep": EPC, "oblong_cables": {"l": 160, "h": 50}}
PANNEAUX["fronton_fond"] = {"nom": "Fond du fronton", "contour": [(0, 0), (fr["l"] - 2 * EPC, 0), (fr["l"] - 2 * EPC, fr["h"] - 2 * EPC),
                            (0, fr["h"] - 2 * EPC)], "ep": 6.0, "matiere": "contreplaqué 6 mm"}
# ------------------------------------------------------------------ pieds (repère caisse, coin avant gauche ; les autres par symétrie)
# Cornière pliée plaquée sur les deux faces extérieures de l'angle ; 2 boulons en diagonale à 45° à travers l'arête
# de la caisse, vissés dans la platine d'angle intérieure. Le bas reçoit une plaque soudée et le vérin.
H_SOL = 930.0 - HAV                       # bas de caisse au-dessus du sol (barre de verrouillage ≈ 930 mm)
_pd, _vs = V(CAISSE["pieds"]), V(CAISSE["verin"])
PIED = {
    **_pd, **{k: v for k, v in V(CAISSE["pied_section"]).items()},
    "z_bas": -H_SOL + _vs["saillie"],                       # bas de la cornière
    "z_haut": -H_SOL + _vs["saillie"] + _pd["l"],           # haut de la cornière (au-dessus du bas de caisse)
}
PIED["recouvrement"] = PIED["z_haut"]
PIED["z_trous"] = [PIED["z_haut"] - _pd["trou_bas"], PIED["z_haut"] - _pd["trou_bas"] + _pd["entraxe_trous"]]
COINS_PIEDS = [("AVG", 0.0, 0.0, 1, 1), ("AVD", LARG, 0.0, -1, 1), ("ARG", 0.0, LONG, 1, -1), ("ARD", LARG, LONG, -1, -1)]  # nom, X, Y, sens X, sens Y


def aile_pied(z):
    """largeur d'une aile du pied à la hauteur z (droite sur la zone boulonnée, puis effilée)"""
    p = PIED
    z_droit = p["z_haut"] - p["droit"]
    if z >= z_droit:
        return p["aile_haut"]
    return p["aile_bas"] + (p["aile_haut"] - p["aile_bas"]) * (z - p["z_bas"]) / (z_droit - p["z_bas"])


# encoche câbles au centre du bord arrière du plateau (le plateau allongé couvre toute la caisse WPC sans rallonge)
_ec = V(PLATEAU["encoche_cables"])
ENCOCHE_CABLES = {"l": _ec[0], "p": _ec[1]}

TASSEAU = {"section": (20, 30), "longueur": round((LONG - 2 * EPC - Y_PF_AV) / math.cos(PENTE_PF) - 60)}

if __name__ == "__main__":
    print(len(PIECES), "pièces,", len(TROUS), "trous, rampe", round(L_RAMPE), "mm,", len(supports), "supports")
    print("jeu latéral du plateau dans la caisse :", round(LIBRE_PF, 1), "mm")
    print("dessus du plateau à l'arrière :", [round(v) for v in plateau_vers_caisse(0, H)])
