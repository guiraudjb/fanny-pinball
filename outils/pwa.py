"""Application installable (PWA) : icônes + liste des fichiers du service worker.

    python3 outils/pwa.py

À relancer avant chaque commit qui touche aux fichiers servis (js, css, assets, index.html) :
le nom du cache du service worker est l'empreinte de ces fichiers, donc une nouvelle version
remplace l'ancienne chez les joueurs au chargement suivant.

- icônes : sprite de Fanny (assets/fanny_victoire.png) sur un soleil, sans IA → icons/
- sw.js  : réécrit la liste PRECACHE et la constante VERSION entre les marqueurs.
"""
import hashlib
import re
from pathlib import Path

from PIL import Image, ImageDraw

RACINE = Path(__file__).resolve().parent.parent
ICONES = RACINE / "icons"

# fichiers servis au joueur (hors docs, outils, CAO)
MOTIFS = ["index.html", "manifest.webmanifest", "css/*.css", "js/*.js", "vendor/*.js",
          "assets/*.jpg", "assets/*.png", "assets/sons/*.mp3", "icons/*.png"]


def soleil(taille):
    """Fond : dégradé radial or → bleu, comme le titre du fronton."""
    im = Image.new("RGB", (taille, taille), "#1f4e8c")
    d = ImageDraw.Draw(im)
    c = taille / 2
    pas = 64
    for i in range(pas, 0, -1):
        t = i / pas
        r = c * 1.45 * t
        # #f4c869 (centre) → #e0a134 (35 %) → #1f4e8c (bord)
        if t < 0.35:
            k = t / 0.35
            col = tuple(round(a + (b - a) * k) for a, b in zip((0xf4, 0xc8, 0x69), (0xe0, 0xa1, 0x34)))
        else:
            k = (t - 0.35) / 0.65
            col = tuple(round(a + (b - a) * k) for a, b in zip((0xe0, 0xa1, 0x34), (0x1f, 0x4e, 0x8c)))
        d.ellipse([c - r, c * 0.8 - r, c + r, c * 0.8 + r], fill=col)
    return im


def icone(taille, zone_sure):
    """zone_sure : part du côté où doit tenir le sujet (0,8 pour les icônes « maskable »)."""
    fond = soleil(taille)
    fanny = Image.open(RACINE / "assets/fanny_victoire.png").convert("RGBA")
    # buste : le haut du sprite (tête + épaules), recadré carré
    w, h = fanny.size
    buste = fanny.crop((0, 0, w, min(h, round(w * 1.05))))
    cote = round(taille * zone_sure)
    buste.thumbnail((cote, cote), Image.LANCZOS)
    x = (taille - buste.width) // 2
    y = taille - buste.height          # buste posé sur le bord bas (la robe sort du cadre)
    fond.paste(buste, (x, y), buste)
    return fond


def icones():
    ICONES.mkdir(exist_ok=True)
    for taille in (192, 512):
        icone(taille, 0.92).save(ICONES / f"icone-{taille}.png", optimize=True)
        icone(taille, 0.74).save(ICONES / f"icone-maskable-{taille}.png", optimize=True)
    icone(180, 0.92).save(ICONES / "apple-touch-icon.png", optimize=True)


def service_worker():
    fichiers = sorted({p.relative_to(RACINE).as_posix() for m in MOTIFS for p in RACINE.glob(m)})
    h = hashlib.sha256()
    for f in fichiers:
        h.update(f.encode())
        h.update((RACINE / f).read_bytes())
    version = h.hexdigest()[:12]
    sw = RACINE / "sw.js"
    texte = sw.read_text()
    liste = "".join(f"  './{f}',\n" for f in ["", *fichiers])
    texte = re.sub(r"(// <version>\n).*?(// </version>)", lambda m: f"{m[1]}const VERSION = '{version}';\n{m[2]}", texte, flags=re.S)
    texte = re.sub(r"(// <fichiers>\n).*?(// </fichiers>)", lambda m: f"{m[1]}{liste}{m[2]}", texte, flags=re.S)
    sw.write_text(texte)
    taille = sum((RACINE / f).stat().st_size for f in fichiers)
    print(f"sw.js : version {version}, {len(fichiers) + 1} fichiers, {taille / 1e6:.1f} Mo")


if __name__ == "__main__":
    icones()
    service_worker()
