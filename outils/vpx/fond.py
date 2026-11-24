#!/usr/bin/env python3
"""Fond de la vue bureau de la table VPX (écran 1680 x 1050) : clin d'œil au jeu Arducible « Fanny Pétanque World Tour ».

  - la carte des escales du World Tour (pays en aplats ocre, itinéraire en pointillés entre les escales de la rampe), assombrie ;
  - à gauche : le titre FANNY PÉTANQUE WORLD TOUR, le flipper complet (habillage robe à pois) qui tourne sur lui-même
    (vues rendues par tourniquet.mjs, --tourniquet) et le médaillon de Fanny ;
  - sous l'afficheur : deux cadres où le script de la table fait défiler deux GIF animés tirés des vidéos du projet,
    le châssis du jeu en action et l'articulation de la boule, puis la signature #arducible, the DIY pétanque game.

Le fronton et l'afficheur sont posés par le générateur (FRONTON_BUREAU) ; les GIF sont joués par deux flashers placés
dans la scène devant les cadres (PANNEAUX dans generateur/src/main.rs, rectangles CADRES ci-dessous).

Sources : dépôt du jeu Arducible (vidéos, carte, médaillon, boule dorée, police Alfa Slab One).
Sorties (versées au dépôt, le générateur n'a pas besoin des sources) : outils/vpx/donnees/fond/
  fond.jpg  chassis.gif  articulation.gif  tourniquet.gif

  python3 outils/vpx/fond.py [--source ~/Projets/story/Arducible_Fanny_Petanque_World_Tour]
"""
import argparse, json, os, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--source', default=os.path.expanduser('~/Projets/story/Arducible_Fanny_Petanque_World_Tour'))
ap.add_argument('--tourniquet', help='vues du flipper qui tourne (tourniquet.mjs : v00.png…), posées sur le fond')
a = ap.parse_args()
S = a.source
SORTIE = os.path.join(ICI, 'donnees/fond')
os.makedirs(SORTIE, exist_ok=True)

W, H = 1680, 1050
# cadres des deux animations (pixels d'écran) : le générateur y place les flashers
CADRES = {'chassis': (1158, 628, 1398, 868), 'articulation': (1412, 628, 1652, 868)}
# à gauche, sans cadre : le flipper complet (habillage robe à pois) qui tourne sur lui-même
TOURNIQUET = (12, 250, 252, 650)
CREME, BRUN, OR = (246, 231, 193), (43, 24, 12), (232, 178, 60)
POLICE = os.path.join(S, 'assets/fonts/AlfaSlabOne-Regular.ttf')
SCRIPT = next((p for p in ['/usr/share/fonts/opentype/urw-base35/Z003-MediumItalic.otf',
                           '/usr/share/fonts/opentype/urw-base35/URWBookman-LightItalic.otf'] if os.path.exists(p)), POLICE)


def police(t, f=POLICE):
    return ImageFont.truetype(f, t)


def texte(img, xy, s, taille, fond=CREME, trait=BRUN, epais=4, f=POLICE, ancre='la', angle=0):
    """Texte à contour, éventuellement incliné (calque à part)."""
    ft = police(taille, f)
    cal = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(cal)
    # ombre portée douce
    d.text((xy[0] + 4, xy[1] + 5), s, font=ft, fill=(0, 0, 0, 160), anchor=ancre, stroke_width=epais, stroke_fill=(0, 0, 0, 160))
    cal = cal.filter(ImageFilter.GaussianBlur(3))
    d = ImageDraw.Draw(cal)
    d.text(xy, s, font=ft, fill=fond, anchor=ancre, stroke_width=epais, stroke_fill=trait)
    if angle:
        cal = cal.rotate(angle, resample=Image.BICUBIC, center=xy)
    img.alpha_composite(cal)


# ------------------------------------------------------------------ fond : carte du World Tour, assombrie et chaude
# Carte des escales du jeu (un pays en vert par fichier, flèche rouge) : terres en gris, mers en blanc, frontières blanches.
from scipy import ndimage
CARTES = os.path.join(S, 'assets/Images/CountryMapsWorldTour')
def carte_pays(nom):
    return np.asarray(Image.open(os.path.join(CARTES, nom)).convert('RGB')).astype(int)
def rouge(C):
    return (C[..., 0] > C[..., 1] + 60) & (C[..., 0] > C[..., 2] + 60)
def vert(C):
    """pays mis en avant (vert, parfois bleu) : couleur saturée qui n'est pas la flèche rouge"""
    return (C.max(2) - C.min(2) > 40) & ~rouge(C)
C1, C2 = carte_pays('013_france.png'), carte_pays('107_australie.png')
C = np.where(rouge(C1)[..., None], C2, C1)                          # flèche de l'une remplacée par l'autre carte
terre = (C.max(2) < 238) | vert(C)
# un aplat par pays, palette ocre et rouge de l'écran titre du World Tour
pays, n = ndimage.label(terre)
rng = np.random.default_rng(7)
palette = np.array([(214, 150, 62), (190, 108, 52), (160, 70, 45), (228, 172, 84), (176, 92, 50)])
couleur = np.vstack([[232, 214, 170], palette[rng.integers(0, len(palette), n)]])   # 0 : mer (parchemin)
M = couleur[pays].astype(np.uint8)
k = H / M.shape[0]
mw = round(M.shape[1] * k)
DX = 560                                                            # Amérique du Sud dans la bande libre à gauche
carte = Image.fromarray(np.hstack([M, M])).resize((2 * mw, H), Image.LANCZOS).crop((DX, 0, DX + W, H))   # le monde se répète
# itinéraire en pointillés entre les escales de la rampe (centre du pays en vert sur sa carte), boules aux étapes
ESCALES = [('MARSEILLE', '013_france.png', (0, 14)), ('PARIS', '013_france.png', (0, -6)), ('LONDRES', '003_angleterre.png', (0, 0)),
           ('NEW YORK', '098_etats_unis.png', (40, -10)), ('TOKYO', '075_japon.png', (0, 0)), ('RIO', '113_bresil.png', (25, 20)),
           ('SYDNEY', '107_australie.png', (30, 25))]
pts = []
for _, f, (dx, dy) in ESCALES:
    yv, xv = np.nonzero(vert(carte_pays(f)))
    pts.append((xv.mean() * k - DX + dx, yv.mean() * k + dy))
d = ImageDraw.Draw(carte)
for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
    L = np.hypot(xb - xa, yb - ya)
    cx, cy = (xa + xb) / 2, (ya + yb) / 2 - 0.25 * L                    # arc bombé vers le haut
    t = np.linspace(0, 1, max(int(L / 9), 4))
    bx = (1 - t) ** 2 * xa + 2 * (1 - t) * t * cx + t ** 2 * xb
    by = (1 - t) ** 2 * ya + 2 * (1 - t) * t * cy + t ** 2 * yb
    for i in range(0, len(t) - 1, 2):
        d.line((bx[i], by[i], bx[i + 1], by[i + 1]), fill=(50, 36, 28), width=4)
bille = Image.open(os.path.join(S, 'assets/Images/Boule.png')).convert('RGBA').resize((30, 30), Image.LANCZOS)
carte = carte.convert('RGBA')
for x, y in pts:
    carte.alpha_composite(bille, (int(x) - 15, int(y) - 15))
B = np.asarray(carte)
A = B[..., :3].astype(float) / 255
yy, xx = np.mgrid[0:H, 0:W]
vignette = 0.66 - 0.28 * (((xx - W * 0.4) / W) ** 2 + ((yy - H * 0.5) / H) ** 2)
A = A * vignette[..., None] * np.array([1.0, 0.86, 0.72])            # sépia sombre : la table reste au premier plan
fond = Image.fromarray((np.clip(A, 0, 1) * 255).astype(np.uint8)).convert('RGBA')

# ------------------------------------------------------------------ à gauche : titre et médaillon
texte(fond, (205, 70), 'FANNY', 86, ancre='mm', epais=5, angle=4)
texte(fond, (200, 140), 'PÉTANQUE', 50, fond=OR, ancre='mm', angle=4)
texte(fond, (195, 192), 'WORLD TOUR', 44, ancre='mm', angle=4)
med = Image.open(os.path.join(S, 'assets/Images/fanny_10x10cm.png')).convert('RGBA').resize((164, 164), Image.LANCZOS)
ombre = Image.new('RGBA', fond.size, (0, 0, 0, 0))
ImageDraw.Draw(ombre).ellipse((18, 842, 186, 1010), fill=(0, 0, 0, 170))
fond.alpha_composite(ombre.filter(ImageFilter.GaussianBlur(8)))
fond.alpha_composite(med, (12, 834))

# ------------------------------------------------------------------ sous l'afficheur : cadres des GIF et signature
d = ImageDraw.Draw(fond)
bloc = (1146, 614, 1664, 1044)
pan = Image.new('RGBA', fond.size, (0, 0, 0, 0))
ImageDraw.Draw(pan).rounded_rectangle(bloc, 18, fill=(20, 12, 8, 215), outline=OR + (255,), width=3)
fond.alpha_composite(pan)
for nom, (x0, y0, x1, y1) in CADRES.items():
    d.rectangle((x0 - 5, y0 - 5, x1 + 4, y1 + 4), fill=BRUN, outline=OR, width=3)
    d.rectangle((x0, y0, x1 - 1, y1 - 1), fill=(10, 6, 4))
texte(fond, ((CADRES['chassis'][0] + CADRES['chassis'][2]) // 2, 893), 'LE CHÂSSIS', 21, epais=3, ancre='mm')
texte(fond, ((CADRES['articulation'][0] + CADRES['articulation'][2]) // 2, 893), "L'ARTICULATION", 21, epais=3, ancre='mm')
boule = Image.open(os.path.join(S, 'assets/Images/BouleGold.png')).convert('RGBA').resize((118, 118), Image.LANCZOS)
fond.alpha_composite(boule, (1166, 914))
# #arducible : lettres dorées en dégradé, contour brun
ft = police(56)
x0, y0 = 1296, 920
cal = Image.new('L', fond.size, 0)
ImageDraw.Draw(cal).text((x0, y0), '#arducible', font=ft, fill=255)
dg = np.zeros((H, W, 4), np.uint8)
t = np.clip((yy - y0) / 70, 0, 1)
for c, (h, b) in enumerate(zip((255, 236, 150), (196, 120, 30))):
    dg[..., c] = (h + (b - h) * t).astype(np.uint8)
dg[..., 3] = np.asarray(cal)
contour = Image.new('RGBA', fond.size, (0, 0, 0, 0))
ImageDraw.Draw(contour).text((x0 + 3, y0 + 4), '#arducible', font=ft, fill=(0, 0, 0, 200), stroke_width=5, stroke_fill=(0, 0, 0, 200))
fond.alpha_composite(contour.filter(ImageFilter.GaussianBlur(2)))
ImageDraw.Draw(fond).text((x0, y0), '#arducible', font=ft, fill=BRUN, stroke_width=4, stroke_fill=BRUN)
fond.alpha_composite(Image.fromarray(dg))
texte(fond, (1300, 1000), 'the DIY pétanque game', 36, epais=2, f=SCRIPT)
fond.convert('RGB').save(os.path.join(SORTIE, 'fond.jpg'), quality=90)


# ------------------------------------------------------------------ GIF animés tirés des vidéos du projet
def gif(nom, video, debut, duree, fps, rognage, aller_retour=False, cote=256):
    w, h, x, y = rognage
    brut = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(debut), '-t', str(duree), '-i', os.path.join(S, 'videos', video),
                           '-vf', f'fps={fps},crop={w}:{h}:{x}:{y},scale={cote}:{cote}:flags=lanczos',
                           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    im = [Image.fromarray(f) for f in np.frombuffer(brut, np.uint8).reshape(-1, cote, cote, 3)]
    if aller_retour:
        im = im + im[-2:0:-1]
    im[0].save(os.path.join(SORTIE, f'{nom}.gif'), save_all=True, append_images=im[1:], duration=round(1000 / fps), loop=0, optimize=True)
    return len(im), fps


infos = {
    # vidéo « châssis As du tir » : vignette du haut, le châssis en action (tirs sur le châssis devant l'écran)
    'chassis': gif('chassis', 'chassis-as-du-tir.mp4', 2, 8, 6, (282, 282, 12, 20)),
    # vidéo « assemblage articulation » : la boule sur son articulation, aller-retour
    'articulation': gif('articulation', 'assemblage-articulation.mp4', 0, 2.75, 8, (576, 576, 0, 30), aller_retour=True),
}
# flipper qui tourne : chaque vue (fond transparent, ombre au sol comprise) posée sur le morceau de fond qu'elle couvre
if a.tourniquet:
    x0, y0, x1, y1 = TOURNIQUET
    sous = fond.crop(TOURNIQUET)
    vues = []
    for f in sorted(os.listdir(a.tourniquet)):
        if f.endswith('.png'):
            v = Image.open(os.path.join(a.tourniquet, f)).convert('RGBA').resize((x1 - x0, y1 - y0), Image.LANCZOS)
            im = sous.copy(); im.alpha_composite(v); vues.append(im.convert('RGB'))
    vues[0].save(os.path.join(SORTIE, 'tourniquet.gif'), save_all=True, append_images=vues[1:], duration=83, loop=0, optimize=True)
    infos['tourniquet'] = (len(vues), 12)
json.dump({'cadres': {**CADRES, 'tourniquet': TOURNIQUET}, 'gif': {k: {'images': n, 'fps': f} for k, (n, f) in infos.items()}},
          open(os.path.join(SORTIE, 'fond.json'), 'w'), indent=1)
print(SORTIE, infos)
print([(n, int(x), int(y)) for (n, _, _), (x, y) in zip(ESCALES, pts)])
