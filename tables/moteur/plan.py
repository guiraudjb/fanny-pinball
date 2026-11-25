"""Plan d'une table vierge : géométrie en mm, plateau dessiné, inserts, fond de la vue bureau, en-tête du script.

Chaque table (tables/<dossier>/table.py) décrit son plateau avec la classe Table ; le cadre commun (bords, couloir et
lanceur, couloirs du bas, lance-pierres, palettes, évacuation) vient de cadre(). Table.ecrire() produit dans
<dossier>/sortie/ :
  table.json          géométrie lue par le générateur Rust (moteur/generateur)
  entete.vbs          noms des éléments, évènements, lampes, éjections, essais (inséré dans le script)
  images/plateau.jpg  plateau vierge (fond neutre, tracés, inserts éteints, étiquettes)
  images/inserts/*.png  inserts allumés (flashers F_<lampe>)
  images/fond.jpg     fond de la vue bureau (cadre du fronton avec le titre, règles)

Repère : x vers la droite, y vers le joueur, mm ; angles « vpinball » en degrés (0 = vers le haut, sens horaire).
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 514, 1263            # plateau (mêmes dimensions que Fanny Pinball : la vue bureau réglée sur la Batocera convient)
XD = 474                    # bord droit du plateau de jeu (paroi du couloir du lanceur)
CX = XD / 2                 # axe des palettes
BALL_R = 13.5
K = 2.5                     # pixels par mm du plateau dessiné
POLICE = next(p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                          '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] if os.path.exists(p))
POLICE_N = next(p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'] if os.path.exists(p))


def sym(x):
    """abscisse symétrique par rapport à l'axe des palettes"""
    return XD - x


def angle_vp(dx, dy):
    """angle vpinball (0 = vers le haut, sens horaire) d'une direction du plateau"""
    return math.degrees(math.atan2(dx, -dy))


def direction(angle):
    a = math.radians(angle)
    return math.sin(a), -math.cos(a)


def arc(cx, cy, r, a0, a1, pas=6.0):
    """points d'un arc (angles vpinball, de a0 à a1), un point tous les `pas` mm environ"""
    n = max(2, int(abs(math.radians(a1 - a0)) * r / pas) + 1)
    return [(cx + r * direction(a0 + (a1 - a0) * i / (n - 1))[0], cy + r * direction(a0 + (a1 - a0) * i / (n - 1))[1])
            for i in range(n)]


def cercle(x, y, r, n=16):
    return [(x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def epaissir(pts, ep, bouts_ronds=True):
    """polygone d'une ligne brisée épaissie (joints en onglet, bouts arrondis)"""
    pts = [np.array(p, float) for p in pts]
    n = len(pts)
    def nrm(a, b):
        d = b - a; d /= np.linalg.norm(d); return np.array([-d[1], d[0]])
    g, dr = [], []
    for i in range(n):
        if i == 0:
            m = nrm(pts[0], pts[1])
        elif i == n - 1:
            m = nrm(pts[-2], pts[-1])
        else:
            a, b = nrm(pts[i - 1], pts[i]), nrm(pts[i], pts[i + 1])
            m = a + b; m /= np.linalg.norm(m); m = m / max(0.3, float(np.dot(m, a)))
        g.append(pts[i] + m * ep / 2); dr.append(pts[i] - m * ep / 2)
    poly = list(g)
    if bouts_ronds:
        d = pts[-1] - pts[-2]; a0 = math.atan2(*(nrm(pts[-2], pts[-1])[::-1]))
        poly += [pts[-1] + ep / 2 * np.array([math.cos(a0 - math.pi * k / 6), math.sin(a0 - math.pi * k / 6)]) for k in range(1, 6)]
    poly += dr[::-1]
    if bouts_ronds:
        a0 = math.atan2(*(nrm(pts[1], pts[0])[::-1]))
        poly += [pts[0] + ep / 2 * np.array([math.cos(a0 - math.pi * k / 6), math.sin(a0 - math.pi * k / 6)]) for k in range(1, 6)]
    return [(round(float(p[0]), 2), round(float(p[1]), 2)) for p in poly]


def longueurs(pts):
    s = [0.0]
    for a, b in zip(pts, pts[1:]):
        s.append(s[-1] + math.dist(a, b))
    return s


def reechantillonner(pts, pas=12.0):
    s = longueurs(pts)
    n = max(2, int(s[-1] / pas) + 1)
    out = []
    for i in range(n):
        t = s[-1] * i / (n - 1)
        k = max(0, min(len(s) - 2, np.searchsorted(s, t) - 1))
        u = (t - s[k]) / max(1e-9, s[k + 1] - s[k])
        out.append((pts[k][0] + u * (pts[k + 1][0] - pts[k][0]), pts[k][1] + u * (pts[k + 1][1] - pts[k][1])))
    return out


def dans_polygone(x, y, poly):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            c = not c
    return c


def dist_polygone(x, y, poly):
    d = 1e9
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        vx, vy = x2 - x1, y2 - y1
        t = max(0, min(1, ((x - x1) * vx + (y - y1) * vy) / max(1e-9, vx * vx + vy * vy)))
        d = min(d, math.hypot(x - x1 - t * vx, y - y1 - t * vy))
    return d


class Table:
    def __init__(self, nom, titre, sous_titre, regles):
        self.nom, self.titre, self.sous_titre, self.regles = nom, titre, sous_titre, regles
        self.murs, self.lance_pierres, self.palettes, self.bumpers, self.cibles = [], [], [], [], []
        self.couloirs, self.trous, self.tourniquets, self.portes, self.rampes, self.lampes = [], [], [], [], [], []
        self.fils = []
        self.sous_rampes = []         # dessous fermé des montées de rampe (exclu du balayage)                # guides en fil d'acier (wireform, comme Fanny Pinball) : aspect seul
        self.etiquettes, self.fleches, self.essais_rampe = [], [], []
        self.lanceur = None
        self.drain = None
        self.vitesse_lanceur = 30.0
        # habillage (facultatif) : illustration du plateau, fond de la vue bureau, fronton, musiques, panneaux animés
        self.art_plateau = None       # image (proportions du plateau 514 × 1263) sous les inserts
        self.art_fond = None          # image du fond de la vue bureau (recadrée en 16:10)
        self.art_fronton = None       # illustration du fronton (1216 × 832) posée dans son cadre
        self.musiques = {}            # {'accueil': nom du son, 'jeu': nom du son} (sons de <table>/sons)
        self.panneaux = []            # GIF animés de la vue bureau (voir panneau())

    # ------------------------------------------------------------ éléments
    def mur(self, pts, haut=35, mat='Mur', nom=None, visible=True, collision=True, dessin='#3b4049'):
        nom = nom or f'Mur{len(self.murs):03d}'
        self.murs.append(dict(nom=nom, pts=[list(map(float, p)) for p in pts], haut=haut, mat=mat, visible=visible,
                              collision=collision, dessin=dessin))
        return nom

    def rail(self, pts, ep=8, haut=35, mat='Guide', dessin='#6d7480', **kw):
        """guide de bille en fil d'acier chromé, comme sur Fanny Pinball : deux tiges (Ø 4 mm au centre de la bille,
        Ø 3 mm à 23 mm), bouts coudés plantés dans le plateau, rondelles et montants environ tous les 130 mm.
        La bille rebondit sur un mur invisible de même tracé (épaisseur ep, hauteur haut)."""
        nom = self.mur(epaissir(pts, ep), haut, mat, dessin=dessin, visible=False, **kw)
        self.fils.append(dict(nom=nom, pts=[list(map(float, p)) for p in pts]))
        return nom

    def poteau(self, x, y, r=5, haut=35):
        return self.mur(cercle(x, y, r), haut, 'Caoutchouc', dessin='#22252a')

    def lance_pierre(self, nom, pts, a, c):
        self.lance_pierres.append(dict(nom=nom, pts=[list(p) for p in pts], a=list(a), c=list(c)))

    def palette(self, nom, x, y, cote, long=57.7, repos=31.0, levee=-20.0, r1=12.0, r2=6.5, axe=None):
        """cote G : pointe vers la droite ; D : vers la gauche. repos/levee : degrés sous l'horizontale ;
        axe : orientation forcée (angle vpinball au repos, puis course) pour les palettes du haut"""
        if axe is None:
            debut, fin = (90 + repos, 90 + levee) if cote == 'G' else (-90 - repos, -90 - levee)
        else:
            debut, fin = axe
        self.palettes.append(dict(nom=nom, x=x, y=y, cote=cote, long=long, r1=r1, r2=r2, debut=debut, fin=fin))

    def bumper(self, nom, x, y, r=27):
        self.bumpers.append(dict(nom=nom, x=x, y=y, r=r))

    @staticmethod
    def visee(x, y):
        """angle vpinball qui tourne une cible vers la palette qui la vise : tir croisé (cible à gauche → palette
        droite, à droite → palette gauche), droit devant au centre ; point visé = milieu de la palette levée"""
        if x < CX - 40:
            px = 296.0
        elif x > CX + 40:
            px = 178.0
        else:
            px = CX
        return angle_vp(px - x, 1075.0 - y)

    def devant(self, x, y, d):
        """point à d mm devant une cible tournée vers les palettes (place de sa lampe)"""
        nx, ny = direction(self.visee(x, y))
        return x + nx * d, y + ny * d

    def cible(self, nom, x, y, face='palettes', genre='debout'):
        """face : angle vpinball vers lequel la cible regarde (d'où vient la bille), ou 'palettes' (par défaut) :
        tournée vers la palette qui la vise (visee) ; genre debout, tombante, ronde"""
        if face == 'palettes':
            face = self.visee(x, y)
        nx, ny = direction(face)
        self.cibles.append(dict(nom=nom, x=x, y=y, nx=nx, ny=ny, genre=genre))

    def banque(self, prefixe, x0, y0, x1, y1, n, face='palettes', genre='tombante', noms=None):
        """n cibles réparties sur le segment (x0, y0)–(x1, y1) ; face 'palettes' : la banque entière est tournée
        autour de son centre pour faire face à la palette qui la vise (même angle pour toutes les cibles)"""
        noms = noms or [f'{prefixe}{i + 1}' for i in range(n)]
        if face == 'palettes':
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            face = self.visee(cx, cy)
            ux, uy = direction(face + 90)                     # ligne de la banque, perpendiculaire à la visée
            demi = math.hypot(x1 - x0, y1 - y0) / 2
            x0, y0, x1, y1 = cx - ux * demi, cy - uy * demi, cx + ux * demi, cy + uy * demi
        for i, nm in enumerate(noms):
            u = (i + 0.5) / n
            self.cible(nm, x0 + u * (x1 - x0), y0 + u * (y1 - y0), face, genre)
        return noms

    def couloir(self, nom, x, y, angle=0.0, forme='fil', dx=7.0, dy=14.0, surface='', haut=0.0):
        self.couloirs.append(dict(nom=nom, x=x, y=y, angle=angle, forme=forme, dx=dx, dy=dy, surface=surface, haut=haut))

    def trou(self, nom, x, y, ejection=(0.0, 10.0), r=20.0, genre='saucer', surface=''):
        """ejection : (angle vpinball, force) du coup qui rend la bille"""
        self.trous.append(dict(nom=nom, x=x, y=y, r=r, genre=genre, angle=ejection[0], force=ejection[1], surface=surface))

    def tourniquet(self, nom, x, y, sens, long=34.0):
        """sens : angle vpinball de la direction de passage de la bille"""
        self.tourniquets.append(dict(nom=nom, x=x, y=y, angle=sens, long=long))

    def porte(self, nom, p1, p2, double=False):
        """porte à sens unique de p1 à p2 : la bille passe en venant de la droite du segment p1→p2 (vue de p1)"""
        self.portes.append(dict(nom=nom, x1=p1[0], y1=p1[1], x2=p2[0], y2=p2[1], double=double))

    def panneau(self, nom, gif, x, y, z, larg, haut):
        """GIF animé joué par le script sur un flasher tourné vers la caméra (vue bureau) ; position en mm du repère
        du plateau (hors plateau possible), z = hauteur, larg × haut dans le plan du panneau"""
        self.panneaux.append(dict(nom=nom, gif=gif, x=x, y=y, z=z, larg=larg, haut=haut))

    def lampe(self, nom, x, y, r=10.0, couleur='#ffcc33', texte=''):
        self.lampes.append(dict(nom=nom, x=x, y=y, r=r, couleur=couleur, texte=texte))

    def etiquette(self, x, y, texte, taille=11, angle=0.0, couleur='#2a2f38'):
        self.etiquettes.append(dict(x=x, y=y, texte=texte, taille=taille, angle=angle, couleur=couleur))

    def fleche(self, nom, x, y, angle, couleur='#ffffff', long=30.0, larg=18.0, texte=''):
        """insert en flèche (lampe) pointant dans la direction `angle`"""
        self.lampe(nom, x, y, r=max(long, larg) / 2, couleur=couleur, texte=texte)
        self.lampes[-1]['fleche'] = dict(angle=angle, long=long, larg=larg)

    def rampe(self, nom, pts, profil, largeur=42.0, flanc=28.0, entree=58.0, capteurs=(), jupe=40.0):
        """Rampe le long de la ligne brisée `pts` (mm). profil : [(s, z)] (s en mm depuis l'entrée, ou fraction ≤ 1
        de la longueur, z en mm) ; une section VPX par pente. Sous la montée, des jupes ferment le dessous tant que
        le sol est à moins de `jupe` mm (la bille s'y coinçait). capteurs : [(nom, s)] contacts posés sur la rampe."""
        ch = reechantillonner(pts, 10.0)
        s = longueurs(ch)
        L = s[-1]
        prof = [((p if p > 1 else p * L), z) for p, z in profil]
        z_de = lambda t: float(np.interp(t, [p for p, _ in prof], [z for _, z in prof]))
        sections = []
        for k, ((s0, z0), (s1, z1)) in enumerate(zip(prof, prof[1:])):
            idx = [i for i, t in enumerate(s) if s0 - 1e-6 <= t <= s1 + 1e-6]
            pp = [ch[i] for i in idx]
            if math.dist(pp[0], ch[np.searchsorted(s, s0)] if s0 > 0 else ch[0]) > 0.1:
                pass
            l0 = entree if k == 0 else largeur
            sections.append(dict(nom=f'{nom}{k + 1}', pts=[[round(x, 2), round(y, 2)] for x, y in pp], z0=z0, z1=z1,
                                 l0=l0, l1=largeur))
        # les sections se touchent : la suivante reprend le dernier point de la précédente
        for a, b in zip(sections, sections[1:]):
            if a['pts'][-1] != b['pts'][0]:
                b['pts'].insert(0, a['pts'][-1])
        self.rampes.append(dict(nom=nom, sections=sections, flanc=flanc, largeur=largeur, chemin=[list(p) for p in ch]))
        # jupes : flancs pleins sous la montée, puis un fond
        s_j = next((t for t in np.arange(0, L, 2.0) if z_de(t) >= jupe), None)
        if s_j and z_de(0) < 1:
            n = int(np.searchsorted(s, s_j))          # points avant s_j (le « + 1 » repartait en arrière : jupes repliées, fond retourné)
            bout = ch[:n] + [tuple(np.interp(s_j, s, np.array(ch)[:, i]) for i in (0, 1))]
            for cote in (1, -1):
                off = []
                for i, p in enumerate(bout):
                    a, b = bout[max(0, i - 1)], bout[min(len(bout) - 1, i + 1)]
                    d = np.array(b) - np.array(a); d /= np.linalg.norm(d)
                    w = (entree if i == 0 else largeur) / 2 + 4
                    off.append((p[0] - cote * d[1] * w, p[1] + cote * d[0] * w))
                self.mur(epaissir(off, 6, False), jupe, 'Rampe', nom=f'Jupe{nom}{"GD"[cote < 0]}', dessin='#8a919c')
            # fond en pointe (vers l'arrière de la rampe) : une bille passée sous la partie haute, qui redescend
            # entre les jupes, est renvoyée sur le côté au lieu de s'arrêter contre un fond plat (blocage au balayage)
            p = bout[-1]; d = np.array(bout[-1]) - np.array(bout[-2]); d /= np.linalg.norm(d)
            w = largeur / 2 + 4
            pointe = (p[0] + d[0] * w * 1.2, p[1] + d[1] * w * 1.2)
            self.mur(epaissir([(p[0] - d[1] * w, p[1] + d[0] * w), pointe, (p[0] + d[1] * w, p[1] - d[0] * w)], 6, False),
                     jupe - 4, 'Rampe', nom=f'Fond{nom}', dessin='#8a919c')
            self.sous_rampes.append(epaissir(bout + [pointe], largeur + 8, False))   # hors du balayage (inaccessible)
        for cn, sc in capteurs:
            t = sc if sc > 1 else sc * L
            x, y = (float(np.interp(t, s, np.array(ch)[:, i])) for i in (0, 1))
            sec = next(sct for sct, (a, b) in zip(sections, zip(prof, prof[1:])) if a[0] - 1e-6 <= t <= b[0] + 1e-6)
            k0 = max(0, int(np.searchsorted(s, t)) - 1)
            ang = angle_vp(ch[k0 + 1][0] - ch[k0][0], ch[k0 + 1][1] - ch[k0][1])
            self.couloir(cn, x, y, angle=ang, forme='invisible', dx=largeur / 2 - 4, dy=10, surface=sec['nom'], haut=50)
        # essais de tir : bille lancée dans l'axe de l'entrée, à trois vitesses
        d = np.array(ch[3]) - np.array(ch[0]); d /= np.linalg.norm(d)
        x0, y0 = np.array(ch[0]) - d * 70
        for v in (22, 30, 40):
            self.essais_rampe.append([f'{nom} v{v}', round(float(x0), 1), round(float(y0), 1), round(float(d[0]), 3),
                                      round(float(d[1]), 3), v, capteurs[0][0] if capteurs else ''])

    # ------------------------------------------------------------ sortie
    def ecrire(self, dossier):
        sortie = os.path.join(dossier, 'sortie')
        os.makedirs(os.path.join(sortie, 'images', 'inserts'), exist_ok=True)
        d = dict(nom=self.nom, titre=self.titre, sous_titre=self.sous_titre, W=W, H=H, pente_deg=6.5, BALL_R=BALL_R,
                 murs=self.murs, lance_pierres=self.lance_pierres, palettes=self.palettes, bumpers=self.bumpers,
                 fils=self.fils, cibles=self.cibles, couloirs=self.couloirs, trous=self.trous, tourniquets=self.tourniquets,
                 portes=self.portes, rampes=self.rampes, lampes=self.lampes, lanceur=self.lanceur, drain=self.drain,
                 blurb=getattr(self, 'blurb', None), bas_fanny=getattr(self, 'bas_fanny', False), couleur_elastique=(getattr(self, 'deco', None) or {}).get('elastique', '#c01c28'), musiques=list(self.musiques.values()), panneaux=self.preparer_panneaux(os.path.join(sortie, 'images')))
        json.dump(d, open(os.path.join(sortie, 'table.json'), 'w'), ensure_ascii=False, indent=1)
        import decor
        decor.construire(self, sortie)               # finition : chapeaux de bumpers, plastrons, chapeaux d'axe
        open(os.path.join(sortie, 'entete.vbs'), 'w').write(self.entete())
        self.dessiner(os.path.join(sortie, 'images'))
        print(f'{self.nom} : {len(self.murs)} murs, {len(self.cibles)} cibles, {len(self.rampes)} rampes, '
              f'{len(self.lampes)} lampes → {sortie}')

    def preparer_panneaux(self, dossier):
        """vues des GIF en JPEG (images/gif/<nom>_NN.jpg) ; durée d'une vue en ms"""
        out = []
        for p in self.panneaux:
            gif = Image.open(p['gif'])
            os.makedirs(os.path.join(dossier, 'gif'), exist_ok=True)
            vues = []
            for k in range(getattr(gif, 'n_frames', 1)):
                gif.seek(k)
                f = os.path.join(dossier, 'gif', f"{p['nom']}_{k:02d}.jpg")
                gif.convert('RGB').save(f, quality=88)
                vues.append(f)
            ms = max(20, gif.info.get('duration', 83))
            out.append(dict(p, gif=None, vues=vues, ms=ms))
        self._panneaux = out
        return out

    def points_essai(self):
        """grille de 20 mm des points libres du plateau (balayage des zones de blocage), en unités VP"""
        pts = []
        obst = [m['pts'] for m in self.murs if m['collision']] + [s['pts'] for s in self.lance_pierres]
        ronds = [(b['x'], b['y'], b['r'] + 16) for b in self.bumpers] + [(c['x'], c['y'], 22) for c in self.cibles] + \
                [(t['x'], t['y'], t['r'] + 16) for t in self.trous] + [(p['x'], p['y'], p['long'] + 14) for p in self.palettes]
        for y in np.arange(30, 1130, 20.0):
            for x in np.arange(16, XD - 10, 20.0):
                if any(math.hypot(x - a, y - b) < r for a, b, r in ronds):
                    continue
                if any(dans_polygone(x, y, p) or dist_polygone(x, y, p) < BALL_R + 2 for p in obst):
                    continue
                if any(dans_polygone(x, y, p) for p in self.sous_rampes):
                    continue
                if not self.dans_jeu(x, y):
                    continue
                pts.append((round(x / 0.54, 1), round(y / 0.54, 1), 25))
        return pts

    def dans_jeu(self, x, y):
        """dans le contour du plateau (coins du haut arrondis)"""
        if getattr(self, 'arche', None):          # planche de Fanny : haut en demi-ellipse
            cx, cy, rx, ry = self.arche
            if x < BALL_R or x > XD - BALL_R or y < BALL_R:
                return False
            return y >= cy or ((x - cx) / (rx - BALL_R)) ** 2 + ((y - cy) / (ry - BALL_R)) ** 2 <= 1
        if x < BALL_R or x > XD - BALL_R or y < BALL_R:
            return False
        if y < RG and math.hypot(x - RG, y - RG) > RG - BALL_R and x < RG:
            return False
        if y < RD and x > W - RD and math.hypot(x - (W - RD), y - RD) > RD - BALL_R:
            return False
        return True

    def entete(self):
        L = ["' ---- généré par tables/moteur/plan.py (ne pas modifier : refaire avec table.py)"]
        L.append(f'Const TITRE = "{self.titre.upper()}"')
        L.append(f'Const CLE_TABLE = "{self.nom}"')
        L.append(f'Const LANCEUR_X = {self.lanceur["x"]}, LANCEUR_Y = {self.lanceur["y"]}, LANCEUR_V = {self.vitesse_lanceur}')
        noms = [l['nom'] for l in self.lampes]
        L.append(f'Const MUSIQUE_ACCUEIL = "{self.musiques.get("accueil", "")}", MUSIQUE_JEU = "{self.musiques.get("jeu", "")}"')
        gifs = ', '.join(f'Array(Gif{p["nom"]}, "{p["nom"]}_", {len(p["vues"])}, {p["ms"]})' for p in getattr(self, '_panneaux', []))
        L.append(f'Dim GIFS : GIFS = Array({gifs})')
        L.append(f'Const NB_LAMPES = {len(noms)}')
        if noms:
            L.append('Const ' + ', '.join(f'LP_{n} = {i}' for i, n in enumerate(noms)))
        L.append('Dim NOMS_LAMPES : NOMS_LAMPES = Array(' + ', '.join(f'"{n}"' for n in noms) + ')')
        L.append('Dim PALETTES_G : PALETTES_G = Array(' + ', '.join(p['nom'] for p in self.palettes if p['cote'] == 'G') + ')')
        L.append('Dim PALETTES_D : PALETTES_D = Array(' + ', '.join(p['nom'] for p in self.palettes if p['cote'] == 'D') + ')')
        L.append('Dim BUMPERS : BUMPERS = Array(' + ', '.join(b['nom'] for b in self.bumpers) + ')')
        L.append('Dim LANCE_PIERRES : LANCE_PIERRES = Array(' + ', '.join(s['nom'] for s in self.lance_pierres) + ')')
        L.append('Dim TOMBANTES : TOMBANTES = Array(' + ', '.join(c['nom'] for c in self.cibles if c['genre'] == 'tombante') + ')')
        L.append('Dim TROUS : TROUS = Array(' + ', '.join(f'"{t["nom"]}"' for t in self.trous) + ')')
        # évènements : tous passent par Ev (anti-rebond, sauvetage de bille, essais) puis Regle(nom) des règles
        k = 0
        for b in self.bumpers:
            L.append(f'Sub {b["nom"]}_Hit() : Ev {k}, "{b["nom"]}" : End Sub'); k += 1
        for s in self.lance_pierres:
            L.append(f'Sub {s["nom"]}_Slingshot() : Ev {k}, "{s["nom"]}" : End Sub'); k += 1
        for c in self.cibles:
            L.append(f'Sub {c["nom"]}_Hit() : Ev {k}, "{c["nom"]}" : End Sub'); k += 1
        for c in self.couloirs:
            L.append(f'Sub {c["nom"]}_Hit() : Ev {k}, "{c["nom"]}" : End Sub'); k += 1
        for t in self.trous:
            L.append(f'Sub {t["nom"]}_Hit() : Ev {k}, "{t["nom"]}" : End Sub'); k += 1
            L.append(f'Sub Ejecter_{t["nom"]}() : {t["nom"]}.Kick {t["angle"]}, {t["force"]} : Son "ejection" : End Sub')
        for t in self.tourniquets:
            L.append(f'Sub {t["nom"]}_Spin() : EvTour "{t["nom"]}" : End Sub')
        L.append(f'Const NB_EV = {k + 1}')
        pts = self.points_essai()
        flat = [v for p in pts for v in p]
        lignes = [', '.join(f'{v}' for v in flat[i:i + 24]) for i in range(0, len(flat), 24)]
        L.append('Dim POINTS_ESSAI : POINTS_ESSAI = Array(' + ', _\n  '.join(lignes) + ')')
        er = ', '.join(f'Array("{e[0]}", {e[1]}, {e[2]}, {e[3]}, {e[4]}, {e[5]}, "{e[6]}")' for e in self.essais_rampe)
        L.append(f'Dim ESSAIS_RAMPE : ESSAIS_RAMPE = Array({er})')
        return '\n'.join(L) + '\n'

    # ------------------------------------------------------------ dessin du plateau vierge
    def dessiner(self, dossier):
        P = lambda pts: [(x * K, y * K) for x, y in pts]
        if self.art_plateau:
            im = Image.open(self.art_plateau).convert('RGB').resize((int(W * K), int(H * K)), Image.LANCZOS)
            dr = ImageDraw.Draw(im, 'RGBA')
        else:
            im = Image.new('RGB', (int(W * K), int(H * K)), '#d9dde3')
            dr = ImageDraw.Draw(im, 'RGBA')
            for g in range(0, max(W, H), 50):                  # quadrillage discret (repère pour l'habillage)
                dr.line([(g * K, 0), (g * K, H * K)], fill=(190, 196, 205, 255), width=1)
                dr.line([(0, g * K), (W * K, g * K)], fill=(190, 196, 205, 255), width=1)
            dr.line([(CX * K, 0), (CX * K, H * K)], fill=(170, 178, 190, 255), width=2)
        # zone hors jeu (bords, couloir du lanceur)
        for r in self.rampes:                                  # emprise des rampes (ombre)
            dr.polygon(P(epaissir(r['chemin'], r['largeur'] + 6, False)), fill=(120, 130, 150, 70))
        for m in self.murs:
            if m['visible']:
                dr.polygon(P(m['pts']), fill=m['dessin'])
        for f in self.fils:                                    # ombre portée des guides en fil d'acier
            dr.line(P([(x + 2.5, y + 3) for x, y in f['pts']]), fill=(0, 0, 0, 90), width=int(5 * K), joint='curve')
        for s in self.lance_pierres:
            dr.polygon(P(s['pts']), fill='#4a505a', outline='#1b1d21', width=3)
        for b in self.bumpers:
            dr.ellipse([(b['x'] - b['r'] - 4) * K, (b['y'] - b['r'] - 4) * K, (b['x'] + b['r'] + 4) * K, (b['y'] + b['r'] + 4) * K],
                       fill=(70, 76, 88, 255))
        for t in self.trous:
            if t['genre'] != 'kickback':
                dr.ellipse([(t['x'] - t['r'] - 6) * K, (t['y'] - t['r'] - 6) * K, (t['x'] + t['r'] + 6) * K, (t['y'] + t['r'] + 6) * K],
                           fill=(40, 44, 52, 255))
        for c in self.couloirs:
            if c['forme'] in ('fil', 'etoile', 'bouton') and not c['surface']:
                dr.ellipse([(c['x'] - 13) * K, (c['y'] - 22) * K, (c['x'] + 13) * K, (c['y'] + 22) * K], outline=(90, 98, 112, 255), width=3)
        # inserts éteints : pastille sombre de la couleur, lettre
        for l in self.lampes:
            col = np.array(rgb(l['couleur']))
            sombre = tuple(int(v) for v in col * 0.35 + 25) + (255,)
            forme = insert_forme(l, K)
            dr.polygon([(x + l['x'] * K, y + l['y'] * K) for x, y in forme], fill=sombre, outline=(20, 20, 24, 255))
            if l['texte']:
                ecrire(im, l['x'] * K, l['y'] * K, l['texte'], int(l['r'] * K * (0.9 if len(l['texte']) > 1 else 1.15)),
                       (235, 235, 235, 255), 0)
            Image_insert(l).save(os.path.join(dossier, 'inserts', l['nom'] + '.png'))
        for e in self.etiquettes:
            ecrire(im, e['x'] * K, e['y'] * K, e['texte'], int(e['taille'] * K), e['couleur'], e['angle'], police=POLICE)
        ecrire(im, CX * K, 1200 * K, self.titre.upper(), int(18 * K), (200, 206, 218, 255), 0)
        ecrire(im, CX * K, 1228 * K, ('' if self.art_plateau else 'TABLE VIERGE · ') + self.sous_titre, int(8 * K), (150, 158, 172, 255), 0, police=POLICE_N)
        im.save(os.path.join(dossier, 'plateau.jpg'), quality=92)
        self.dessiner_fond(os.path.join(dossier, 'fond.jpg'))

    def dessiner_fond(self, chemin):
        """fond de la vue bureau 1680 × 1050 : cadre du fronton (titre) en haut à droite, règles dessous"""
        lw, lh = 1680, 1050
        if getattr(self, 'ecran_fanny', False):        # tables universelles : disposition de l'écran de Fanny
            import ecran_fanny
            return ecran_fanny.dessiner(self, chemin, self.art_fronton)
        if self.art_fond:
            a = Image.open(self.art_fond).convert('RGB')
            k = max(lw / a.width, lh / a.height)
            a = a.resize((round(a.width * k), round(a.height * k)), Image.LANCZOS)
            im = a.crop(((a.width - lw) // 2, (a.height - lh) // 2, (a.width - lw) // 2 + lw, (a.height - lh) // 2 + lh))
            voile = Image.new('RGB', (lw, lh), (0, 0, 0))     # assombri : le plateau et le fronton ressortent
            im = Image.blend(im, voile, 0.35)
        else:
            y = np.linspace(0, 1, lh)[:, None, None]
            a = np.broadcast_to((np.array([38, 42, 52]) * (1 - 0.55 * y)), (lh, lw, 3)).astype(np.uint8)
            im = Image.fromarray(a.copy())
        dr = ImageDraw.Draw(im)
        x0, y0, w = 0.64 * lw, 0.04 * lh, 0.34 * lw
        h = w * 832 / 1216
        dr.rounded_rectangle((x0 - 6, y0 - 6, x0 + w + 6, y0 + h + 6), radius=18, fill=(58, 64, 78), outline=(150, 158, 175), width=4)
        if self.art_fronton:
            fr = Image.open(self.art_fronton).convert('RGB').resize((round(w), round(h)), Image.LANCZOS)
            im.paste(fr, (round(x0), round(y0)))
            yy = 0.64 * lh
            ft = ImageFont.truetype(POLICE_N, 19)
            lignes = []                                       # règles coupées à la largeur du cadre
            for r in self.regles:
                mots, l = r.split(), '•'
                for m in mots:
                    if ft.getlength(l + ' ' + m) > w - 8:
                        lignes.append(l); l = '   ' + m
                    else:
                        l += ' ' + m
                lignes.append(l)
            dr.rectangle((x0 - 6, yy - 10, x0 + w + 6, yy + 25 * len(lignes) + 4), fill=(0, 0, 0))
            for l in lignes:
                dr.text((x0, yy), l, font=ft, fill=(225, 228, 235))
                yy += 25
            im.save(chemin, quality=92)
            return
        mots = self.titre.upper().split()
        lignes = [' '.join(mots[:len(mots) // 2 or 1]), ' '.join(mots[len(mots) // 2 or 1:])] if len(self.titre) > 14 else [self.titre.upper()]
        for i, t in enumerate(l for l in lignes if l):
            ecrire(im, x0 + w / 2, y0 + h * (0.36 + 0.22 * i - 0.11 * (len(lignes) - 1)), t, 64, (235, 238, 244), 0)
        ecrire(im, x0 + w / 2, y0 + h * 0.86, 'TABLE VIERGE · ' + self.sous_titre.upper(), 22, (170, 178, 195), 0, police=POLICE_N)
        # règles sous l'afficheur
        yy = 0.64 * lh
        ft = ImageFont.truetype(POLICE_N, 21)
        for r in self.regles:
            dr.text((x0, yy), '• ' + r, font=ft, fill=(200, 206, 218))
            yy += 30
        im.save(chemin, quality=92)


RG, RD = 150.0, 120.0          # rayons des coins du haut (gauche, droite)


def rgb(h):
    n = int(h[1:], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]


def ecrire(im, x, y, texte, taille, couleur, angle, police=POLICE):
    """texte centré en (x, y) ; angle en degrés (sens trigonométrique de PIL)"""
    ft = ImageFont.truetype(police, max(6, int(taille)))
    if not angle:
        ImageDraw.Draw(im, 'RGBA').text((x, y), texte, font=ft, fill=couleur, anchor='mm')
        return
    w = int(ft.getlength(texte)) + 8
    calque = Image.new('RGBA', (w, int(taille * 1.4)), (0, 0, 0, 0))
    ImageDraw.Draw(calque).text((w / 2, taille * 0.7), texte, font=ft, fill=couleur, anchor='mm')
    r = calque.rotate(angle, resample=Image.BICUBIC, expand=True)
    im.paste(r, (int(x - r.width / 2), int(y - r.height / 2)), r)


def insert_forme(l, k):
    """contour de l'insert (pixels, centré) : disque, ou flèche"""
    if 'fleche' in l:
        f = l['fleche']
        lo, la = f['long'] * k, f['larg'] * k
        pts = [(0, -lo / 2), (la / 2, lo / 6), (la / 4, lo / 6), (la / 4, lo / 2), (-la / 4, lo / 2), (-la / 4, lo / 6), (-la / 2, lo / 6)]
        a = math.radians(f['angle'])
        return [(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)) for x, y in pts]
    r = l['r'] * k
    return [(r * math.cos(2 * math.pi * i / 40), r * math.sin(2 * math.pi * i / 40)) for i in range(40)]


HALO = 1.35


def Image_insert(l, ss=4):
    """insert allumé (RGBA) : plastique éclairé de la couleur, halo, lettre ; côté 2·HALO·r (comme le flasher)"""
    r = l['r'] * K * ss
    n = int(math.ceil(2 * HALO * r)) + 4
    c = n / 2
    col = np.array(rgb(l['couleur']), float)
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    d = np.hypot(xx - c, yy - c)
    halo = np.clip(1 - (d - r * 0.9) / ((HALO - 0.9) * r), 0, 1) ** 2
    a = np.zeros((n, n, 4))
    a[..., :3] = np.clip(col + 40, 0, 255)
    a[..., 3] = halo * 0.75 * 255
    im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    forme = [(x * ss + c, y * ss + c) for x, y in insert_forme(l, K)]
    masque = Image.new('L', (n, n), 0)
    ImageDraw.Draw(masque).polygon(forme, fill=255)
    t = np.clip(d / r, 0, 1)[..., None]
    c0, c1 = np.clip(col * 0.25 + 200, 0, 255), np.clip(col + 50, 0, 255)
    grad = (c0 + (c1 - c0) * t).astype(np.uint8)
    plast = Image.fromarray(np.dstack([grad, np.full((n, n), 255, np.uint8)]), 'RGBA')
    im.paste(plast, (0, 0), masque)
    dr = ImageDraw.Draw(im)
    dr.polygon(forme, outline=(20, 16, 12, 200), width=max(1, int(r * 0.08)))
    if l['texte']:
        ft = ImageFont.truetype(POLICE, int(r * (0.9 if len(l['texte']) > 1 else 1.15)))
        dr.text((c, c + r * 0.04), l['texte'], font=ft, fill=(22, 15, 10, 255), anchor='mm')
    return im.resize((n // ss, n // ss), Image.LANCZOS)


# ---------------------------------------------------------------- cadre commun
def cadre(t, kickback=False, sortie_droite=True):
    """Bords, coins du haut, couloir du lanceur et son portillon, couloirs du bas (sortie et retour), lance-pierres,
    palettes, évacuation, tablier. Les couloirs du bas : contacts SortieG/D, RetourG/D."""
    ep = 40
    t.mur([(-ep, RG), (0, RG), (0, H + ep), (-ep, H + ep)], 60, nom='BordG', dessin='#2b2f36')
    t.mur([(W, RD), (W + ep, RD), (W + ep, H + ep), (W, H + ep)], 60, nom='BordD', dessin='#2b2f36')
    t.mur([(-ep, H), (W + ep, H), (W + ep, H + ep), (-ep, H + ep)], 60, nom='BordBas', dessin='#2b2f36')
    t.mur([(RG, -ep), (W - RD, -ep), (W - RD, 0), (RG, 0)], 60, nom='BordHaut', dessin='#2b2f36')
    a = arc(RG, RG, RG, -90, 0, 5); b = arc(RG, RG, RG + ep, 0, -90, 5)
    t.mur(a + b, 60, nom='CoinG', dessin='#2b2f36')
    a = arc(W - RD, RD, RD, 0, 90, 5); b = arc(W - RD, RD, RD + ep, 90, 0, 5)
    t.mur(a + b, 60, nom='CoinD', dessin='#2b2f36')
    # couloir du lanceur : paroi de séparation et portillon (la bille sort par le haut, ne redescend pas)
    t.mur(epaissir([(XD + 4, 244), (XD + 4, H + 5)], 8), 40, 'Guide', nom='ParoiLanceur', dessin='#6d7480')
    t.porte('Portillon', (XD + 4, 240), (W, 218))
    t.lanceur = dict(x=498.0, y=1181.5)
    # couloirs du bas, côté gauche puis symétrique
    for cote in 'GD':
        X = (lambda x: x) if cote == 'G' else sym
        t.rail([(X(40), 840), (X(40), 985), (X(139), 1063)], 8, 40)
        t.lance_pierre(f'Lance{cote}', [(X(90), 870), (X(130), 1007), (X(90), 976)], (X(90), 870), (X(130), 1007))
        t.couloir(f'Sortie{cote}', X(19), 935)
        t.couloir(f'Retour{cote}', X(67), 930)
        t.palette('LeftFlipper' if cote == 'G' else 'RightFlipper', X(149.7), 1085, cote)
    # déviateurs : une bille qui descend le long d'un bord (orbite, tir du lanceur trop fort) part vers le retour
    # au lieu de tomber droit dans la sortie
    t.rail([(-4, 680), (48, 738)], 8, 40, nom='DeviateurG')
    t.rail([(XD + 4, 680), (sym(48), 738)], 8, 40, nom='DeviateurD')
    if kickback:
        t.trou('Kickback', 19, 1000, ejection=(0, 40), r=16, genre='kickback')
        t.lampe('kickback', 19, 1050, 9, '#ff5533', 'KB')
    # tablier (décor, sans collision) et évacuation
    t.mur([(30, 1150), (444, 1150), (444, H), (30, H)], 2, 'Tablier', nom='Tablier', collision=False, dessin='#2f343c')
    t.drain = [[0, 1150], [XD, 1150], [XD, H], [0, H]]


# ---------------------------------------------------------------- planche et bas de table de Fanny, à l'identique
FANNY_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'outils', 'vpx', 'donnees', 'table.json')


def cadre_fanny(t):
    """Base universelle : contour de la planche de Fanny (arche du haut, bords), paroi et portillon du lanceur, et tout
    le bas de table tel quel (outils/vpx/donnees/table.json, plan 2D du jeu d'origine) : couloirs du bas (sortie,
    retour extérieur, retour intérieur de chaque côté), guides en fil, séparateurs et poteaux, lance-pierres, palettes,
    pentes du tablier, évacuation. Aucun insert lumineux : les emplacements restent libres.
    Le module doit avoir XD = 478 (paroi du lanceur de Fanny) : voir t0_universelle/table.py."""
    import json
    F = json.load(open(FANNY_JSON))
    murs = F['murs']
    bb = lambda m: (min(p[0] for p in m['pts']), max(p[0] for p in m['pts']), min(p[1] for p in m['pts']), max(p[1] for p in m['pts']))
    k = 0
    for m in murs:
        x0, x1, y0, y1 = bb(m)
        pts = [tuple(p) for p in m['pts']]
        if m['genre'] == 'mur' and not m['visible'] and len(pts) == 4 and y1 <= 206:
            t.mur(pts, 60, nom=f'Arche{k:02d}', dessin='#2b2f36'); k += 1                       # arche du haut
        elif m['genre'] == 'mur' and (x1 <= 0.5 or x0 >= 513.5) and y1 > 1200:
            t.mur(pts, 60, nom='BordG' if x1 <= 0.5 else 'BordD', dessin='#2b2f36')            # bords
        elif m['genre'] == 'mur' and m['visible'] and x0 >= 477 and y1 > 1200:
            t.mur(pts, 32, 'Guide', nom='ParoiLanceur', dessin='#6d7480')
        elif m['genre'] == 'mur' and m['visible'] and x0 >= 477 and y0 >= 249 and y1 <= 255:
            t.mur(pts, 32, 'Guide', nom='TeteParoiLanceur', dessin='#6d7480')
        elif m['genre'] == 'plunger':
            t.mur(pts, 32, 'Guide', nom='BlocLanceur', dessin='#6d7480')
        elif m['genre'] == 'apron':
            t.mur(pts, 32, nom=f'PenteTablier{"GD"[x0 > 239]}', visible=False, dessin='#2f343c')
        elif m['genre'] == 'mur' and m['visible'] and y0 >= 860:
            rond = len(pts) == 10
            t.mur(pts, 32, 'Caoutchouc' if rond else 'Guide', nom=f'Bas{k:02d}', visible=False,
                  dessin='#22252a' if rond else '#6d7480'); k += 1
    t.mur([(-40, H), (W + 40, H), (W + 40, H + 40), (-40, H + 40)], 60, nom='BordBas', dessin='#2b2f36')
    # rendu des guides, poteaux, contacts, lance-pierres et tablier : pièces 3D de Fanny (moteur/bas_fanny) ;
    # les murs ci-dessus ne font que la collision
    # lance-pierres et palettes de Fanny
    for s_, cote in zip(F['lance_pierres'], 'GD'):
        t.lance_pierre(f'Lance{cote}', [tuple(p) for p in s_['pts']], tuple(s_['A']), tuple(s_['C']))
    for p in F['palettes']:
        cote = 'G' if p['side'] == 'L' else 'D'
        t.palette('LeftFlipper' if cote == 'G' else 'RightFlipper', p['px'], p['py'], cote, long=p['len'],
                  repos=math.degrees(abs(p['rest'])), levee=-math.degrees(abs(p['up'])), r1=p['r1'], r2=p['r2'])
    # couloirs du bas : sortie, retour extérieur, retour intérieur
    noms = {'outL': 'SortieG', 'inExtL': 'RetourExtG', 'inIntL': 'RetourIntG',
            'inIntR': 'RetourIntD', 'inExtR': 'RetourExtD', 'outR': 'SortieD'}
    for c in F['couloirs_bas']:
        t.couloir(noms[c['id']], c['x'], c['y'], forme='invisible')   # fils de contact : ceux de Fanny (bas_fanny)
    # lanceur, portillon, tablier, évacuation
    L, P = F['lanceur'], F['portillon']
    t.lanceur = dict(x=float(L['x']), y=float(L['ballY']))
    t.porte('Portillon', (P['x1'], P['y']), (P['x2'], P['y'] - P['drop']))
    t.mur([(30, 1150), (444, 1150), (444, H), (30, H)], 2, 'Tablier', nom='Tablier', collision=False, dessin='#2f343c')
    t.drain = [[0, F['tablier']['front']], [XD, F['tablier']['front']], [XD, H], [0, H]]
    t.arche = (W / 2, 205.0, W / 2, 193.0)
    t.bas_fanny = True                         # rendu : pièces 3D du bas de Fanny (moteur/bas_fanny)
    # arche : murs cachés dans le châssis, bord du plateau souligné par un guide en fil le long de l'arc
    t.fils.append(dict(nom='FilArche', pts=[[W / 2 - (W / 2 - 3) * math.cos(math.radians(a)), 205.0 - 190.0 * math.sin(math.radians(a))]
                                            for a in range(8, 173, 6)]))
