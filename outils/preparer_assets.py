#!/usr/bin/env python3
"""Transforme les images retenues de assets/brut/ en fichiers utilisés par le jeu (sans IA).

    python3 outils/preparer_assets.py plateau=23 fronton=11 bumper=37 rampe=11 \
        sprite_victoire=23 sprite_lancer=11

  plateau  → assets/plateau.jpg        (recadré aux proportions 514 × 1067)
  fronton  → assets/fronton.jpg
  bumper   → assets/bumper.png         (disque détouré, fond transparent)
  rampe    → assets/rampe.jpg          (bande répétée le long de la rampe)
  lance_pierre → assets/lance_pierre.jpg (découpé à la forme des deux triangles)
  fronton_titre → assets/fronton.jpg  (variante avec le titre peint)
  sprite_* → assets/fanny_<pose>.png   (fond vert retiré, recadré au personnage)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RACINE = Path(__file__).resolve().parent.parent
BRUT, OUT = RACINE / "assets" / "brut", RACINE / "assets"


def plateau(img):
    w, h = img.size
    cible = 514 / 1067
    if w / h > cible:
        nw = round(h * cible); img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / cible); img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    img.resize((1028, 2134), Image.LANCZOS).save(OUT / "plateau.jpg", quality=86)


def fronton(img):
    img.save(OUT / "fronton.jpg", quality=86)


def bumper(img):
    s = min(img.size)
    img = img.crop(((img.width - s) // 2, (img.height - s) // 2, (img.width + s) // 2, (img.height + s) // 2))
    # le disque utile : plus grand cercle non blanc autour du centre
    a = np.asarray(img.convert("L"), dtype=np.float32)
    c = s // 2
    rows = a[c, :]
    non_blanc = np.where(rows < 235)[0]
    r = int(max(c - non_blanc.min(), non_blanc.max() - c)) if len(non_blanc) else c
    r = min(r, c)
    img = img.crop((c - r, c - r, c + r, c + r)).resize((256, 256), Image.LANCZOS).convert("RGBA")
    masque = Image.new("L", (1024, 1024), 0)
    ImageDraw.Draw(masque).ellipse((8, 8, 1016, 1016), fill=255)
    img.putalpha(masque.resize((256, 256), Image.LANCZOS))
    img.save(OUT / "bumper.png")


def lance_pierre(img):
    img.resize((256, 512), Image.LANCZOS).save(OUT / "lance_pierre.jpg", quality=86)


def fronton_titre(img):
    fronton(img)


def rampe(img):
    img.resize((768, 256), Image.LANCZOS).save(OUT / "rampe.jpg", quality=86)


def sprite(img, nom):
    """Détourage du fond vert : distance à la couleur médiane du bord, plus la « verdeur » du pixel."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    bord = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    fond = np.median(bord, axis=0)
    dist = np.sqrt(((a - fond) ** 2).sum(-1))
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    vert = g - np.maximum(r, b)
    alpha = np.clip((dist - 45) * 5, 0, 255)
    alpha = np.where(vert > 35, np.minimum(alpha, np.clip((80 - vert) * 6, 0, 255)), alpha)
    # despill : on rabat le vert résiduel sur les bords
    a2 = a.copy()
    a2[..., 1] = np.minimum(g, np.maximum(r, b) + 12)
    out = Image.fromarray(a2.astype(np.uint8)).convert("RGBA")
    m = Image.fromarray(alpha.astype(np.uint8)).filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(0.7))
    out.putalpha(m)
    out = out.crop(m.point(lambda v: 255 if v > 128 else 0).getbbox())
    out.thumbnail((512, 760), Image.LANCZOS)
    out.save(OUT / f"fanny_{nom}.png")


def main():
    for arg in sys.argv[1:]:
        el, graine = arg.split("=")
        img = Image.open(BRUT / f"{el}_{graine}.png").convert("RGB")
        if el.startswith("sprite_"):
            sprite(img, el[len("sprite_"):])
        else:
            {"plateau": plateau, "fronton": fronton, "fronton_titre": fronton_titre, "bumper": bumper,
             "rampe": rampe, "lance_pierre": lance_pierre}[el](img)
        print("ok", el, graine)


if __name__ == "__main__":
    main()
