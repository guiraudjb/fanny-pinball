#!/usr/bin/env python3
"""Génère l'habillage de la table (plateau, fronton, bumpers, rampe, sprites de Fanny) avec Krea 2.

Passe par le client ComfyUI de chat-studio (aiguillage gpu-a / gpu-b et ordonnanceur du labo)
et relit à l'exécution, dans chat-studio, les textes de l'ADN de Fanny, de sa tenue et du style :
rien de ces presets n'est recopié dans ce dépôt.

    python3 outils/habillage_krea2.py                 # tout, 3 variantes chacun
    python3 outils/habillage_krea2.py plateau fronton # seulement certains éléments
    python3 outils/habillage_krea2.py --graines 7 8   # graines imposées

Sortie : assets/brut/<élément>_<graine>.png (non versionné, à trier avant usage).
"""
import argparse
import os
import sys
import time
from pathlib import Path

STUDIO = Path(os.environ.get("CHAT_STUDIO_DIR", "~/Projets/Dépots_Privés/chat-studio")).expanduser()
sys.path.insert(0, str(STUDIO))
import comfyui_client  # noqa: E402
from presets.dict_characters import CHARACTER_PRESETS  # noqa: E402
from presets.dict_character_defaults import CHARACTER_DEFAULTS  # noqa: E402
from presets.dict_outfits import OUTFIT_PRESETS  # noqa: E402
from presets.dict_styles import STYLE_PRESETS  # noqa: E402

ADN = "👩 [Fanny] Pin-up Rétro (Défaut)"
STYLE = "🎨 [Comics] Moderne Cell-Shading (Défaut)"

FANNY = f"{CHARACTER_PRESETS[ADN]}, wearing {OUTFIT_PRESETS[CHARACTER_DEFAULTS[ADN]]}"
STYLE_TXT = STYLE_PRESETS[STYLE]
SEVENTIES = ("1970s pinball art, vintage pinball artwork in the spirit of 1970s Gottlieb and Bally machines, "
             "flashy saturated summer palette: cherry red, electric blue, sunshine yellow, hot magenta, "
             "lavender purple, turquoise sea, black and white polka dots, retro sunburst shapes")
SUD = ("a hot summer afternoon in Provence, an ode to petanque: dusty gravel boulodrome under plane trees, "
       "cicadas, lavender fields, olive branches, sunflowers, the Mediterranean sea, a glass of pastis, "
       "shiny polished chrome silver petanque boules with engraved grooves and a small red wooden jack (cochonnet)")
HUMOUR = ("humorous cartoon details, gentle family friendly comedy: a grumpy old petanque player with a beret "
          "and a big moustache measuring the distance with a tape measure on his knees, his friend arguing "
          "with exaggerated gestures, a little dog running away with the red jack in its mouth, a cicada wearing "
          "sunglasses sipping pastis, a boule stuck in the gravel making a crater")

ELEMENTS = {
    # plateau vu de dessus : 832 × 1728 ≈ proportions 514 × 1067 mm
    "plateau": (832, 1728,
        "Vertical full pinball playfield artwork seen from directly above, flat 2D printed illustration, "
        "a work of art, no 3D objects, no pinball parts, no balls in play, no flippers, no text. "
        "Composition: a blazing yellow summer sun with huge sunburst rays at the top, {sud}; {humour}; "
        "small world tour landmarks along the edges (Eiffel Tower, Big Ben, Statue of Liberty, Mount Fuji, "
        "Christ the Redeemer, Sydney Opera House) as vintage travel stickers; polka dot borders, stars. "
        "In the lower center, {fanny}, smiling, throwing a petanque boule in a dynamic pose. {seventies}. {style}"),
    # fronton (backglass)
    "fronton": (1216, 832,
        "Vintage 1970s pinball backglass artwork, a work of art and an ode to petanque. {fanny}, winking, "
        "holding two shiny polished chrome silver petanque boules with engraved grooves, posing in front of a "
        "giant globe covered with travel stickers, {sud}, sunburst background, glamorous and fun, family "
        "friendly, with a funny detail: a little dog in the corner running away with the red jack, no text. {seventies}. {style}"),
    # chapeau de bumper vu de dessus (détouré en cercle)
    "bumper": (1024, 1024,
        "Top view of a round pinball bumper cap, perfectly circular emblem centered on a plain white background: "
        "a shiny polished chrome silver petanque boule with engraved grooves seen from above, surrounded by "
        "a ring of sunflower petals, a tiny cicada wearing sunglasses sitting on the boule, and a red and white polka dot border, flat vintage 1970s pinball decal, "
        "no text. {style}"),
    # bande décorative pour la rampe (motif répété)
    "rampe": (1536, 512,
        "Seamless horizontal repeating decorative band, flat vintage Provencal fabric pattern for a pinball "
        "ramp decal: lavender sprigs, olive branches, funny yellow cicadas wearing sunglasses, little dogs carrying red jacks, small chrome petanque boules and red jacks, "
        "on a sunshine yellow background with a cherry red border at top and bottom, flat colors, no text, "
        "no perspective. {style}"),
    # fronton avec le titre peint (lettrage des frontons des années 70)
    "fronton_titre": (1216, 832,
        "Vintage 1970s pinball backglass artwork with the big bold retro title lettering \"FANNY\" in chrome "
        "and red outlined letters at the top, and below it the smaller title \"PÉTANQUE WORLD TOUR\" in yellow "
        "letters, exactly these words and nothing else written. {fanny}, winking, holding two shiny polished "
        "chrome silver petanque boules, in front of a giant globe with travel stickers, {sud}, a little dog "
        "running away with the red jack, sunburst background. {seventies}. {style}"),
    # décor des lance-pierres (triangles au-dessus des flippers), découpé à leur forme
    "lance_pierre": (512, 1024,
        "Vertical flat decorative panel for a pinball slingshot plastic, vintage 1970s pinball art: a tall "
        "glass of pastis with ice cubes and a lemon slice, a funny cicada wearing sunglasses lounging on top, "
        "lavender sprigs, a chrome petanque boule and a red jack at the bottom, sunburst rays behind, hot "
        "magenta and sunshine yellow, bold black outlines, flat colors, no text. {style}"),
    # sprites détourables (fond vert uni)
    "sprite_lancer": (832, 1216,
        "Full body character sprite of {fanny}, throwing a shiny chrome petanque boule underhand, joyful, "
        "dynamic pose, isolated on a plain flat solid pure green background, no shadow, no floor, centered, "
        "whole body visible. {style}"),
    "sprite_victoire": (832, 1216,
        "Full body character sprite of {fanny}, cheering with both arms raised, holding a shiny polished "
        "chrome silver petanque boule, celebrating a jackpot, joyful, isolated on a plain flat solid pure green "
        "background, no shadow, no floor, centered, whole body visible. {style}"),
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("elements", nargs="*", default=list(ELEMENTS))
    ap.add_argument("--graines", nargs="*", type=int, default=[11, 23, 37])
    ap.add_argument("--sortie", default=str(Path(__file__).resolve().parent.parent / "assets" / "brut"))
    a = ap.parse_args()
    out = Path(a.sortie)
    out.mkdir(parents=True, exist_ok=True)
    for nom in a.elements:
        w, h, gabarit = ELEMENTS[nom]
        prompt = gabarit.format(fanny=FANNY, seventies=SEVENTIES, style=STYLE_TXT, sud=SUD, humour=HUMOUR)
        for g in a.graines:
            cible = out / f"{nom}_{g}.png"
            if cible.exists():
                print(f"déjà fait : {cible.name}", flush=True)
                continue
            t0 = time.time()
            img = comfyui_client.generate_image(prompt, seed=g, width=w, height=h,
                                                filename_prefix=f"fanny-pinball/{nom}")
            img.save(cible)
            print(f"{cible.name} ({w}×{h}) en {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
