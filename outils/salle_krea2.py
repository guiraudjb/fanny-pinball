#!/usr/bin/env python3
"""Génère avec Krea 2 les textures et sprites de la salle provençale (décor des menus et de la cinématique de la
version native), puis les prépare pour js/salle.js.

Même chaîne que outils/habillage_krea2.py : client ComfyUI de chat-studio (aiguillage gpu-a / gpu-b et ordonnanceur
du labo), style relu à l'exécution dans les presets de chat-studio.

    python3 outils/salle_krea2.py                      # génère tout (3 graines), sans écraser
    python3 outils/salle_krea2.py tomettes paysage     # seulement certains éléments
    python3 outils/salle_krea2.py --preparer           # bruts choisis → assets/salle/ (sans IA)

Bruts : assets/brut/salle/<élément>_<graine>.png (non versionnés). Choix des graines : CHOIX ci-dessous.
Préparation (sans IA) : textures rendues raccordables (décalage d'une demi-tuile puis fondu), sprites détourés
(fond vert uni retiré), tapis découpé en disque, le tout en JPEG / PNG dans assets/salle/.
"""
import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ICI = Path(__file__).resolve().parent.parent
BRUT = ICI / "assets" / "brut" / "salle"
SORTIE = ICI / "assets" / "salle"

STYLE = "🎨 [Comics] Moderne Cell-Shading (Défaut)"
ILLU = ("flat illustrated look matching a 1970s Provencal pinball artwork, warm summer palette, clean shapes, "
        "soft painterly cell shading")
VERT = "isolated on a plain flat solid pure green background, no shadow, no floor, centered, whole object visible"

# nom : (largeur, hauteur, consigne, préparation)
ELEMENTS = {
    "tomettes": (1024, 1024,
        "Seamless square texture seen from directly above, orthographic top view: old Provencal floor of hexagonal "
        "terracotta tomette tiles, waxed and slightly worn, warm red orange and ochre shades varying from tile to "
        "tile, thin dark grout lines, evenly lit, no perspective, no objects, no shadows, no text. {illu}", "raccord"),
    "chaux": (1024, 1024,
        "Seamless square texture, flat front view of an old Provencal wall coated with warm ochre yellow lime wash, "
        "soft mottled patches of lighter and darker ochre, faint brush strokes, very subtle, evenly lit, no objects, "
        "no cracks, no text. {illu}", "raccord"),
    "soubassement": (1024, 512,
        "Seamless horizontal texture, flat front view of a lavender blue painted wooden wainscot in a Provencal cafe, "
        "vertical tongue and groove planks, slightly worn paint, evenly lit, no objects, no text. {illu}", "raccord_h"),
    "paysage": (832, 1344,
        "Full frame landscape painting filling the entire image edge to edge, Provence on a hot summer afternoon: rows of blooming lavender "
        "fields in perspective, Mont Ventoux with its white summit in the distance, tall dark cypress trees, round "
        "olive trees, a blazing yellow sun with sunburst rays in a deep blue sky, and a funny cicada wearing "
        "sunglasses sitting on an olive branch in the foreground, no window, no frame, no border, no wall, no text. {illu}. {style}", "jpeg"),
    "ardoise": (1152, 864,
        "Front view of a cafe chalkboard slate filling the whole image, dark green black slate with faint chalk "
        "smudges, the center left empty, a hand drawn chalk border with little petanque boules, a red jack, olive "
        "sprigs and a cicada in the corners, no letters, no words, no text. {illu}", "jpeg"),
    "tapis": (1024, 1024,
        "Top view of a round Provencal woven rug, perfectly circular, centered, on a plain white background: "
        "concentric bands of madder red, sunflower yellow and indigo blue with olive branch and cicada motifs, "
        "flat colors, orthographic top view, no perspective, no text. {illu}", "disque"),
    "olivier": (832, 1216,
        "An old gnarled olive tree with silver green foliage planted in a big rounded terracotta Anduze jar with "
        "garland decoration, {vert}. {illu}. {style}", "detourer"),
    "affiche_papis": (832, 1216,
        "Vintage 1970s illustrated poster without any text: two old petanque players in berets with big moustaches, "
        "one on his knees measuring the distance with a tape measure, the other arguing with exaggerated gestures, "
        "a little dog running away with the red jack, shiny chrome boules on dusty gravel under plane trees, cicadas, "
        "warm sunset colors, no letters, no words. {illu}. {style}", "jpeg"),
    "comptoir": (1024, 512,
        "Seamless horizontal texture, flat front view of the wooden front panel of an old French cafe zinc bar "
        "counter, dark varnished walnut with carved moulded panels, evenly lit, no objects, no text. {illu}", "raccord_h"),
}

# graines retenues après tri (None : première graine générée)
CHOIX = {"tomettes": 23, "chaux": 37, "soubassement": 11, "ardoise": 11, "tapis": 11, "olivier": 23,
         "affiche_papis": 11, "comptoir": 23, "paysage": 23}


def generer(noms, graines):
    studio = Path(os.environ.get("CHAT_STUDIO_DIR", "~/Projets/Dépots_Privés/chat-studio")).expanduser()
    sys.path.insert(0, str(studio))
    import comfyui_client
    from presets.dict_styles import STYLE_PRESETS
    BRUT.mkdir(parents=True, exist_ok=True)
    for nom in noms:
        w, h, gabarit, _ = ELEMENTS[nom]
        prompt = gabarit.format(illu=ILLU, style=STYLE_PRESETS[STYLE], vert=VERT)
        for g in graines:
            cible = BRUT / f"{nom}_{g}.png"
            if cible.exists():
                print(f"déjà fait : {cible.name}", flush=True)
                continue
            t0 = time.time()
            img = comfyui_client.generate_image(prompt, seed=g, width=w, height=h, filename_prefix=f"fanny-pinball/salle_{nom}")
            img.save(cible)
            print(f"{cible.name} ({w}×{h}) en {time.time() - t0:.0f} s", flush=True)


def raccord(img, axes=(1, 0)):
    """Rend une image raccordable : décalage d'une demi-tuile (les bords deviennent continus) puis fondu en cosinus
    avec l'original, qui recouvre la couture ramenée au centre ; d'abord en largeur, puis en hauteur."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    for axe in axes:
        n = a.shape[axe]
        decale = np.roll(a, n // 2, axis=axe)
        t = np.sin(np.pi * (np.arange(n) + 0.5) / n) ** 2
        w = t[None, :, None] if axe == 1 else t[:, None, None]
        a = w * a + (1 - w) * decale
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def detourer(img):
    """Retire un fond uni (vert pour les sprites, blanc pour le tapis) : couleur du fond relevée dans les coins,
    alpha selon la distance à cette couleur, bord resserré et adouci, débordement de la couleur du fond neutralisé."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    h, w = a.shape[:2]
    coins = np.concatenate([a[:16, :16].reshape(-1, 3), a[:16, -16:].reshape(-1, 3), a[-16:, :16].reshape(-1, 3), a[-16:, -16:].reshape(-1, 3)])
    fond = np.median(coins, axis=0)
    d = np.linalg.norm(a - fond, axis=2)
    alpha = np.clip((d - 40) / 50, 0, 1)
    if fond[1] > fond[0] + 30 and fond[1] > fond[2] + 30:      # fond vert : despill
        a[..., 1] = np.minimum(a[..., 1], np.maximum(a[..., 0], a[..., 2]) + 10)
    m = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
    out = Image.fromarray(a.clip(0, 255).astype(np.uint8)).convert("RGBA")
    out.putalpha(m)
    return out.crop(out.getbbox())


def disque(img):
    """Tapis rond : fond blanc retiré, puis recadré en carré centré sur le tapis."""
    out = detourer(img)
    s = max(out.size)
    carre = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    carre.paste(out, ((s - out.width) // 2, (s - out.height) // 2))
    return carre


def preparer():
    SORTIE.mkdir(parents=True, exist_ok=True)
    for nom, (_, _, _, prep) in ELEMENTS.items():
        bruts = sorted(BRUT.glob(f"{nom}_*.png"))
        g = CHOIX.get(nom)
        src = BRUT / f"{nom}_{g}.png" if g is not None else (bruts[0] if bruts else None)
        if not src or not src.exists():
            print(f"manque : {nom}")
            continue
        img = Image.open(src)
        if prep == "raccord":
            raccord(img).save(SORTIE / f"{nom}.jpg", quality=88)
        elif prep == "raccord_h":                               # bandeau : raccord en largeur seulement
            raccord(img, (1,)).save(SORTIE / f"{nom}.jpg", quality=88)
        elif prep == "jpeg":
            img.convert("RGB").save(SORTIE / f"{nom}.jpg", quality=88)
        elif prep == "detourer":
            detourer(img).save(SORTIE / f"{nom}.png", optimize=True)
        elif prep == "disque":
            disque(img).save(SORTIE / f"{nom}.png", optimize=True)
        print(f"{src.name} → assets/salle/{nom} ({prep})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("elements", nargs="*", default=list(ELEMENTS))
    ap.add_argument("--graines", nargs="*", type=int, default=[11, 23, 37])
    ap.add_argument("--preparer", action="store_true")
    a = ap.parse_args()
    if a.preparer:
        preparer()
    else:
        generer(a.elements, a.graines)


if __name__ == "__main__":
    main()
