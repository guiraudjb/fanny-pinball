"""Écran de la vue bureau des tables universelles, disposition de Fanny Pinball (outils/vpx/fond.py) :
table au centre ; à droite le fronton assemblé (caisson, panneau de l'image, afficheur dessous dans le caisson) ;
en bas à droite la signature #arducible · the DIY pétanque game (reprise telle quelle du fond de Fanny) ;
en haut à gauche, la place du flipper complet qui tourne sur lui-même (panneau GIF).
Repères : FRONTON_BUREAU du générateur (0,64 ; 0,04 ; 0,34) et afficheur 128 × 32 sous l'image (y 451 à 594)."""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
FOND_FANNY = os.path.join(ICI, '..', '..', 'outils', 'vpx', 'donnees', 'fond', 'fond.jpg')
GRAS = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
LW, LH = 1680, 1050


def dessiner(t, chemin, art_fronton=None):
    y = np.linspace(0, 1, LH)[:, None, None]
    x = np.linspace(0, 1, LW)[None, :, None]
    a = np.array([40, 44, 52]) * (1 - 0.45 * y) * (1 - 0.25 * np.abs(x - 0.38))
    im = Image.fromarray(np.broadcast_to(a, (LH, LW, 3)).astype(np.uint8).copy()).convert('RGBA')
    d = ImageDraw.Draw(im)
    # ---- fronton assemblé : caisson (côtés, dessus, dessous), image en haut, afficheur dans le panneau du bas
    x0, y0, w = 0.64 * LW, 0.04 * LH, 0.34 * LW
    h = w * 832 / 1216
    bas = 640                                   # bas du caisson (afficheur de 451 à 594)
    ombre = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(ombre).rectangle((x0 - 14, y0 - 6, x0 + w + 33, bas + 30), fill=(0, 0, 0, 170))
    im.alpha_composite(ombre.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(im)
    cote = (202, 206, 212)
    d.rectangle((x0 - 26, y0 - 26, x0 + w + 26, bas), fill=cote)                    # façade du caisson
    d.polygon([(x0 + w + 26, y0 - 26), (x0 + w + 33, y0 - 34), (x0 + w + 33, bas - 8), (x0 + w + 26, bas)], fill=(150, 154, 160))  # côté
    d.polygon([(x0 - 26, y0 - 26), (x0 - 12, y0 - 34), (x0 + w + 33, y0 - 34), (x0 + w + 26, y0 - 26)], fill=(228, 230, 234))     # dessus
    for k, c in enumerate(((232, 234, 238), (120, 124, 132))):                       # baguette chromée du cadre
        d.rectangle((x0 - 8 + k, y0 - 8 + k, x0 + w + 8 - k, bas - 18 - k), outline=c, width=1)
    if art_fronton and os.path.exists(art_fronton):
        fr = Image.open(art_fronton).convert('RGB').resize((round(w), round(h)), Image.LANCZOS)
        im.paste(fr, (round(x0), round(y0)))
    else:                                                                            # panneau neutre : titre
        d.rectangle((x0, y0, x0 + w, y0 + h), fill=(28, 31, 38))
        ft = ImageFont.truetype(GRAS, 66)
        d.text((x0 + w / 2, y0 + h * 0.42), t.titre.upper(), font=ft, fill=(236, 238, 242), anchor='mm')
        ft = ImageFont.truetype(GRAS, 22)
        d.text((x0 + w / 2, y0 + h * 0.62), t.sous_titre.upper(), font=ft, fill=(160, 168, 182), anchor='mm')
    d.rectangle((x0, y0 + h + 2, x0 + w, bas - 20), fill=(8, 8, 10))                  # panneau de l'afficheur
    d.line((x0, y0 + h + 1, x0 + w, y0 + h + 1), fill=(120, 124, 132), width=2)
    # ---- signature : celle du fond de Fanny (boule dorée, #arducible, the DIY pétanque game)
    sig = Image.open(FOND_FANNY).convert('RGB').crop((1152, 906, 1658, 1040))
    bloc = (1146, 898, 1664, 1046)
    pan = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(pan).rounded_rectangle(bloc, 18, fill=(20, 12, 8, 235), outline=(232, 178, 60, 255), width=3)
    im.alpha_composite(pan)
    im.paste(sig, (1152, 906))
    ImageDraw.Draw(im).rounded_rectangle(bloc, 18, outline=(232, 178, 60), width=3)
    im.convert('RGB').save(chemin, quality=92)
