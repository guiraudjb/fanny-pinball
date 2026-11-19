#!/usr/bin/env python3
"""Retouche du plateau retenu (sans IA) : la cigale à lunettes quitte le bas à droite pour l'arbre
près du soleil. Contour tracé à la main autour de son liseré ; son ancienne place est comblée par la
lavande située juste au-dessus.

    python3 outils/retouche_plateau.py          # assets/brut/plateau_11.png → assets/brut/plateau_11c.png
    python3 outils/lissage_krea2.py             # facultatif : fondu Krea 2 → plateau_11k.png
    python3 outils/preparer_assets.py plateau=11c  (ou 11k)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

BRUT = Path(__file__).resolve().parent.parent / "assets" / "brut"
# contour de la cigale (coordonnées de l'image 832 × 1728, relevées sur un agrandissement ×3 en (570, 925))
CONTOUR = [(60, 105), (95, 85), (150, 45), (200, 60), (250, 95), (300, 120), (312, 145), (295, 190), (305, 260),
           (335, 300), (350, 355), (325, 405), (260, 418), (200, 402), (150, 422), (80, 412), (8, 335), (28, 250),
           (58, 228), (80, 170), (52, 120)]
DEST = (600, 275)            # dans l'arbre de droite, contre les rayons du soleil


def main():
    im = Image.open(BRUT / "plateau_11.png").convert("RGB")
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).polygon([(570 + x / 3, 925 + y / 3) for x, y in CONTOUR], fill=255)
    bb = m.getbbox()
    cig = im.crop(bb)
    cig.putalpha(m.crop(bb).filter(ImageFilter.GaussianBlur(1.2)))
    # effacer : la zone juste au-dessus recopiée par-dessus, bords fondus
    h = bb[3] - bb[1]
    src = im.crop((bb[0], bb[1] - h, bb[2], bb[1]))
    out = im.copy()
    out.paste(src, (bb[0], bb[1]), m.crop(bb).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(4)))
    # poser dans l'arbre, un peu plus petite et inclinée
    c2 = cig.resize((int(cig.width * 0.85), int(cig.height * 0.85)), Image.LANCZOS)
    c2 = c2.rotate(-12, expand=True, resample=Image.BICUBIC)
    pos = (DEST[0] - c2.width // 2, DEST[1] - c2.height // 2)
    out.paste(c2, pos, c2)
    out.save(BRUT / "plateau_11c.png")
    # masques pour le lissage Krea 2 (outils/lissage_krea2.py) : nouvelle place, ancienne place
    haut = Image.new("L", im.size, 0)
    haut.paste(c2.getchannel("A"), pos)
    haut.save(BRUT / "plateau_11c_masque_haut.png")
    m.save(BRUT / "plateau_11c_masque_bas.png")
    print("ok", BRUT / "plateau_11c.png")


if __name__ == "__main__":
    main()
