"""Plans cotés de la réplique (A3, PDF multipage) à partir de cao/modele.py et cao/sortie/contours.json.

    python3 cao/plans.py        → docs/plans/plans_fanny_pinball.pdf (+ aperçus PNG)
Les cotes « HYP » (à confirmer sur la pièce achetée) sont en orange.
"""
import datetime
import json
import math
import os
import sys
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402
from matplotlib.patches import Circle, FancyBboxPatch, Polygon, Rectangle  # noqa: E402

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import modele as M  # noqa: E402
from cotes import CAISSE, DETECTION, MECA, PLATEAU, RAMPE, SOURCES, VISSERIE  # noqa: E402

RACINE = os.path.dirname(ICI)
SORTIE = os.path.join(RACINE, "docs", "plans")
os.makedirs(SORTIE, exist_ok=True)
CT = json.load(open(os.path.join(ICI, "sortie", "contours.json")))
CONT = CT["contours"]

A3P, A3L = (297, 420), (420, 297)
NOIR, GRIS, BLEU, ORANGE, VERT, ROUGE, VIOLET = "#1a1a1a", "#9a9a9a", "#1f4e8c", "#d9822b", "#2e7d32", "#c62828", "#6a4fb0"
COUL_GROUPE = {"fixation": BLEU, "lampe": "#b8860b", "mécanisme": ROUGE, "passe-fil": VERT}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 6})
PAGES = []
DATE = datetime.date.today().strftime("%d/%m/%Y")


def page(taille, titre, num):
    fig = plt.figure(figsize=(taille[0] / 25.4, taille[1] / 25.4))
    fig.add_artist(Rectangle((10 / taille[0], 10 / taille[1]), 1 - 20 / taille[0], 1 - 20 / taille[1],
                             transform=fig.transFigure, fill=False, lw=0.8, color=NOIR))
    # cartouche
    w, h = 150, 22
    x0, y0 = (taille[0] - 10 - w) / taille[0], 10 / taille[1]
    fig.add_artist(Rectangle((x0, y0), w / taille[0], h / taille[1], transform=fig.transFigure, fill=False, lw=0.8))
    fig.text(x0 + 3 / taille[0], y0 + 15 / taille[1], "FANNY PINBALL — réplique physique", fontsize=8, weight="bold")
    fig.text(x0 + 3 / taille[0], y0 + 9 / taille[1], titre, fontsize=8)
    fig.text(x0 + 3 / taille[0], y0 + 3 / taille[1], f"Planche {num:02d} · cotes en mm · {DATE} · github.com/guiraudjb/fanny-pinball",
             fontsize=5.5, color=GRIS)
    fig.text(x0 + 3 / taille[0], y0 + (h + 2) / taille[1], "orange = cote à confirmer sur la pièce achetée (HYP)",
             fontsize=5.5, color=ORANGE)
    PAGES.append(fig)
    return fig


def vue(fig, taille, x, y, w, h, x0, y0, ech):
    """axes à l'échelle 1:ech : rectangle papier (x, y, w, h) mm ↔ modèle à partir de (x0, y0)"""
    ax = fig.add_axes([x / taille[0], y / taille[1], w / taille[0], h / taille[1]])
    ax.set_xlim(x0, x0 + w * ech); ax.set_ylim(y0, y0 + h * ech)
    ax.set_aspect("equal"); ax.axis("off")
    return ax


def cote(ax, a, b, d, txt=None, coul=NOIR, fs=5.5):
    """cote linéaire de a à b, décalée de d (perpendiculaire, unités modèle)"""
    (x1, y1), (x2, y2) = a, b
    l = math.hypot(x2 - x1, y2 - y1) or 1
    nx, ny = -(y2 - y1) / l, (x2 - x1) / l
    p1, p2 = (x1 + nx * d, y1 + ny * d), (x2 + nx * d, y2 + ny * d)
    ax.plot([x1, p1[0] + nx * 2], [y1, p1[1] + ny * 2], color=coul, lw=0.25)
    ax.plot([x2, p2[0] + nx * 2], [y2, p2[1] + ny * 2], color=coul, lw=0.25)
    ax.annotate("", p2, p1, arrowprops=dict(arrowstyle="<|-|>", lw=0.35, color=coul, shrinkA=0, shrinkB=0, mutation_scale=4))
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    if ang > 90 or ang < -90:
        ang += 180
    ax.text((p1[0] + p2[0]) / 2 + nx * 1.5, (p1[1] + p2[1]) / 2 + ny * 1.5, txt or f"{l:.1f}".replace(".0", "").replace(".", ","),
            rotation=ang, ha="center", va="bottom", fontsize=fs, color=coul, rotation_mode="anchor")


def fmt(v):
    return f"{v:.1f}".replace(".", ",")


def contour(ax, cid, **k):
    for poly in CONT.get(cid, []):
        if len(poly) > 2:
            ax.add_patch(Polygon(poly, closed=True, fill=k.get("fill", False), fc=k.get("fc", "none"),
                                 ec=k.get("ec", NOIR), lw=k.get("lw", 0.4), ls=k.get("ls", "-"), alpha=k.get("alpha", 1)))


def dessiner_trou(ax, t, num=None, fs=3.5):
    X, Y = M.P(t["x"], t["y"])
    coul = ORANGE if t["src"] == "HYP" else COUL_GROUPE.get(t["groupe"], NOIR)
    if t["forme"] == "rond":
        ax.add_patch(Circle((X, Y), t["d"] / 2, fill=False, ec=coul, lw=0.35))
        ax.plot([X - t["d"] / 2 - 1.5, X + t["d"] / 2 + 1.5], [Y, Y], color=coul, lw=0.12)
        ax.plot([X, X], [Y - t["d"] / 2 - 1.5, Y + t["d"] / 2 + 1.5], color=coul, lw=0.12)
    else:
        a = math.radians(-t["angle"]); l, w = t["l"], t["w"]
        dx, dy = math.cos(a) * (l - w) / 2, math.sin(a) * (l - w) / 2
        nx, ny = -math.sin(a) * w / 2, math.cos(a) * w / 2
        ax.add_patch(Polygon([(X - dx + nx, Y - dy + ny), (X + dx + nx, Y + dy + ny), (X + dx - nx, Y + dy - ny), (X - dx - nx, Y - dy - ny)],
                             closed=True, fill=False, ec=coul, lw=0.35))
    if num is not None:
        ax.text(X + 3, Y + 3, str(num), fontsize=fs, color=coul)


NUM = {t["id"]: i + 1 for i, t in enumerate(M.TROUS)}


# ================================================================== 01 plateau, vue de dessus
def p01():
    fig = page(A3P, "Plateau — vue de dessus, perçages et implantation (1:3)", 1)
    ax = vue(fig, A3P, 25, 45, 180, 365, -10, -30, 3)
    ax.add_patch(Rectangle((0, 0), M.W, M.H, fill=False, ec=NOIR, lw=0.8))
    for cid in CONT:
        if cid != "plateau" and not cid.startswith(("meca_", "rollover", "cuvette", "bac")):
            contour(ax, cid, ec=GRIS, lw=0.3)
    for t in M.TROUS:
        dessiner_trou(ax, t, NUM[t["id"]])
    cote(ax, (0, 0), (M.W, 0), -14)
    cote(ax, (0, 0), (0, M.H), 14)
    # cotes de position des éléments majeurs
    for f in M.GEO["flippers"]:
        X, Y = M.P(f["px"], f["py"])
        ax.plot([0, X], [Y, Y], color=GRIS, lw=0.2, ls=":")
    X, Y = M.P(M.GEO["flippers"][0]["px"], M.GEO["flippers"][0]["py"])
    X2 = M.P(M.GEO["flippers"][1]["px"], 0)[0]
    cote(ax, (X, Y), (X2, Y), -18)
    cote(ax, (0, 0), (0, Y), -6, f"{fmt(Y)}")
    ax.text(-8, -24, "Origine : coin avant gauche, dessus du plateau. X vers la droite, Y vers le fond.", fontsize=5)
    # légende
    lx = 215
    fig.text(lx / 297, 395 / 420, "Légende", fontsize=8, weight="bold")
    for i, (g, c) in enumerate([("fixation des pièces imprimées (Ø 3,5, vis M3 par dessous)", BLEU), ("insert de lampe (WS2812B dessous)", "#b8860b"),
                                ("mécanisme / détection", ROUGE), ("passe-fil", VERT), ("à confirmer sur la pièce achetée", ORANGE),
                                ("contour des pièces posées", GRIS)]):
        fig.text(lx / 297, (387 - 6 * i) / 420, "■ " + g, color=c, fontsize=5.5)
    txt = [f"Contreplaqué bouleau {fmt(M.EP)} mm, {M.W} × {M.H} mm.",
           f"Pente en caisse : {M.V(PLATEAU['pente_deg'])}°.",
           "Numéros = repères du tableau des perçages",
           "(planches 02 et 03).",
           "",
           "Percer d'abord les avant-trous Ø 3",
           "au gabarit imprimé 1:1, puis finir",
           "à la mèche Forstner.",
           "",
           f"{len(M.TROUS)} perçages au total :"]
    cnt = Counter(t["groupe"] for t in M.TROUS)
    txt += [f"  {n} × {g}" for g, n in cnt.items()]
    for i, l in enumerate(txt):
        fig.text(lx / 297, (345 - 5.5 * i) / 420, l, fontsize=5.5)


# ================================================================== 02-03 tableau des perçages
def p_tableau():
    lignes = []
    for t in M.TROUS:
        X, Y = M.P(t["x"], t["y"])
        dim = f"Ø {fmt(t['d'])}" if t["forme"] == "rond" else f"oblong {fmt(t['l'])} × {fmt(t['w'])} à {fmt(t['angle'] % 180)}°"
        lignes.append((str(NUM[t["id"]]), t["id"], t["fonction"][:62], fmt(X), fmt(Y), dim, t["src"]))
    par_page = 62
    for k in range(0, len(lignes), par_page):
        fig = page(A3L, f"Plateau — tableau des perçages ({k // par_page + 1}/{math.ceil(len(lignes) / par_page)})", 2 + k // par_page)
        ax = fig.add_axes([15 / 420, 40 / 297, 390 / 420, 245 / 297]); ax.axis("off")
        cols = ["N°", "Repère", "Fonction", "X", "Y", "Forme", "Source"]
        xs = [0, 0.035, 0.2, 0.62, 0.68, 0.74, 0.9]
        for c, x in zip(cols, xs):
            ax.text(x, 1, c, weight="bold", fontsize=6, va="top")
        for i, l in enumerate(lignes[k:k + par_page]):
            y = 0.975 - (i + 1) * 0.0155
            coul = ORANGE if l[6] == "HYP" else NOIR
            for v, x in zip(l, xs):
                ax.text(x, y, v, fontsize=5.4, va="top", color=coul)
            if i % 2 == 0:
                ax.add_patch(Rectangle((0, y - 0.0145), 1, 0.0155, color="#f2f2f2", zorder=-1, transform=ax.transAxes))
        fig.text(15 / 420, 33 / 297, "X depuis le bord gauche, Y depuis le bord avant du plateau (dessus). Sources : "
                 + " · ".join(f"{k} = {v}" for k, v in SOURCES.items()), fontsize=5, color=GRIS)


# ================================================================== 04 dessous du plateau
def p_dessous():
    fig = page(A3P, "Plateau — implantation sous le plateau (vue de DESSOUS, 1:3)", 4)
    ax = vue(fig, A3P, 25, 45, 180, 365, -10, -30, 3)
    ax.add_patch(Rectangle((0, 0), M.W, M.H, fill=False, ec=NOIR, lw=0.8))
    ax.invert_xaxis()   # vue de dessous : miroir gauche/droite
    for p in M.PIECES:
        if p["type"] in ("zone", "banque"):
            contour(ax, p["id"], ec=ORANGE, fill=True, fc="#fde9d6", lw=0.4)
            X, Y = M.P(p["x"], p["y"])
            ax.text(X, Y, p["nom"].replace(" (acheté)", "").replace(" (achetée)", "")[:26], fontsize=3.6, ha="center", va="center", color=NOIR)
        elif p["type"] in ("rollover", "cuvette", "bac"):
            contour(ax, p["id"], ec=VERT, lw=0.5)
    for t in M.TROUS:
        if t["groupe"] != "fixation":
            dessiner_trou(ax, t)
    txt = ["Vue de dessous : la gauche du dessin est la DROITE du plateau.",
           "",
           "Zones orange : encombrement des mécanismes achetés",
           "(flippers, bumpers, lance-pierres, banque F-A-N-N-Y).",
           "Les tracer avec la pièce réelle posée sur son trou,",
           "puis visser (vis à bois 3,5 × 13, pénétration ≤ 10 mm).",
           "",
           "En vert : détecteurs conçus pour l'impression",
           "(rollovers T-O-U-R, cuvette du Cercle, bac à billes).",
           "Voir planche 05.",
           "",
           "Câblage : un faisceau par zone, ramené vers",
           "l'arrière ; borniers vissés sous le plateau.",
           "Les LED WS2812B sont chaînées dans l'ordre des",
           "numéros de lampes (js/render.js, LAMP_LAYOUT)."]
    for i, l in enumerate(txt):
        fig.text(212 / 297, (395 - 5.5 * i) / 420, l, fontsize=5.5)


# ================================================================== 05 détecteurs
def boite(ax, x, y, w, h, coul=NOIR, fc="none", lw=0.6, ls="-"):
    ax.add_patch(Rectangle((x, y), w, h, fill=fc != "none", fc=fc, ec=coul, lw=lw, ls=ls))


def p_detection():
    fig = page(A3L, "Détection du passage des billes — coupes cotées (échelle ≈ 1,2:1, sauf mention)", 5)
    kw = M.V(DETECTION["kw11"]); ep = M.EP; bille = 2 * M.BALL_R
    # --- 1. rollover à fil (coupe dans l'axe du couloir)
    ax = vue(fig, A3L, 20, 170, 120, 105, -45, -50, 0.85)
    ax.set_title("1 · Rollover à fil (couloirs T-O-U-R)", fontsize=7, loc="left")
    boite(ax, -40, -ep, 80, ep, fc="#e8d5b5")
    ax.add_patch(Rectangle((-18, -ep), 36, ep, fc="white", ec=NOIR, lw=0.3))
    ax.plot([-15, -15, 15, 15], [-ep - 2, 6, 6, -ep - 2], color=ROUGE, lw=1.0)
    boite(ax, -10, -ep - 24, 20, 10.3, fc="#cfe8cf")
    boite(ax, -14, -ep - 30, 28, 30 - ep - 10 + ep, coul=VIOLET, ls="--")
    ax.add_patch(Circle((0, 6 + M.BALL_R), M.BALL_R, fill=False, ec=GRIS, lw=0.5))
    cote(ax, (-18, -ep), (18, -ep), -26, "lumière 36 × 4", fs=5)
    cote(ax, (15, 0), (15, 6), 6, "saillie 6", fs=5)
    cote(ax, (-40, -ep), (-40, 0), -4, fmt(ep), fs=5)
    ax.text(-38, -42, "Corde à piano Ø 1,5 en U, soudée/brasée au levier long du KW11.\n"
            "Support imprimé (violet) vissé sous le plateau (2 vis 3,5 × 13).", fontsize=5)
    # --- 2. cible fixe (coupe)
    ax = vue(fig, A3L, 150, 170, 120, 105, -50, -30, 0.85)
    ax.set_title("2 · Cible fixe (POINTER, TIRER, cochonnet)", fontsize=7, loc="left")
    boite(ax, -45, -ep, 90, ep, fc="#e8d5b5")
    boite(ax, -2, 0, 4, 26, fc="#ffcdd2", coul=ROUGE)
    ax.add_patch(Circle((0, 25), 1.5, fc=NOIR))
    boite(ax, 2, 0, 24, 28, coul=VIOLET)
    boite(ax, 6, 8, 10.3, 6.4, fc="#cfe8cf")
    ax.add_patch(Circle((-M.BALL_R - 2, M.BALL_R), M.BALL_R, fill=False, ec=GRIS, lw=0.5))
    ax.plot([5, 5], [-ep, 0], color=BLEU, lw=1.2)
    cote(ax, (2, 28), (26, 28), 4, "24", fs=5)
    cote(ax, (26, 0), (26, 28), -6, "28", fs=5)
    ax.text(-43, -22, "Face Ø 22 (Ø 16 cochonnet) pivotant sur axe acier Ø 3 en haut ;\n"
            "le bas de la face pousse le levier du KW11 logé dans le boîtier.\n"
            "Boîtier tenu par 2 vis M3 par dessous ; fils par le trou Ø 8.", fontsize=5)
    # --- 3. Cercle (cuvette + éjecteur)
    ax = vue(fig, A3L, 280, 170, 120, 105, -50, -65, 0.85)
    ax.set_title("3 · Le Cercle (cuvette, contact, éjection)", fontsize=7, loc="left")
    boite(ax, -45, -ep, 90, ep, fc="#e8d5b5")
    ax.add_patch(Rectangle((-20, -ep), 40, ep, fc="white", ec=NOIR, lw=0.3))
    ax.plot([-20, -20, 20, 20], [0, -ep - 18, -ep - 18, 0], color=VIOLET, lw=0.8)
    ax.plot([-16, -16, 16, 16], [-ep, -ep - 15, -ep - 15, -ep], color=VIOLET, lw=0.5)
    boite(ax, -10, -ep - 30, 20, 10.3, fc="#cfe8cf")
    boite(ax, 22, -ep - 45, 16, 40, coul=ORANGE, ls="--")
    ax.add_patch(Circle((0, -ep - 15 + M.BALL_R + 1), M.BALL_R, fill=False, ec=GRIS, lw=0.5))
    cote(ax, (-20, -ep), (20, -ep), 30, "Ø 40 (plateau)", fs=5)
    cote(ax, (-16, -ep - 15), (16, -ep - 15), -10, "Ø int. 32", fs=5)
    cote(ax, (-20, -ep - 18), (-20, 0), -6, fmt(ep + 18), fs=5)
    ax.text(-43, -58, "KW11 sous le fond (levier par une fente 3 × 12). Doigt d'éjection\n"
            "poussé par une bobine (orange) : la bille repart vers les bumpers.", fontsize=5)
    # --- 4. couloir de lancement + autolanceur + bac
    ax = vue(fig, A3L, 20, 50, 190, 105, -45, -75, 0.85)
    ax.set_title("4 · Couloir de lancement : bille au repos, autolanceur, montée du bac", fontsize=7, loc="left")
    boite(ax, -40, -ep, 150, ep, fc="#e8d5b5")
    for x, w in ((0, 6), (22, 12), (70, 31)):
        ax.add_patch(Rectangle((x - w / 2, -ep), w, ep, fc="white", ec=NOIR, lw=0.3))
    ax.add_patch(Circle((0, M.BALL_R), M.BALL_R, fill=False, ec=GRIS, lw=0.5))
    boite(ax, -10, -ep - 14, 20, 10.3, fc="#cfe8cf")
    boite(ax, 14, -ep - 60, 16, 50, coul=ORANGE, ls="--")
    boite(ax, 55, -ep - 50, 31, 40, coul=ORANGE, ls="--")
    ax.text(-38, -64, "KW11 sous la bille au repos (lumière 20 × 6) · doigt de l'autolanceur (lumière 30 × 12, bobine D12)\n"
            "· montée du bac (Ø 31, éjecteur D11). Bac imprimé : 3 billes en file, un KW11 par place + 1 à l'évacuation.", fontsize=5)
    # --- 5. barrière IR de la rampe
    ax = vue(fig, A3L, 220, 50, 90, 105, -40, -32, 0.9)
    ax.set_title("5 · Sortie de rampe : barrière IR", fontsize=7, loc="left")
    w = M.V(RAMPE["larg_int"]); e = M.V(RAMPE["ep"]); h = M.V(RAMPE["h_flanc"])
    ax.add_patch(Polygon([(-w / 2 - e, -e), (w / 2 + e, -e), (w / 2 + e, h), (w / 2, h), (w / 2, 0), (-w / 2, 0), (-w / 2, h), (-w / 2 - e, h)],
                         closed=True, fc="#e3dcf3", ec=VIOLET, lw=0.6))
    ax.add_patch(Circle((0, M.BALL_R), M.BALL_R, fill=False, ec=GRIS, lw=0.5))
    for sg in (-1, 1):
        boite(ax, sg * (w / 2 + e) - (8 if sg < 0 else 0), 8, 8, 8, fc="#ffe0b2")
    ax.plot([-w / 2, w / 2], [12, 12], color=ROUGE, lw=0.4, ls="--")
    cote(ax, (-w / 2, 0), (w / 2, 0), -10, f"{fmt(w)}", fs=5)
    cote(ax, (w / 2 + e, 0), (w / 2 + e, h), -14, f"{fmt(h)}", fs=5)
    ax.text(-38, -28, "LED IR 940 nm / phototransistor Ø 5\nà 12 mm du fond (milieu de bille).", fontsize=5)
    # --- 6. KW11
    ax = vue(fig, A3L, 320, 50, 85, 105, -15, -28, 0.45)
    ax.set_title("6 · Micro-rupteur KW11-3Z (achat)", fontsize=7, loc="left")
    boite(ax, 0, 0, kw["l"], kw["h"], fc="#cfe8cf")
    for sx in (-1, 1):
        ax.add_patch(Circle((kw["l"] / 2 + sx * kw["entraxe"] / 2, kw["h"] / 2), kw["trous"] / 2, fill=False, ec=NOIR, lw=0.4))
    ax.plot([2, 18, 22], [kw["h"], kw["h"] + 3, kw["h"] + 3], color=NOIR, lw=0.6)
    cote(ax, (0, 0), (kw["l"], 0), -5, fmt(kw["l"]), coul=ORANGE, fs=5)
    cote(ax, (0, 0), (0, kw["h"]), 4, fmt(kw["h"]), coul=ORANGE, fs=5)
    cote(ax, (kw["l"] / 2 - kw["entraxe"] / 2, kw["h"] / 2), (kw["l"] / 2 + kw["entraxe"] / 2, kw["h"] / 2), -9,
         f"{fmt(kw['entraxe'])} (trous Ø {fmt(kw['trous'])})", coul=ORANGE, fs=4.5)
    ax.text(-13, -22, f"Épaisseur {fmt(kw['e'])}. Contact NO entre broche et\nmasse (INPUT_PULLUP du Mega).", fontsize=5)


# ================================================================== 06 pièces imprimées
def p_pieces():
    fig = page(A3L, "Pièces imprimées — vues de dessus cotées, points de fixation (1:2)", 6)
    choix = ["piece_bouchon", "mur_cibles", "bloc_fanny", "plastique_bouchon", "guide_retour_G", "deflecteur_1", "plastique_rampe",
             "plastique_sling_G", "poteau_1", "tablier"]
    cases = [(15, 150, 130, 130), (150, 150, 60, 130), (215, 150, 100, 130), (320, 150, 85, 130),
             (15, 45, 90, 100), (110, 45, 45, 100), (160, 45, 35, 100), (200, 45, 70, 100), (275, 45, 30, 100), (310, 45, 95, 100)]
    for pid, (x, y, w, h) in zip(choix, cases):
        polys = CONT.get(pid) or []
        p = next(q for q in M.PIECES if q["id"] == pid)
        if not polys:
            continue
        xs = [a for poly in polys for a, _ in poly]; ys = [b for poly in polys for _, b in poly]
        ech = max((max(xs) - min(xs) + 30) / w, (max(ys) - min(ys) + 30) / (h - 14), 2.0)
        ax = vue(fig, A3L, x, y, w, h - 12, min(xs) - 15, min(ys) - 15, ech)
        ax.set_title(f"{p['nom'][:40]}\n1:{ech:.0f} · h = {fmt(p.get('h', p.get('ep', 0)))}", fontsize=5.2, loc="left")
        contour(ax, pid, ec=VIOLET, lw=0.6, fill=True, fc="#efeaf8")
        for f in p.get("fix", []):
            X, Y = M.P(*f)
            ax.add_patch(Circle((X, Y), 2.0, fill=False, ec=BLEU, lw=0.4))
            ax.text(X + 2.5, Y + 2.5, f"({fmt(X)} ; {fmt(Y)})", fontsize=3.3, color=BLEU)
        cote(ax, (min(xs), min(ys)), (max(xs), min(ys)), -6 * ech / 2, fs=4.5)
        cote(ax, (min(xs), min(ys)), (min(xs), max(ys)), 6 * ech / 2, fs=4.5)
    fig.text(15 / 420, 33 / 297, "Coordonnées des fixations dans le repère du plateau (X depuis le bord gauche, Y depuis le bord avant). "
             "Inserts laiton M3 posés à chaud (trou Ø 4 × 6 sous la pièce). Toutes les pièces : STL et STEP dans cao/sortie/pieces/. "
             "PETG, 3 périmètres, remplissage 30 %.", fontsize=5, color=GRIS)


# ================================================================== 07 rampe
def p_rampe():
    fig = page(A3L, "Rampe — profil en long, supports, tronçons", 7)
    pts = M.RAMPE_3D
    ax = fig.add_axes([25 / 420, 175 / 297, 380 / 420, 95 / 297])
    ax.plot([p[3] for p in pts], [p[2] for p in pts], color=VIOLET, lw=1)
    for i, (x, y, z, s) in enumerate(M.supports):
        ax.plot([s, s], [0, z], color=BLEU, lw=0.6)
        ax.text(s, z + 3, f"S{i + 1}\n{fmt(z)}", fontsize=4.5, ha="center", color=BLEU)
    tmax = M.V(RAMPE["troncon_max"]); s0, k = 0.0, 1
    while s0 < M.L_RAMPE - 1:
        ax.axvline(s0, color=GRIS, lw=0.3, ls=":"); ax.text(s0 + 4, 2, f"T{k}", fontsize=4.5, color=GRIS)
        s0 += tmax; k += 1
    ax.axvline(M.S_IR, color=ROUGE, lw=0.5, ls="--"); ax.text(M.S_IR + 4, 50, "barrière IR", fontsize=5, color=ROUGE)
    ax.set_xlabel("abscisse le long de la rampe (mm, depuis la bouche d'entrée)", fontsize=6)
    ax.set_ylabel("dessus du fond au-dessus du plateau (mm)", fontsize=6)
    ax.set_ylim(0, 85); ax.grid(lw=0.2)
    ax.set_title(f"Profil en long : montée à {M.V(RAMPE['pente_entree'])}°, palier à {fmt(M.Z_HAUT)} mm, descente sur {fmt(M.L_DESC)} mm "
                 f"— longueur {fmt(M.L_RAMPE)} mm", fontsize=7, loc="left")
    ax2 = vue(fig, A3L, 25, 40, 120, 120, -20, -20, 4.8)
    ax2.add_patch(Rectangle((0, 0), M.W, M.H, fill=False, ec=GRIS, lw=0.4))
    ax2.plot([M.P(p[0], p[1])[0] for p in pts], [M.P(p[0], p[1])[1] for p in pts], color=VIOLET, lw=1.2)
    for i, (x, y, z, s) in enumerate(M.supports):
        X, Y = M.P(x, y); ax2.plot(X, Y, "o", ms=2, color=BLEU); ax2.text(X + 6, Y, f"S{i + 1}", fontsize=4.5, color=BLEU)
    ax2.set_title("Vue de dessus (1:4,8)", fontsize=6, loc="left")
    ax3 = fig.add_axes([160 / 420, 40 / 297, 245 / 420, 120 / 297]); ax3.axis("off")
    rows = [("Support", "X", "Y", "hauteur poteau", "abscisse")] + [
        (f"S{i + 1}", fmt(M.P(x, y)[0]), fmt(M.P(x, y)[1]), fmt(z), fmt(s)) for i, (x, y, z, s) in enumerate(M.supports)]
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            ax3.text(j * 0.13, 1 - i * 0.065, v, fontsize=5.5, weight="bold" if i == 0 else None, va="top")
    ax3.text(0.68, 1, "Section en U (PETG)\n"
             f"largeur intérieure {fmt(M.V(RAMPE['larg_int']))}, fond et flancs {fmt(M.V(RAMPE['ep']))},\n"
             f"flancs {fmt(M.V(RAMPE['h_flanc']))} au-dessus du fond.\n\n"
             f"Tronçons de {fmt(tmax)} mm maxi le long de l'axe,\n"
             "assemblés par éclisses vissées (M3 + inserts)\n"
             "sous le fond, au droit des poteaux.\n\n"
             "Poteaux Ø 10 : insert M3 en haut et en bas,\n"
             "vis M3 × 20 par dessous le plateau.", fontsize=5.5, va="top")


# ================================================================== 08-09 caisse et fronton
def dessiner_panneau(ax, nom, avec_cotes=True):
    P = M.PANNEAUX[nom]
    poly = P["contour"]
    ax.add_patch(Polygon(poly, closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7))
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    if avec_cotes:
        cote(ax, (min(xs), min(ys)), (max(xs), min(ys)), -40)
        cote(ax, (max(xs), min(ys)), (max(xs), max(ys)), -40)
    return xs, ys


def p_caisse():
    fig = page(A3L, "Caisse (WPC standard body) — flanc, façade, arrière (1:8)", 8)
    E = M.EPC
    ax = vue(fig, A3L, 15, 140, 200, 140, -80, -90, 8)
    ax.set_title("Flanc gauche (vu de l'extérieur, avant à gauche) — flanc droit symétrique · ×2", fontsize=7, loc="left")
    F = M.PANNEAUX["flanc_G"]
    ax.add_patch(Polygon(F["contour"], closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7))
    cote(ax, (0, 0), (M.LONG, 0), -45)
    cote(ax, (0, 0), (0, M.HAV), 45)
    cote(ax, (M.LONG, 0), (M.LONG, M.HAR), -45)
    cote(ax, (M.LONG - M.PLAT, M.HAR), (M.LONG, M.HAR), 20)
    for t in F["trous"]:
        ax.add_patch(Circle((t["y"], t["z"]), t["d"] / 2, fill=False, ec=ROUGE, lw=0.5))
        ax.text(t["y"] + 12, t["z"] + 8, f"Ø {fmt(t['d'])}\n({fmt(t['y'])} ; {fmt(t['z'])})", fontsize=4.5, color=ROUGE)
    en = F["encoches"][0]
    ax.add_patch(Rectangle((en["y"] - en["l"] / 2, 0), en["l"], en["h"], fill=False, ec=ROUGE, lw=0.5))
    ax.text(en["y"] + 15, 20, f"encoche {fmt(en['l'])} × {fmt(en['h'])}\nà {fmt(en['y'])} de l'avant", fontsize=4.5, color=ROUGE)
    # rainure de la vitre, tasseau du plateau
    ax.plot([40, M.LONG - M.PLAT - 30], [M.z_dessus_flanc(40) - 22, M.z_dessus_flanc(M.LONG - M.PLAT - 30) - 22], color=BLEU, lw=0.5, ls="--")
    ax.text(300, M.z_dessus_flanc(300) - 40, "rainure de vitre 6 × 5, à 22 sous l'arête (face intérieure)", fontsize=4.5, color=BLEU)
    a = M.plateau_vers_caisse(0, 0); b = M.plateau_vers_caisse(0, M.H)
    ax.plot([a[1], b[1]], [a[2], b[2]], color=VERT, lw=0.8)
    ax.plot([a[1] + 20, b[1] - 40], [a[2] - M.EP, b[2] - M.EP - 5], color=VERT, lw=2.2, alpha=0.5)
    c_ = M.plateau_vers_caisse(0, M.H + M.RALLONGE["h"])
    ax.plot([b[1], c_[1]], [b[2], c_[2]], color=VERT, lw=0.8, ls="--")
    ax.text(b[1] - 60, b[2] + 14, f"rallonge 12 mm : {fmt(M.RALLONGE['h'])}", fontsize=4.5, color=VERT)
    ax.text(a[1] + 30, a[2] + 8, f"dessus du plateau : {fmt(a[2])} à l'avant, {fmt(b[2])} à l'arrière (pente {M.V(PLATEAU['pente_deg'])}°)\n"
            f"tasseau 20 × 30 × {M.TASSEAU['longueur']} vissé-collé sous le plateau, face intérieure", fontsize=4.5, color=VERT)
    # façade
    ax = vue(fig, A3L, 225, 140, 90, 140, -60, -90, 8)
    ax.set_title("Façade (vue de face)", fontsize=7, loc="left")
    fa = M.PANNEAUX["facade"]
    xs, ys = dessiner_panneau(ax, "facade")
    po = fa["porte"]
    ax.add_patch(FancyBboxPatch((po["x_gauche"] - E + po["r"], po["z_bas"] + po["r"]), po["l"] - 2 * po["r"], po["h"] - 2 * po["r"],
                                boxstyle=f"round,pad={po['r']}", fill=False, ec=ROUGE, lw=0.5))
    ax.text(po["x_gauche"] - E + 10, po["z_bas"] + po["h"] / 2, f"porte de monnayeur\n{fmt(po['l'])} × {fmt(po['h'])}, R {fmt(po['r'])}\n"
            f"bas à {fmt(po['z_bas'])}", fontsize=4.5, color=ROUGE)
    for t in fa["trous"]:
        ax.add_patch(Circle((t["x"], t["z"]), t["d"] / 2, fill=False, ec=ROUGE, lw=0.5))
        ax.text(t["x"] - 25, t["z"] + 22, f"{t['fonction'].split(' (')[0]} Ø {fmt(t['d'])}", fontsize=4.2, color=ROUGE)
    ax.text(0, -80, f"Largeur entre flancs : {fmt(M.LARG - 2 * E)}. Haut biseauté à {fmt(fa.get('biseau_deg', 79.76))}°\n"
            "(sous la barre de verrouillage). Porte facultative :\nmonnayeur ou simple trappe.", fontsize=4.5)
    # arrière
    ax = vue(fig, A3L, 320, 140, 90, 140, -60, -90, 8)
    ax.set_title("Panneau arrière", fontsize=7, loc="left")
    ar = M.PANNEAUX["arriere"]
    dessiner_panneau(ax, "arriere")
    ob, ve = ar["oblongs"], ar["ventil"]
    for x in (ob["x_gauche"], M.LARG - 2 * E - ob["x_gauche"] - ob["l"]):
        ax.add_patch(FancyBboxPatch((x + ob["h"] / 2, ob["z"] - ob["h"] / 2 + 0.1), ob["l"] - ob["h"], ob["h"] - 0.2,
                                    boxstyle=f"round,pad=0,rounding_size={ob['h'] / 2}", fill=False, ec=ROUGE, lw=0.5))
    ax.add_patch(Circle((ve["x"], ve["z"]), ve["d"] / 2, fill=False, ec=ROUGE, lw=0.5))
    ax.text(ve["x"] + 50, ve["z"], f"ventilateur Ø {fmt(ve['d'])}\n4 vis Ø {fmt(ve['vis'])} au carré de {fmt(ve['entraxe'])}", fontsize=4.2, color=ROUGE)
    ax.text(ob["x_gauche"], ob["z"] + 35, f"2 oblongs {fmt(ob['l'])} × {fmt(ob['h'])} à z = {fmt(ob['z'])}", fontsize=4.2, color=ROUGE)
    # fond, dessus arrière
    ax = vue(fig, A3L, 15, 40, 260, 85, -80, -60, 8)
    ax.set_title("Fond (vu de dessus, avant à gauche) et dessus arrière", fontsize=7, loc="left")
    fo = M.PANNEAUX["fond"]["contour"]
    ax.add_patch(Polygon([(y, x) for x, y in fo], closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7))
    cote(ax, (0, 0), (M.LONG - 2 * E, 0), -35); cote(ax, (M.LONG - 2 * E, 0), (M.LONG - 2 * E, M.LARG - 2 * E), -35)
    da = M.PANNEAUX["dessus_arriere"]["contour"]
    off = M.LONG + 60
    ax.add_patch(Polygon([(off + y, x) for x, y in da], closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7))
    cote(ax, (off, 0), (off + M.PLAT - E, 0), -35)
    ax.text(off, M.LARG - 2 * E + 15, "dessus arrière, oblong câbles 160 × 50", fontsize=4.5)
    txt = [f"Contreplaqué {fmt(E)} mm (bouleau ou peuplier).",
           "Assemblage : feuillures 10 × 10 + colle vinylique",
           "+ vis 4 × 50 ; tasseaux d'angle 20 × 20 à l'intérieur.",
           f"Pieds : 4 pieds WPC 28-1/2\" ({fmt(M.PIED['l'])}), cornière thermolaquée,",
           f"2 boulons 3/8\"-16 × 2-1/2\" par pied, EN DIAGONALE à 45° dans l'arête :",
           f"trous Ø {fmt(M.PIED['d_trou'])} à {fmt(M.PIED['z_trous'][0])} et {fmt(M.PIED['z_trous'][1])} du bas de caisse,",
           "percés pied en place (gabarit), dans la platine d'angle intérieure (01-11400-1).",
           "Vérins 3/8\"-16 : tige 2\" à l'avant, 3\" à l'arrière.",
           f"Hauteur bas de caisse / sol ≈ {fmt(CT['h_sol'])} (barre ≈ 930).",
           "Cotes WPC : Pinball Makers (Wpc-cabinet-2/3)."]
    for i, l in enumerate(txt):
        fig.text(285 / 420, (118 - 6 * i) / 297, l, fontsize=5.5)


def p_fronton():
    fig = page(A3L, "Fronton (backbox WPC) — côtés, dessus, dessous, fond (1:6)", 9)
    fr = M.V(CAISSE["fronton"]); E = M.EPC
    ax = vue(fig, A3L, 20, 45, 90, 230, -60, -90, 6)
    ax.set_title("Côté (×2), arrière à gauche", fontsize=7, loc="left")
    co = M.PANNEAUX["fronton_cote"]["contour"]
    ax.add_patch(Polygon(co, closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7))
    cote(ax, (0, 0), (fr["p_bas"], 0), -40); cote(ax, (0, fr["h"]), (fr["p_haut"], fr["h"]), 30)
    cote(ax, (0, 0), (0, fr["h"]), 40)
    for k, (nom, cx) in enumerate((("fronton_dessus", 130), ("fronton_dessous", 130), ("fronton_fond", 250))):
        P = M.PANNEAUX[nom]; poly = P["contour"]
        y = [180, 90, 45][k] if nom != "fronton_fond" else 45
        h = 90 if nom != "fronton_fond" else 230
        ax = vue(fig, A3L, cx if nom != "fronton_fond" else 260, [190, 105][k] if k < 2 else 45, 120 if k < 2 else 150,
                 80 if k < 2 else 230, -60, -60, 6)
        ax.set_title(P["nom"] + (" (contreplaqué 6)" if nom == "fronton_fond" else ""), fontsize=7, loc="left")
        ax.add_patch(Polygon(poly, closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7))
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        cote(ax, (0, 0), (max(xs), 0), -30); cote(ax, (max(xs), 0), (max(xs), max(ys)), -30)
        if "oblong_cables" in P:
            oc = P["oblong_cables"]
            ax.add_patch(Rectangle((max(xs) / 2 - oc["l"] / 2, max(ys) / 2 - oc["h"] / 2), oc["l"], oc["h"], fill=False, ec=ROUGE, lw=0.5))
    fig.text(20 / 420, 36 / 297, f"Fronton {fmt(fr['l'])} × {fmt(fr['h'])}, plus large que la caisse ({fmt(M.LARG)}) : il déborde de "
             f"{fmt((fr['l'] - M.LARG) / 2)} de chaque côté. Il reçoit l'illustration (fronton Krea 2), les 3 afficheurs TM1637 et le "
             "haut-parleur. Charnière en bas à l'arrière + 2 verrous (achats).", fontsize=5.5)


# ================================================================== 10 assemblage
def p_assemblage():
    fig = page(A3L, "Assemblage — coupe longitudinale cotée et vues 3D", 10)
    ax = vue(fig, A3L, 15, 45, 230, 235, -150, -650, 10)
    ax.set_title("Coupe par l'axe (avant à gauche) — 1:10", fontsize=7, loc="left")
    h_sol = CT["h_sol"]
    ax.add_patch(Polygon(M.FLANC, closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7, alpha=0.6))
    fr = M.V(CAISSE["fronton"])
    ax.add_patch(Polygon([(M.LONG, M.HAR), (M.LONG - fr["p_bas"], M.HAR), (M.LONG - fr["p_haut"], M.HAR + fr["h"]), (M.LONG, M.HAR + fr["h"])],
                         closed=True, fc="#f3e6d3", ec=NOIR, lw=0.7, alpha=0.6))
    a = M.plateau_vers_caisse(0, 0); b = M.plateau_vers_caisse(0, M.H)
    ax.plot([a[1], b[1]], [a[2], b[2]], color=VERT, lw=2)
    c_ = M.plateau_vers_caisse(0, M.H + M.RALLONGE["h"])
    ax.plot([b[1], c_[1]], [b[2], c_[2]], color=VERT, lw=2, ls=(0, (2, 1)))
    ax.text(b[1] - 120, b[2] + 25, f"rallonge {fmt(M.RALLONGE['h'])}", fontsize=5, color=VERT)
    ax.plot([0, M.LONG], [-h_sol, -h_sol], color=NOIR, lw=0.8)
    pd = M.PIED
    prof = [(-pd["ep"], pd["z_bas"]), (pd["aile_bas"] - pd["ep"], pd["z_bas"]), (pd["aile_haut"] - pd["ep"], pd["z_haut"] - pd["droit"]),
            (pd["aile_haut"] - pd["ep"], pd["z_haut"]), (-pd["ep"], pd["z_haut"])]
    for sens, y0 in ((1, 0), (-1, M.LONG)):
        ax.add_patch(Polygon([(y0 + sens * w, z) for w, z in prof], closed=True, fc="#3a3a40", ec=NOIR, lw=0.4))
        for z in pd["z_trous"]:
            ax.add_patch(Circle((y0, z), 8, fc="#c9ccd2", ec=NOIR, lw=0.3))
        ax.plot([y0 + sens * 18, y0 + sens * 18], [-h_sol, pd["z_bas"]], color=GRIS, lw=1.2)
    cote(ax, (0, pd["z_trous"][0]), (0, 0), -25, f"{fmt(pd['z_trous'][0])}")
    cote(ax, (0, -h_sol), (0, 0), 60, f"{fmt(h_sol)}")
    cote(ax, (0, -h_sol), (0, M.HAV), 120, f"{fmt(h_sol + M.HAV)} (barre)")
    cote(ax, (M.LONG, -h_sol), (M.LONG, M.HAR + fr["h"]), -80, f"{fmt(h_sol + M.HAR + fr['h'])} (hors tout)")
    cote(ax, (a[1], 0), (a[1], a[2]), -30, f"{fmt(a[2])}")
    ax.text(a[1] + 40, a[2] + 20, f"plateau {M.V(PLATEAU['pente_deg'])}°", fontsize=5.5, color=VERT)
    cote(ax, (0, -h_sol), (M.LONG, -h_sol), -40)
    for i, f in enumerate(("vue_ensemble", "vue_plateau", "vue_dessous")):
        chem = os.path.join(ICI, "sortie", "rendu", f"{f}.png")
        if os.path.exists(chem):
            axi = fig.add_axes([255 / 420, (195 - 78 * i) / 297, 150 / 420, 75 / 297]); axi.axis("off")
            axi.imshow(plt.imread(chem)[60:-60, 150:-150]); axi.set_title(f.replace("_", " "), fontsize=5.5)


# ================================================================== 11 nomenclature et débit
def pouces(v):
    """0.125 → 1/8\", 2.5 → 2-1/2\""""
    ent, fr = int(v), v - int(v)
    frac = {0: "", 0.125: "1/8", 0.25: "1/4", 0.3125: "5/16", 0.375: "3/8", 0.4375: "7/16", 0.5: "1/2", 0.75: "3/4"}.get(round(fr, 4), f"{fr:.3f}")
    return (f"{ent}-{frac}" if ent and frac else str(ent) if ent else frac) + '"'


def p_nomenclature():
    fig = page(A3L, "Nomenclature, quincaillerie et débit des panneaux", 11)
    ax = fig.add_axes([15 / 420, 40 / 297, 190 / 420, 245 / 297]); ax.axis("off")
    nfix = sum(len(p.get("fix", [])) for p in M.PIECES)
    nkw = 4 + 3 + 3 + 1 + 1 + 4      # rollovers, cibles fixes, cibles rondes, Cercle, lancement, bac (3) + évacuation
    lignes = [("ACHATS — mécanique", ""), ("Mécanismes de flipper complets + palettes 3\"", "2"),
              ("Ensembles bumper (corps, anneau, jupe, contact)", "3"), ("Ensembles lance-pierre + contacts à lames", "2"),
              ("Banque de 5 cibles tombantes", "1"), ("Bobines (dont knocker, éjecteurs, lanceur)", "12"),
              *[(f"Anneau caoutchouc {'blanc' if a['type'] == 'sling' else 'noir'} {pouces(a['id_pouces'])} ID "
                 f"({'lance-pierre' if a['type'] == 'sling' else 'poteau d’entrée de couloir'})", "1") for a in M.ANNEAUX],
              ("Caoutchoucs de palette 3\" (rouges)", "2"),
              (f"Axes acier Ø 3 des cibles fixes (longueur = largeur du boîtier)", f"{sum(1 for p in M.PIECES if p['type'] == 'cible_face')}"), ("Billes 27 mm (1-1/16\")", "4"),
              ("Pieds WPC 28-1/2\" thermolaqués + platines 01-11400-1 + vérins", "4"), ("Boulons 3/8\"-16 × 2-1/2\" tête bombée (pieds)", "8"), ("Barre de verrouillage, charnière et verrous de fronton", "1"),
              ("Verre trempé 4 mm (à mesurer sur la caisse)", "1"),
              ("ACHATS — détection et électronique", ""), (f"Micro-rupteurs KW11-3Z (levier long pour les rollovers)", f"{nkw}"),
              ("Corde à piano Ø 1,5 (rollovers), axe acier Ø 3 (cibles)", "1 m + 0,5 m"),
              ("LED IR 940 nm + phototransistor Ø 5", "1 paire"), ("LED WS2812B (bande 60/m, découpée)", f"{len(M.G['lamps'])} + éclairage"),
              ("Inserts acrylique (disques coulés, Ø selon tableau)", f"{len(M.G['lamps'])}"),
              ("QUINCAILLERIE", ""), ("Inserts laiton M3 à chaud", f"{nfix + 2 * len(M.supports) + 20}"),
              ("Vis M3 × 20 tête cylindrique + rondelles", f"{nfix + 20}"), ("Vis à bois 3,5 × 13 tête ronde (platines)", "≈ 60"),
              ("Vis à bois 4 × 50 (caisse)", "≈ 80"), ("Tasseaux 20 × 20 (angles) et 20 × 30 (plateau)", "≈ 6 m + 2 × 1 m"),
              ("IMPRESSION 3D (PETG)", ""), ("Pièces posées sur le plateau (STL dans cao/sortie/pieces/)",
                                             f"{sum(1 for p in M.PIECES if not p['achat'] and p['type'] not in ('zone',))}"),
              ("Tronçons de rampe", f"{math.ceil(M.L_RAMPE / M.V(RAMPE['troncon_max']))}")]
    for i, (a, b) in enumerate(lignes):
        gras = b == ""
        ax.text(0, 1 - i * 0.034, a, fontsize=6, weight="bold" if gras else None, va="top")
        ax.text(0.92, 1 - i * 0.034, b, fontsize=6, va="top", ha="right")
    # débit : panneaux de 2500 × 1250
    ax = vue(fig, A3L, 215, 60, 190, 215, -50, -60, 13.5)
    ax.set_title("Débit indicatif — contreplaqué 19 mm, panneaux 2500 × 1250 (1:13,5)", fontsize=7, loc="left")
    E = M.EPC; fr = M.V(CAISSE["fronton"])
    pieces = [("flanc G", M.LONG, M.HAR), ("flanc D", M.LONG, M.HAR), ("fond", M.LONG - 2 * E, M.LARG - 2 * E),
              ("façade", M.LARG - 2 * E, M.HAV), ("arrière", M.LARG - 2 * E, M.HAR - E), ("dessus arr.", M.LARG - 2 * E, M.PLAT - E),
              ("fronton côté", fr["p_haut"], fr["h"]), ("fronton côté", fr["p_haut"], fr["h"]),
              ("fronton dessus", fr["l"] - 2 * E, fr["p_haut"]), ("fronton dessous", fr["l"] - 2 * E, fr["p_bas"])]
    feuilles, x, y, rang, f = [[]], 0, 0, 0, 0
    for nom, l, h in sorted(pieces, key=lambda p: -p[2]):
        if x + l > 2500:
            x, y = 0, y + rang + 5; rang = 0
        if y + h > 1250:
            f += 1; feuilles.append([]); x = y = rang = 0
        feuilles[f].append((nom, x, y, l, h)); x += l + 5; rang = max(rang, h)
    for k, fe in enumerate(feuilles):
        oy = k * 1400
        ax.add_patch(Rectangle((0, oy), 2500, 1250, fill=False, ec=NOIR, lw=0.6))
        ax.text(0, oy + 1270, f"panneau {k + 1}", fontsize=5.5)
        for nom, x, y, l, h in fe:
            ax.add_patch(Rectangle((x, oy + y), l, h, fc="#f3e6d3", ec=NOIR, lw=0.4))
            ax.text(x + l / 2, oy + y + h / 2, f"{nom}\n{fmt(l)} × {fmt(h)}", fontsize=4, ha="center", va="center")
    fig.text(215 / 420, 50 / 297, f"Plateau : contreplaqué bouleau 12 mm, {M.W} × {M.H} (1 panneau 1250 × 2500 ou 1220 × 1220 × 2), "
             f"et sa rallonge fixe {M.W} × {fmt(M.RALLONGE['h'])} (encoche câbles {fmt(M.RALLONGE['encoche']['l'])} × {fmt(M.RALLONGE['encoche']['p'])}). "
             "Fond du fronton : contreplaqué 6 mm.", fontsize=5.2)


def main():
    p01(); p_tableau(); p_dessous(); p_detection(); p_pieces(); p_rampe(); p_caisse(); p_fronton(); p_assemblage(); p_nomenclature()
    chem = os.path.join(SORTIE, "plans_fanny_pinball.pdf")
    with PdfPages(chem) as pdf:
        for i, fig in enumerate(PAGES):
            pdf.savefig(fig)
            fig.savefig(os.path.join(SORTIE, f"planche_{i + 1:02d}.png"), dpi=110)
    print("ok", chem, len(PAGES), "planches")


if __name__ == "__main__":
    main()
