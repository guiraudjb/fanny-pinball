"""Finition mécanique des tables : pièces 3D (primitives VPX à maillage, sans collision) et leurs décors, au même
format que le décor de Fanny Pinball (outils/vpx/decor_glb.py) : sortie/decor/decor.json + g###.bin
(sommets x, y, z, nx, ny, nz, u, v en float32, unités VP, z vers le haut ; puis indices uint32) + textures.

  - bumpers : chapeau décoré (disque imprimé sous une coupelle translucide) à la place du chapeau uni de VPX ;
  - lance-pierres : plastron imprimé aux coins arrondis (plexiglas de 3 mm) sur trois montants chromés, écrous dessus ;
  - cibles : plastron aux coins arrondis derrière chaque cible, sur deux montants ;
  - tablier : tôle sous les palettes, cartes d'instructions (règles, parties gratuites) ;
  - palettes : chapeau d'axe chromé (l'élastique et le dessus décoré sont ceux de la palette VPX : palette.png) ;
  - guides de couloir : déjà en fil d'acier (plan.rail, générateur).

Thème (Table.deco) : c1, c2, c3 (couleurs), titre, bumper ('etoile' | 'plaque' : plaques de course numérotées),
art_plastique (image découpée dans les plastrons, en miroir pour celui de droite).
Appelé par Table.ecrire().
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

MM = 1 / 0.54
POLICE = next(p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                          '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'] if os.path.exists(p))


def rgbi(h):
    return int(h[1:], 16)


class Groupe:
    def __init__(self, couleur, metal=False, rugosite=0.5, opacite=1.0, texture=None, emissif=False):
        self.mat = dict(couleur=couleur, metal=metal, rugosite=rugosite, opacite=opacite, texture=texture,
                        emissif=emissif, deux_faces=True, alpha=None, mobile=None)
        self.V, self.I = [], []

    def tri(self, a, b, c):
        # face avant pour vpinball : (b − a) × (c − a) du côté de la normale ; sinon on retourne le triangle
        # (vpinball ne dessine pas l'envers d'une pièce opaque)
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2]); w = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        cr = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        nm = [a[3] + b[3] + c[3], a[4] + b[4] + c[4], a[5] + b[5] + c[5]]
        if cr[0] * nm[0] + cr[1] * nm[1] + cr[2] * nm[2] < 0:
            b, c = c, b
        n = len(self.V)
        self.V += [a, b, c]
        self.I.append((n, n + 1, n + 2))

    def quad(self, a, b, c, d):
        self.tri(a, b, c); self.tri(a, c, d)


def sommet(x, y, z, n, u=0.0, v=0.0):
    """x, y, z en mm (z = hauteur au-dessus du plateau) → unités VP"""
    return (x * MM, y * MM, z * MM, n[0], n[1], n[2], u, v)


def cylindre(g, cx, cy, r, z0, z1, n=24, dessus=True, uv_disque=False, dessous=False):
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        p0 = (cx + r * math.cos(a0), cy + r * math.sin(a0)); p1 = (cx + r * math.cos(a1), cy + r * math.sin(a1))
        n0 = (math.cos(a0), math.sin(a0), 0); n1 = (math.cos(a1), math.sin(a1), 0)
        g.quad(sommet(*p0, z0, n0), sommet(*p1, z0, n1), sommet(*p1, z1, n1), sommet(*p0, z1, n0))
        for z, nz, ok in ((z1, 1, dessus), (z0, -1, dessous)):
            if not ok:
                continue
            uv = (lambda x, y: (0.5 + 0.5 * (x - cx) / r, 0.5 + 0.5 * (y - cy) / r)) if uv_disque else (lambda x, y: (0, 0))
            g.tri(sommet(cx, cy, z, (0, 0, nz), *uv(cx, cy)), sommet(*p0, z, (0, 0, nz), *uv(*p0)), sommet(*p1, z, (0, 0, nz), *uv(*p1)))


def dome(g, cx, cy, r, z0, h, n=24, anneaux=6):
    """calotte (écrou borgne, chapeau d'axe) : base au niveau z0, sommet à z0 + h"""
    pts = []
    for i in range(anneaux + 1):
        t = i / anneaux * math.pi / 2
        pts.append((r * math.cos(t), z0 + h * math.sin(t), math.cos(t), math.sin(t)))
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        for (r0, z_0, c0, s0), (r1, z_1, c1, s1) in zip(pts, pts[1:]):
            P = lambda rr, zz, a, cc, ss: sommet(cx + rr * math.cos(a), cy + rr * math.sin(a), zz, (cc * math.cos(a), cc * math.sin(a), ss))
            g.quad(P(r0, z_0, a0, c0, s0), P(r0, z_0, a1, c0, s0), P(r1, z_1, a1, c1, s1), P(r1, z_1, a0, c1, s1))


def decaler(poly, d):
    """polygone convexe agrandi de d mm (arêtes poussées vers l'extérieur)"""
    n = len(poly)
    aire = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    s = 1 if aire > 0 else -1
    lignes = []
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        l = math.hypot(dx, dy)
        nx, ny = s * dy / l, -s * dx / l                   # normale extérieure
        lignes.append(((x0 + nx * d, y0 + ny * d), (dx, dy)))
    out = []
    for i in range(n):
        (p, u), (q, w) = lignes[i - 1], lignes[i]
        det = u[0] * w[1] - u[1] * w[0]
        t = ((q[0] - p[0]) * w[1] - (q[1] - p[1]) * w[0]) / det
        out.append((p[0] + u[0] * t, p[1] + u[1] * t))
    return out


def arrondi(poly, d, r, pas=10):
    """polygone convexe agrandi de d mm, coins arrondis au rayon r (contour d − r, puis disque de rayon r)"""
    p = decaler(poly, d - r)
    n = len(p)
    aire = sum(p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1] for i in range(n))
    s = 1 if aire > 0 else -1
    normale = lambda a, b: (s * (b[1] - a[1]) / math.hypot(b[0] - a[0], b[1] - a[1]), -s * (b[0] - a[0]) / math.hypot(b[0] - a[0], b[1] - a[1]))
    out = []
    for i in range(n):
        n0, n1 = normale(p[i - 1], p[i]), normale(p[i], p[(i + 1) % n])
        a0, a1 = math.atan2(n0[1], n0[0]), math.atan2(n1[1], n1[0])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(pas + 1):
            a = a0 + da * k / pas
            out.append((p[i][0] + r * math.cos(a), p[i][1] + r * math.sin(a)))
    return out


def anneau(g, interieur, exterieur, z0, z1):
    """bande fermée entre deux contours de même nombre de sommets (élastique tendu autour des montants)"""
    n = len(interieur)
    cx = sum(p[0] for p in interieur) / n; cy = sum(p[1] for p in interieur) / n
    for i in range(n):
        j = (i + 1) % n
        for cont, sens in ((exterieur, 1), (interieur, -1)):
            a, b = cont[i], cont[j]
            l = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
            nn = ((b[1] - a[1]) / l, -(b[0] - a[0]) / l, 0)
            if (((a[0] + b[0]) / 2 - cx) * nn[0] + ((a[1] + b[1]) / 2 - cy) * nn[1]) * sens < 0:
                nn = (-nn[0], -nn[1], 0)
            g.quad(sommet(*a, z0, nn), sommet(*b, z0, nn), sommet(*b, z1, nn), sommet(*a, z1, nn))
        for z, nz in ((z1, 1), (z0, -1)):
            g.quad(sommet(*interieur[i], z, (0, 0, nz)), sommet(*interieur[j], z, (0, 0, nz)),
                   sommet(*exterieur[j], z, (0, 0, nz)), sommet(*exterieur[i], z, (0, 0, nz)))


def tube(g, pts, r, n=10):
    """tube de rayon r le long d'une polyligne 3D (mm) : bord chromé des rampes, baguettes"""
    P = [np.array(p, float) for p in pts]
    anneaux = []
    for i, p in enumerate(P):
        d = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
        d /= np.linalg.norm(d) or 1
        u = np.cross(d, (0, 0, 1)); u = u / (np.linalg.norm(u) or 1)
        v = np.cross(u, d)
        anneaux.append([(p + r * (math.cos(a) * u + math.sin(a) * v), math.cos(a) * u + math.sin(a) * v)
                        for a in (2 * math.pi * k / n for k in range(n))])
    for A, B in zip(anneaux, anneaux[1:]):
        for k in range(n):
            j = (k + 1) % n
            g.quad(*(sommet(*q[0], q[1]) for q in (A[k], A[j], B[j], B[k])))


def extrusion(g_dessus, g_flanc, poly, z0, z1, bbox, uv=None, centre=None):
    x0, y0, x1, y1 = bbox
    uv = uv or (lambda x, y: ((x - x0) / (x1 - x0), (y - y0) / (y1 - y0)))
    cx = sum(p[0] for p in poly) / len(poly); cy = sum(p[1] for p in poly) / len(poly)
    if centre:                                  # forme non convexe mais étoilée depuis ce point (coins du plateau)
        cx, cy = centre
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        g_dessus.tri(sommet(cx, cy, z1, (0, 0, 1), *uv(cx, cy)), sommet(*a, z1, (0, 0, 1), *uv(*a)), sommet(*b, z1, (0, 0, 1), *uv(*b)))
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        nn = ((b[1] - a[1]) / l, -(b[0] - a[0]) / l, 0)
        if ((a[0] + b[0]) / 2 - cx) * nn[0] + ((a[1] + b[1]) / 2 - cy) * nn[1] < 0:
            nn = (-nn[0], -nn[1], 0)
        g_flanc.quad(sommet(*a, z0, nn), sommet(*b, z0, nn), sommet(*b, z1, nn), sommet(*a, z1, nn))


# ------------------------------------------------------------------------------------------------ décors (textures)
def damier(dr, cx, cy, r0, r1, n, c_a, c_b):
    for k in range(n):
        dr.pieslice((cx - r1, cy - r1, cx + r1, cy + r1), 360 * k / n, 360 * (k + 1) / n, fill=c_a if k % 2 else c_b)
    dr.ellipse((cx - r0, cy - r0, cx + r0, cy + r0), fill=None)


def image_chapeau(theme, i, chemin):
    S = 512
    im = Image.new('RGB', (S, S), theme['c2'])
    dr = ImageDraw.Draw(im)
    c = S / 2
    if theme.get('bumper') == 'plaque':
        # plaque de course : couronne à damier, plaque jaune, numéro noir
        for k in range(32):
            dr.pieslice((4, 4, S - 4, S - 4), 360 * k / 32, 360 * (k + 1) / 32, fill='#111111' if k % 2 else '#f4f4f4')
        dr.ellipse((60, 60, S - 60, S - 60), fill=theme['c3'])
        dr.ellipse((78, 78, S - 78, S - 78), fill=theme['c1'], outline='#111111', width=8)
        ft = ImageFont.truetype(POLICE, 230)
        dr.text((c, c + 6), str(i + 1), font=ft, fill='#111111', anchor='mm')
    else:
        # étoile : couronne pointillée, disque, étoile et titre
        dr.ellipse((4, 4, S - 4, S - 4), fill=theme['c1'])
        for k in range(24):
            a = 2 * math.pi * k / 24
            x, y = c + 222 * math.cos(a), c + 222 * math.sin(a)
            dr.ellipse((x - 9, y - 9, x + 9, y + 9), fill='#ffffff')
        dr.ellipse((60, 60, S - 60, S - 60), fill=theme['c2'], outline='#111111', width=6)
        pts = [(c + (170 if k % 2 == 0 else 70) * math.cos(-math.pi / 2 + k * math.pi / 5),
                c + (170 if k % 2 == 0 else 70) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]
        dr.polygon(pts, fill=theme['c3'], outline='#111111', width=5)
        ft = ImageFont.truetype(POLICE, 44)
        dr.text((c, c + 6), theme['titre'][:10], font=ft, fill='#ffffff', anchor='mm', stroke_width=4, stroke_fill='#111111')
    im.save(chemin)


def image_plastron(theme, poly, bbox, miroir, chemin):
    """plastron imprimé : dégradé c1 → c3, illustration éventuelle, liseré noir et filet blanc le long du bord"""
    W, H = 512, 768
    x0, y0, x1, y1 = bbox
    P = [((x - x0) / (x1 - x0) * W, (y - y0) / (y1 - y0) * H) for x, y in poly]
    c1, c3 = np.array(Image.new('RGB', (1, 1), theme['c1']).getpixel((0, 0))), np.array(Image.new('RGB', (1, 1), theme['c3']).getpixel((0, 0)))
    t = np.linspace(0, 1, H)[:, None, None]
    im = Image.fromarray(np.broadcast_to(c1 * (1 - t) + c3 * t, (H, W, 3)).astype(np.uint8).copy())
    if theme.get('art_plastique') and os.path.exists(theme['art_plastique']):
        a = Image.open(theme['art_plastique']).convert('RGB')
        k = max(W / a.width, H / a.height)
        a = a.resize((round(a.width * k), round(a.height * k)), Image.LANCZOS)
        cx = int(a.width * theme.get('art_cx', 0.5)) - W // 2
        a = a.crop((max(0, min(cx, a.width - W)), (a.height - H) // 2, max(0, min(cx, a.width - W)) + W, (a.height - H) // 2 + H))
        if miroir:
            a = a.transpose(Image.FLIP_LEFT_RIGHT)
        im = Image.blend(im, a, 0.85)
    dr = ImageDraw.Draw(im)
    dr.line(P + [P[0]], fill='#111111', width=22, joint='curve')
    dr.line(P + [P[0]], fill='#ffffff', width=6, joint='curve')
    im.save(chemin)


def carte(im, x0, y0, x1, y1, titre, lignes, theme):
    """carte d'instructions imprimée (blanc cassé, bandeau de titre, lignes coupées à la largeur)"""
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle((x0, y0, x1, y1), radius=14, fill='#f4efe2', outline='#111111', width=4)
    dr.rectangle((x0 + 4, y0 + 4, x1 - 4, y0 + 58), fill=theme['c3'])
    ft = ImageFont.truetype(POLICE, 36)
    dr.text(((x0 + x1) / 2, y0 + 32), titre, font=ft, fill='#ffffff', anchor='mm')
    ft = ImageFont.truetype(POLICE.replace('-Bold', ''), 23)
    y = y0 + 74
    for l in lignes:
        mots, cur = l.split(), ''
        for m in mots:
            if ft.getlength(cur + ' ' + m) > x1 - x0 - 36 and cur:
                dr.text((x0 + 18, y), cur, font=ft, fill='#141414'); y += 28; cur = '  ' + m
            else:
                cur = (cur + ' ' + m).strip() if cur else m
        dr.text((x0 + 18, y), cur, font=ft, fill='#141414'); y += 31


def image_tablier(theme, regles, bbox, chemin):
    """dessus du tablier (4 px/mm) : fond c2, filets c1, carte des règles à gauche, carte des parties à droite, titre"""
    x0, y0, x1, y1 = bbox
    K = 4
    W, H = int((x1 - x0) * K), int((y1 - y0) * K)
    im = Image.new('RGB', (W, H), theme['c2'])
    dr = ImageDraw.Draw(im)
    dr.rectangle((0, 0, W, 10), fill=theme['c1']); dr.rectangle((0, 18, W, 22), fill=theme['c1'])
    cw = int(W * 0.36)
    carte(im, 24, 40, 24 + cw, H - 20, 'RÈGLES', regles, theme)
    carte(im, W - 24 - cw, 40, W - 24, H - 20, '1 JOUEUR · 3 BILLES', [
        'Partie gratuite à 150 000, 300 000 et 500 000 points.',
        'Match en fin de partie : partie gratuite.',
        'Nouveau record : partie gratuite.',
        'Trois coups de caisse rapprochés : TILT.'], theme)
    ft = ImageFont.truetype(POLICE, 54)
    dr.text((W / 2, H * 0.62), theme['titre'][:12], font=ft, fill=theme['c1'], anchor='mm', stroke_width=4, stroke_fill='#111111')
    im.save(chemin, quality=92)


def image_plaque(theme, chemin):
    """plastron de cible : couleur c1, filet blanc, liseré noir, étoile c3"""
    W, H = 256, 192
    im = Image.new('RGB', (W, H), theme['c1'])
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle((3, 3, W - 3, H - 3), radius=40, outline='#111111', width=12)
    dr.rounded_rectangle((18, 18, W - 18, H - 18), radius=30, outline='#ffffff', width=5)
    c = (W / 2, H / 2)
    pts = [(c[0] + (44 if k % 2 == 0 else 18) * math.cos(-math.pi / 2 + k * math.pi / 5),
            c[1] + (44 if k % 2 == 0 else 18) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]
    dr.polygon(pts, fill=theme['c3'], outline='#111111', width=3)
    im.save(chemin)


def image_tourniquet(theme, chemin):
    """plaque du tourniquet : deux faces aux couleurs du thème, titre"""
    W, H = 256, 128
    im = Image.new('RGB', (W, H), theme['c1'])
    dr = ImageDraw.Draw(im)
    dr.rectangle((0, 0, W, H * 0.22), fill=theme['c2']); dr.rectangle((0, H * 0.78, W, H), fill=theme['c2'])
    for k in range(0, W, 32):
        dr.rectangle((k, 0, k + 16, H * 0.12), fill=theme['c1']); dr.rectangle((k + 16, H * 0.88, k + 32, H), fill=theme['c1'])
    ft = ImageFont.truetype(POLICE, 34)
    dr.text((W / 2, H / 2), theme['titre'][:10], font=ft, fill=theme['c3'], anchor='mm', stroke_width=3, stroke_fill='#ffffff')
    im.save(chemin)


def image_palette(theme, chemin):
    """dessus des palettes (image de la palette VPX) : blanc, bande de couleur, titre"""
    W, H = 512, 128
    im = Image.new('RGB', (W, H), '#f4f4f4')
    dr = ImageDraw.Draw(im)
    dr.rectangle((0, H * 0.34, W, H * 0.66), fill=theme['c3'])
    dr.rectangle((0, H * 0.30, W, H * 0.34), fill=theme['c1']); dr.rectangle((0, H * 0.66, W, H * 0.70), fill=theme['c1'])
    ft = ImageFont.truetype(POLICE, 30)
    dr.text((W / 2, H / 2), theme['titre'][:14], font=ft, fill='#ffffff', anchor='mm', stroke_width=2, stroke_fill='#111111')
    im.save(chemin)


# ------------------------------------------------------------------------------------------------ assemblage
def construire(t, sortie):
    d = os.path.join(sortie, 'decor')
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    theme = dict(c1='#e01b24', c2='#1c2433', c3='#1c71d8', titre=t.titre.upper(), bumper='etoile')
    theme.update(getattr(t, 'deco', {}) or {})
    groupes = []

    chrome = Groupe(0xe6eaef, metal=True, rugosite=0.12)
    caoutchouc = Groupe(rgbi(theme.get('elastique', '#c01c28')), rugosite=0.8)
    groupes.append(caoutchouc)
    groupes.append(chrome)

    # bumpers : disque imprimé sous une coupelle translucide, bague chromée
    for i, b in enumerate(t.bumpers):
        tex = f'chapeau_{i}.png'
        image_chapeau(theme, i, os.path.join(d, tex))
        imp = Groupe(0xffffff, rugosite=0.6, texture=tex)
        cylindre(imp, b['x'], b['y'], b['r'] * 0.98, 41.0, 46.0, n=40, uv_disque=True)
        coupe = Groupe(0xffffff, rugosite=0.05, opacite=0.35)
        dome(coupe, b['x'], b['y'], b['r'] * 1.0, 46.0, 4.0, n=40)
        cylindre(chrome, b['x'], b['y'], b['r'] * 1.04, 39.5, 41.5, n=40, dessus=False)
        groupes += [imp, coupe]

    # lance-pierres : plastron sur trois montants (les sommets du lance-pierre), écrous borgnes
    bas_fanny = getattr(t, 'bas_fanny', False)      # base universelle : lance-pierres et tablier de Fanny (moteur/bas_fanny)
    for s in ([] if bas_fanny else t.lance_pierres):
        pts = [tuple(p) for p in s['pts']]
        poly = arrondi(pts, -1.0, 6.0)          # plastron en retrait de l'élastique (on le voit de face et du dessus)
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        bbox = (min(xs), min(ys), max(xs), max(ys))
        tex = f"plastron_{s['nom']}.png"
        image_plastron(theme, poly, bbox, pts[0][0] > 237, os.path.join(d, tex))
        dessus = Groupe(0xffffff, rugosite=0.85, texture=tex)
        flanc = Groupe(0xf0f4ff, rugosite=0.9, opacite=0.6)
        extrusion(dessus, flanc, poly, 38.0, 41.0, bbox)
        groupes += [dessus, flanc]
        # élastique tendu autour des trois montants (la face de frappe VPX est au contour du lance-pierre :
        # l'élastique en affleure de 1,5 mm), montants posés 4 mm à l'intérieur
        anneau(caoutchouc, arrondi(pts, -1.6, 2.4), arrondi(pts, 1.5, 5.5), 4.0, 22.0)
        for x, y in decaler(pts, -4.0):
            cylindre(chrome, x, y, 2.2, 0.0, 38.0, n=16, dessus=False)
            cylindre(chrome, x, y, 4.2, 41.0, 43.0, n=6)            # écrou hexagonal
            dome(chrome, x, y, 3.6, 43.0, 3.0, n=16)

    if not bas_fanny:
        # tablier (plastron sous les palettes) : tôle peinte, lèvre arrière inclinée, dessus imprimé (cartes), face avant
        x0, x1, yb, yh, yf, h = 30.0, 444.0, 1150.0, 1172.0, 1263.0, 20.0
        image_tablier(theme, t.regles, (x0, yb, x1, yf), os.path.join(d, 'tablier.jpg'))
        dessus = Groupe(0xffffff, rugosite=0.55, texture='tablier.jpg')
        tole = Groupe(rgbi(theme['c2']) if theme['c2'].startswith('#') else 0x222222, rugosite=0.5)
        uv = lambda x, y: ((x - x0) / (x1 - x0), (y - yb) / (yf - yb))
        nl = (0, -h, yh - yb); ln = math.hypot(*nl); nl = (0, nl[1] / ln, nl[2] / ln)
        dessus.quad(sommet(x0, yb, 0, nl, *uv(x0, yb)), sommet(x1, yb, 0, nl, *uv(x1, yb)), sommet(x1, yh, h, nl, *uv(x1, yh)), sommet(x0, yh, h, nl, *uv(x0, yh)))
        dessus.quad(sommet(x0, yh, h, (0, 0, 1), *uv(x0, yh)), sommet(x1, yh, h, (0, 0, 1), *uv(x1, yh)),
                    sommet(x1, yf, h, (0, 0, 1), *uv(x1, yf)), sommet(x0, yf, h, (0, 0, 1), *uv(x0, yf)))
        tole.quad(sommet(x0, yf, 0, (0, 1, 0)), sommet(x1, yf, 0, (0, 1, 0)), sommet(x1, yf, h, (0, 1, 0)), sommet(x0, yf, h, (0, 1, 0)))
        for x, s in ((x0, -1), (x1, 1)):
            tole.quad(sommet(x, yb, 0, (s, 0, 0)), sommet(x, yf, 0, (s, 0, 0)), sommet(x, yf, h, (s, 0, 0)), sommet(x, yh, h, (s, 0, 0)))
        groupes += [dessus, tole]

    # cibles : plastron aux coins arrondis derrière chaque cible (plaque imprimée à 38 mm, au-dessus de la bille),
    # sur deux montants chromés
    image_plaque(theme, os.path.join(d, 'plaque_cible.png'))
    pdessus = Groupe(0xffffff, rugosite=0.85, texture='plaque_cible.png')
    pflanc = Groupe(0xf0f4ff, rugosite=0.9, opacite=0.6)
    for c in t.cibles:
        nx, ny = c['nx'], c['ny']
        tx, ty = -ny, nx
        demi, prof = (16.0, 12.0) if c['genre'] == 'ronde' else (19.0, 14.0)
        cx, cy = c['x'] - nx * (prof + 4), c['y'] - ny * (prof + 4)        # derrière la face
        coins = [(cx + tx * a + nx * b, cy + ty * a + ny * b) for a, b in ((-demi, -prof), (demi, -prof), (demi, prof), (-demi, prof))]
        poly = arrondi(coins, 0.0, 7.0, pas=6)
        def uvl(x, y, cx=cx, cy=cy, tx=tx, ty=ty, nx=nx, ny=ny, demi=demi, prof=prof):
            return (0.5 + ((x - cx) * tx + (y - cy) * ty) / (2 * demi), 0.5 - ((x - cx) * nx + (y - cy) * ny) / (2 * prof))
        extrusion(pdessus, pflanc, poly, 38.0, 41.0, (0, 0, 1, 1), uv=uvl)
        for a in (-demi + 6, demi - 6):
            x, y = cx + tx * a - nx * (prof - 6), cy + ty * a - ny * (prof - 6)
            cylindre(chrome, x, y, 2.2, 0.0, 38.0, n=12, dessus=False)
            dome(chrome, x, y, 3.2, 41.0, 2.6, n=12)
    groupes += [pdessus, pflanc]

    # palettes : chapeau d'axe chromé (la palette VPX tourne dessous)
    for p in t.palettes:
        cylindre(chrome, p['x'], p['y'], 5.5, 27.0, 28.5, n=24)
        dome(chrome, p['x'], p['y'], 5.0, 28.5, 3.5)
    image_palette(theme, os.path.join(d, 'palette.png'))
    image_tourniquet(theme, os.path.join(d, 'tourniquet.png'))

    # rampes : tube chromé sur le haut de chaque flanc (la rampe VPX est du plexi transparent)
    for r in t.rampes:
        for cote in (1, -1):
            pts3 = []
            for k, sc in enumerate(r['sections']):
                P = [np.array(p, float) for p in sc['pts']]
                L = np.concatenate([[0], np.cumsum([np.linalg.norm(b - a) for a, b in zip(P, P[1:])])])
                for i, p in enumerate(P):
                    if k and i == 0:
                        continue
                    dv = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]; dv /= np.linalg.norm(dv) or 1
                    l = sc['l0'] + (sc['l1'] - sc['l0']) * L[i] / (L[-1] or 1)
                    z = sc['z0'] + (sc['z1'] - sc['z0']) * L[i] / (L[-1] or 1)
                    w = l / 2 + 1.5
                    pts3.append((p[0] - cote * dv[1] * w, p[1] + cote * dv[0] * w, z + r['flanc'] + 1.5))
            tube(chrome, pts3, 1.8)
        # tôle d'entrée (la bille monte dessus depuis le plateau)
        sc = r['sections'][0]; a, b = np.array(sc['pts'][0], float), np.array(sc['pts'][1], float)
        dv = (b - a) / np.linalg.norm(b - a); w = sc['l0'] / 2
        tole_e = Groupe(0xc8ccd2, metal=True, rugosite=0.35)
        nv = np.array((-dv[1], dv[0])) * w
        q = [a - nv - dv * 6, a + nv - dv * 6, a + nv + dv * 14, a - nv + dv * 14]
        tole_e.quad(*(sommet(p[0], p[1], 0.3, (0, 0, 1)) for p in q))
        groupes.append(tole_e)

    # coins du haut (CoinG, CoinD) : bloc peint (c2) avec baguette chromée sur l'arête côté plateau
    peint = Groupe(rgbi(theme['c2']) if theme['c2'].startswith('#') else 0x222222, rugosite=0.45)
    for m in t.murs:
        if m['nom'] in ('CoinG', 'CoinD'):
            P = [tuple(p) for p in m['pts']]
            P = [(min(max(x, 0.0), 514.0), min(max(y, 0.0), 1263.0)) for x, y in P]
            P = [p for i, p in enumerate(P) if math.dist(p, P[i - 1]) > 0.1]
            coin = min(P, key=lambda p: min(p[0], 514 - p[0]) + p[1])
            extrusion(peint, peint, P, 0.0, 60.0, (0, 0, 1, 1), uv=lambda x, y: (0, 0), centre=coin)
            arete = [(x, y, 60.0) for x, y in P if 0 < x < 514 and 0 < y]
            if len(arete) > 1:
                tube(chrome, arete, 2.0)

    liste = []
    for k, g in enumerate(gr for gr in groupes if gr.V):
        V = np.asarray(g.V, np.float32)
        I = np.asarray(g.I, np.uint32)
        nom = f'g{k:03d}.bin'
        with open(os.path.join(d, nom), 'wb') as f:
            f.write(V.astype('<f4').tobytes()); f.write(I.astype('<u4').tobytes())
        liste.append(dict(fichier=nom, sommets=len(V), triangles=len(I), **g.mat))
    json.dump({'groupes': liste, 'palette': 'palette.png', 'theme': theme}, open(os.path.join(d, 'decor.json'), 'w'),
              ensure_ascii=False, indent=1)
    return d
