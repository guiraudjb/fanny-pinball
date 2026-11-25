#!/usr/bin/env python3
"""Musiques « Speedway » avec YuE2 (gpu-a / gpu-b, sous le verrou GPU commun du labo), comme
outils/musique_yue2.py de Fanny Pinball.

    python3 musique.py                 # générique et thème, deux graines chacun
    python3 musique.py theme --graine 7

Sortie : brut/musique/<morceau>_<graine>/… (audio.flac) — à écouter et choisir ; preparer.py les convertit en
sons de la table (musique_accueil, musique_jeu).
"""
import argparse
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, "/home/adm1/Projets/Dépots_Privés/RefonteRévisions/scripts/outils")
import noeuds  # noqa: E402
from gpu import OUTILS, tache  # noqa: E402

YUE = "/home/adm1/aitools/YuE"
SORTIE = Path(__file__).resolve().parent / "brut" / "musique"

STYLE = ("French, 1970s French rock, energetic glam rock stadium anthem, driving drums, overdriven electric guitars, "
         "roaring bass, handclaps, motorsport fever, vintage analog recording, pinball arcade fun, {voix}, 138 BPM, "
         "major key")

MORCEAUX = {
    "generique": ("powerful raspy male vocal, crowd chanting", """[Verse]
Sous les projecteurs le schiste est chaud
Quatre pilotes serrent le guidon
Pas de freins, pas de boîte, juste un moteur
Le ruban se lève, ça va faire peur

[Chorus]
Speedway, speedway, en dérapage
Gaz à fond dans le virage
Speedway, speedway, quatre tours
Le public crie, on fait le tour

[Verse]
De Marmande jusqu'à La Réole
Sur l'herbe verte la moto s'envole
Le pied d'acier frôle la terre
Un nuage orange dans la lumière

[Chorus]
Speedway, speedway, en dérapage
Gaz à fond dans le virage
Speedway, speedway, quatre tours
Le public crie, on fait le tour"""),
    "theme": ("male backing choir shouting hey hey, mostly instrumental guitar riffs", """[Intro]
Hey, hey, hey

Hey, hey, ho, hey, hey
Gaz, gaz, gaz, gaz
Hey, hey, ho, hey, hey
Speedway, speedway

Hey, hey, ho, hey, hey
Gaz, gaz, gaz, gaz
Hey, hey, ho, hey, hey
Speedway, speedway"""),
}


def generer(nom, graine):
    voix, paroles = MORCEAUX[nom]
    d = SORTIE / f"{nom}_{graine}"
    if (d / "fini.txt").exists():
        print(f"déjà fait : {d.name}", flush=True)
        return
    d.mkdir(parents=True, exist_ok=True)
    req = {"id": f"speedway_{nom}_{graine}", "style": STYLE.format(voix=voix), "lyrics": paroles,
           "cot": "full", "seed": graine,
           "semantic_sampling": {"temperature": 1.0, "top_p": 0.95, "top_k": 100,
                                 "repetition_penalty": 1.2, "max_tokens": 6000},
           "abc_sampling": {"temperature": 0.7, "top_p": 0.9, "top_k": 30}}
    (d / "requete.json").write_text(json.dumps(req, ensure_ascii=False, indent=1), encoding="utf-8")
    noeud = noeuds.choisir("chanson", OUTILS["yue2"])
    t0 = time.time()
    with tache(f"speedway : musique {nom}", OUTILS["yue2"], noeud=noeud):
        base = noeuds._ssh_base(noeud)
        cmd = (f"cd {shlex.quote(YUE)} && exec .venv/bin/yue2 generate "
               f"--request {shlex.quote(str(d / 'requete.json'))} --output {shlex.quote(str(d / 'yue2'))}")
        p = subprocess.run(base + [cmd], capture_output=True, text=True)
        (d / "journal.txt").write_text(p.stdout + p.stderr, encoding="utf-8")
    flac = next((d / "yue2").rglob("audio.flac"), None)
    if p.returncode or not flac:
        print(f"⚠ {nom} {graine} : échec (code {p.returncode}), voir {d / 'journal.txt'}", flush=True)
        return
    (d / "fini.txt").write_text(str(flac) + "\n")
    print(f"{nom}_{graine} sur {noeud} en {time.time() - t0:.0f} s → {flac}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("morceaux", nargs="*", default=list(MORCEAUX))
    ap.add_argument("--graine", nargs="*", type=int, default=[1928, 1975])
    a = ap.parse_args()
    for nom in a.morceaux:
        for g in a.graine:
            generer(nom, g)


if __name__ == "__main__":
    main()
