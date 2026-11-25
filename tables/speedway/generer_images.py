#!/usr/bin/env python3
"""Habillage « Speedway » (grasstrack & speedway) : illustrations générées par Krea 2, à trier puis retoucher.

Passe par le client ComfyUI de chat-studio (aiguillage gpu-a / gpu-b, ordonnanceur du labo), comme
outils/habillage_krea2.py de Fanny Pinball.

    python3 generer_images.py                     # tout, 3 graines chacun
    python3 generer_images.py plateau --graines 5 # un élément, graines imposées

Sortie : brut/<élément>_<graine>.png (non versionné) ; choix et retouche : preparer.py.
"""
import argparse
import os
import sys
import time
from pathlib import Path

STUDIO = Path(os.environ.get("CHAT_STUDIO_DIR", "~/Projets/Dépots_Privés/chat-studio")).expanduser()
sys.path.insert(0, str(STUDIO))
import comfyui_client  # noqa: E402

ICI = Path(__file__).resolve().parent

STYLE = ("vintage 1970s motorsport poster art and pinball artwork, bold black outlines, flat saturated colors with "
         "halftone print texture, dynamic speed lines, palette: shale orange-brown, deep black, white, safety "
         "yellow, racing red, royal blue, grass green")
PISTE = ("speedway and grasstrack motorcycle racing: lightweight 500cc single-cylinder methanol bikes with no "
         "brakes, riders broadsiding sideways through the bend in a controlled slide, left leg out with a steel "
         "shoe, rooster tails of flying shale, helmet covers in red, blue, white and yellow, racing bibs with "
         "numbers, oval track")

ELEMENTS = {
    # plateau vu de dessus : 832 × 2048 ≈ proportions du plateau 514 × 1263 mm
    "plateau": (832, 2048,
        "Vertical full pinball playfield artwork seen from directly above, flat 2D printed illustration, a work of "
        "art, no 3D objects, no pinball parts, no balls, no flippers, no text, no letters. Composition: a speedway "
        "stadium seen from above, a large oval shale track of orange-brown dirt whose straights run along the left "
        "and right edges of the image and whose bends curve across the top and the bottom, four riders broadsiding "
        "counterclockwise through the top bend in a spray of shale, a white starting line and starting gate tapes "
        "near the bottom, green grass infield with mowed stripes in the middle, white safety fence, crowd stands "
        "and floodlight towers in the corners. {piste}. {style}"),
    # fronton avec le titre peint
    "fronton": (1216, 832,
        "Vintage pinball backglass artwork with the big bold retro title lettering \"SPEEDWAY\" in chrome and red "
        "outlined letters at the top, exactly this word and nothing else written. Below it, four riders side by side "
        "broadsiding through a bend at full throttle, leaning hard, rooster tails of shale, floodlit stadium at "
        "night, cheering crowd, checkered flags, sunburst behind. {piste}. {style}"),
    # flanc de la caisse (bande large, peinte sur les deux côtés du châssis de Fanny Pinball)
    "flanc": (1536, 704,
        "Wide horizontal pinball cabinet side art decal, vintage 1970s motorsport style: a speedway rider "
        "broadsiding hard into a bend from left to right, steel shoe skimming the shale, huge rooster tail of dirt, "
        "speed lines, a grasstrack sidecar crew far behind on a green meadow, black and white checkered band along "
        "the bottom, dark background, no text, no letters. {piste}. {style}"),
    # fond de la vue bureau (derrière le plateau, le fronton et la caisse qui tourne)
    "fond": (1536, 960,
        "Wide night view of an empty speedway stadium under bright floodlights, oval shale track glowing orange, "
        "crowd in the dark stands, white fence, starting gate with tapes, dark moody sky, soft focus, poster "
        "background, no riders, no text, no letters. {style}"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("elements", nargs="*", default=list(ELEMENTS))
    ap.add_argument("--graines", nargs="*", type=int, default=[11, 23, 37])
    a = ap.parse_args()
    out = ICI / "brut"
    out.mkdir(parents=True, exist_ok=True)
    for nom in a.elements:
        w, h, gabarit = ELEMENTS[nom]
        prompt = gabarit.format(piste=PISTE, style=STYLE)
        for g in a.graines:
            cible = out / f"{nom}_{g}.png"
            if cible.exists():
                print(f"déjà fait : {cible.name}", flush=True)
                continue
            t0 = time.time()
            img = comfyui_client.generate_image(prompt, seed=g, width=w, height=h, filename_prefix=f"speedway/{nom}")
            img.save(cible)
            print(f"{cible.name} ({w}×{h}) en {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
