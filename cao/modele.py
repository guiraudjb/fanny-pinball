"""Modèle de construction commun à la CAO (FreeCAD) et aux plans cotés (matplotlib).

Repère « table » (celui de js/table.js) : x vers la droite, y vers le BAS, origine coin haut gauche.
Repère « plateau » des plans : X depuis le bord GAUCHE, Y depuis le bord AVANT (côté joueur), Z vers le haut.
  → X = x, Y = H − y.

Rien ici ne dépend de FreeCAD : uniquement des listes de points, de trous et de pièces.
"""
import json
import math
from pathlib import Path

from cotes import CAISSE, DETECTION, LAMPES, MECA, PLATEAU, RAMPE, VISSERIE

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
ruban("sep_lanceur", "Séparateur du couloir de lancement", [(ls["x"], ls["y1"]), (ls["x"], H - 4)], ls["t"],
      matiere="plat alu 4 × 30", achat=True)

# --- guides des couloirs de retour (dans le prolongement des flippers)
for i, s in enumerate(GEO["separators"]):
    ruban(f"guide_retour_{'GD'[i]}", f"Guide de couloir de retour {'gauche droit'.split()[i]}", s, 8)
# --- déflecteur
for i, d in enumerate(GEO["deflectors"]):
    ruban(f"deflecteur_{i + 1}", "Déflecteur latéral", d, 8)
# --- guides des couloirs T-O-U-R
for i, lp in enumerate(GEO["lanePosts"]):
    ruban(f"guide_tour_{i + 1}", f"Guide de couloir T-O-U-R n° {i + 1}", [(lp["x"], lp["y1"]), (lp["x"], lp["y2"])], 6)

# --- entrée de rampe (deux parois + toit en pointe)
for r in GEO["rampEntries"]:
    w = r["half"] + 3
    Q = lambda b, k, a=0: (b["x"] + r["v"]["x"] * k + r["u"]["x"] * a, b["y"] + r["v"]["y"] * k + r["u"]["y"] * a)  # noqa: E731
    ruban("entree_rampe", "Parois de l'entrée de rampe", [Q(r["M"], -w), Q(r["T"], -w), Q(r["T"], 0, 16), Q(r["T"], w), Q(r["M"], w)], 6)

# --- blocs pleins : pièce du bouchon (d'un seul tenant), mur des cibles rondes, bloc de la banque F-A-N-N-Y
piece(id="piece_bouchon", nom="Pièce du bouchon (en U, coins arrondis)", type="bloc", pts=GEO["bouchonPiece"], r=9,
      h=H_PAROI, fix=fixations_poly(GEO["bouchonPiece"]), decoupe_plateau=True)
for wb in G["walls"]:
    if wb.get("plugin") and wb["plugin"].get("housing"):
        pts = [tuple(v) for v in wb["verts"]]
        cx = sum(p[0] for p in pts) / len(pts)
        if cx < W / 2:
            pid, nom = "mur_cibles", "Mur des cibles rondes (3 fenêtres)"
        else:
            pid, nom = "bloc_fanny", "Bloc arrière de la banque F-A-N-N-Y"
        piece(id=pid, nom=nom, type="bloc", pts=pts, r=6, h=H_PAROI, fix=fixations_poly(pts), decoupe_plateau=True)

# --- poteaux (caoutchouc acheté) : coins des lance-pierres, bouts des guides
POTEAU_D = 10
poteaux = []
for s in GEO["slings"]:
    poteaux += [tuple(p) for p in s["pts"]]
for s in GEO["separators"]:
    poteaux.append(tuple(s[0]))
for i, p in enumerate(poteaux):
    piece(id=f"poteau_{i + 1}", nom="Poteau Ø 10 (anneau caoutchouc acheté)", type="poteau", x=p[0], y=p[1], d=POTEAU_D,
          h=H_PAROI + 6, fix=[p])

# --- lance-pierres : plastique décoré posé sur les poteaux + mécanisme acheté
for i, s in enumerate(GEO["slings"]):
    pts = [tuple(p) for p in s["pts"]]
    piece(id=f"plastique_sling_{'GD'[i]}", nom=f"Plastique de lance-pierre {'gauche droit'.split()[i]}", type="plaque",
          pts=pts, r=8, ep=3, z=H_PAROI + 6, marge=7, matiere="PETG 3 mm décoré (ou acrylique 3 mm)")
    A, C = pts[s["face"][0]], pts[s["face"][1]]
    m = ((A[0] + C[0]) / 2, (A[1] + C[1]) / 2)
    B = [p for k, p in enumerate(pts) if k not in s["face"]][0]
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
    trou(f"flipper_{f['side']}", "bague du flipper", f["px"], f["py"], d=V(MECA["flipper_bague"]), src="HYP")
    piece(id=f"meca_flipper_{f['side']}", nom=f"Mécanisme de flipper {'gauche' if f['side'] == 'L' else 'droit'} (acheté)",
          type="zone", x=f["px"] + (55 if f["side"] == "L" else -55), y=f["py"] + 10, dims=V(MECA["flipper_zone"]), angle=0,
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
         angle=math.degrees(d["angle"]), src="HYP")
    piece(id=f"cible_drop_{i + 1}", nom=f"Cible tombante {d['letter']} (achetée)", type="drop", x=d["x"], y=d["y"],
          angle=d["angle"], achat=True, matiere="acheté")
d0, d4 = GEO["drops"][0], GEO["drops"][-1]
piece(id="meca_drop", nom="Banque de 5 cibles tombantes (achetée)", type="zone", x=(d0["x"] + d4["x"]) / 2,
      y=(d0["y"] + d4["y"]) / 2, dims=V(MECA["drop_zone"]), angle=math.degrees(d0["angle"]), achat=True, matiere="acheté")

# --- cibles fixes : POINTER, TIRER, cochonnet (unités imprimées : face pivotante + KW11)
VISEE = (CX, H - 200)   # les faces regardent vers les flippers
for s in GEO["standups"]:
    n = unit(sub(VISEE, (s["x"], s["y"])))
    if s["id"] == "bouchon":
        L = GEO["bouchonLane"]; n = (-L["u"]["x"], -L["u"]["y"])
    dos = (s["x"] - n[0] * 16, s["y"] - n[1] * 16)
    t = (-n[1], n[0])
    fix = [(dos[0] + t[0] * 10 - n[0] * 4, dos[1] + t[1] * 10 - n[1] * 4), (dos[0] - t[0] * 10 - n[0] * 4, dos[1] - t[1] * 10 - n[1] * 4)]
    piece(id=f"cible_{s['id']}", nom=f"Cible fixe {s['label']} (face Ø {2 * s['r']:.0f}, KW11 dans le boîtier)", type="cible",
          x=s["x"], y=s["y"], r=s["r"], n=n, fix=fix)
    trou(f"cible_{s['id']}.fils", f"passe-fil de la cible {s['label']}", *dos, d=V(VISSERIE["passe_fil"]), groupe="passe-fil")
for t_ in GEO["leftTargets"]:
    trou(f"{t_['id']}.fils", f"passe-fil de la cible ronde {t_['id']} (KW11 dans le mur)", 12, t_["y"], d=V(VISSERIE["passe_fil"]),
         groupe="passe-fil")

# --- couloirs T-O-U-R : rollovers à fil
l, w = V(DETECTION["rollover_lumiere"])
for ln in GEO["lanes"]:
    trou(f"rollover_{ln['letter']}", f"lumière du rollover {ln['letter']}", ln["x"], ln["y"], forme="oblong", l=l, w=w, angle=90)
    piece(id=f"rollover_{ln['letter']}", nom=f"Rollover {ln['letter']} : support imprimé + KW11 + fil", type="rollover",
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
APRON_Y = 1000
trou("evacuation", "évacuation (sous le bord du tablier)", CX, APRON_Y - 22, forme="oblong", l=l, w=w, angle=0)
piece(id="tablier", nom="Tablier (apron)", type="plaque", pts=[(4, APRON_Y), (GEO["playRight"] - 4, APRON_Y),
      (GEO["playRight"] - 4, H - 2), (4, H - 2)], r=10, ep=3, z=0, marge=8, matiere="PETG 3 mm décoré",
      fix=[(30, APRON_Y + 30), (CX, APRON_Y + 40), (GEO["playRight"] - 30, APRON_Y + 30)])
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
chemin = [(r0["M"]["x"], r0["M"]["y"])] + [(p[0], p[1]) for p in G["ramp"]]
acc = [0.0]
for i in range(1, len(chemin)):
    acc.append(acc[-1] + dist(chemin[i - 1], chemin[i]))
L_RAMPE = acc[-1]
Z_HAUT = V(RAMPE["z_haut"]); PENTE = math.tan(math.radians(V(RAMPE["pente_entree"])))
L_DESC = 300.0


def z_rampe(s):
    montee = min(Z_HAUT, s * PENTE)
    if s > L_RAMPE - L_DESC:
        return max(3.0, min(montee, Z_HAUT * (L_RAMPE - s) / L_DESC + 3))
    return montee


RAMPE_3D = [(p[0], p[1], z_rampe(s), s) for p, s in zip(chemin, acc)]
supports = []
s_next = 120.0
for (x, y, z, s) in RAMPE_3D:
    if s >= s_next and z > 15 and s < L_RAMPE - 60:
        supports.append((x, y, z, s)); s_next = s + V(RAMPE["pas_supports"])
for i, (x, y, z, s) in enumerate(supports):
    piece(id=f"support_rampe_{i + 1}", nom="Poteau de rampe Ø 10", type="poteau", x=x, y=y, d=10, h=z, fix=[(x, y)])
S_IR = L_RAMPE - 120
piece(id="rampe", nom="Rampe (tronçons PETG, barrière IR en sortie)", type="rampe", pts3d=RAMPE_3D, s_ir=S_IR,
      larg=V(RAMPE["larg_int"]), ep=V(RAMPE["ep"]), h=V(RAMPE["h_flanc"]))


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
                                             {"x": LARG - 2 * EPC - (st["x"] - EPC), "z": fa["h"] - st["z_haut"], "d": 28.0,
                                              "fonction": "bouton LANCER (à la place du lanceur à ressort)"}]}
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
TASSEAU = {"section": (20, 30), "longueur": round((LONG - 2 * EPC - Y_PF_AV) / math.cos(PENTE_PF) - 60)}

if __name__ == "__main__":
    print(len(PIECES), "pièces,", len(TROUS), "trous, rampe", round(L_RAMPE), "mm,", len(supports), "supports")
    print("jeu latéral du plateau dans la caisse :", round(LIBRE_PF, 1), "mm")
    print("dessus du plateau à l'arrière :", [round(v) for v in plateau_vers_caisse(0, H)])
