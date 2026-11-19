#!/usr/bin/env python3
"""Musiques de la table avec YuE2 (sur gpu-a / gpu-b, sous le verrou GPU commun du labo).

Même chemin que l'outil lyrics : requête JSON → `yue2 generate` par SSH sur la carte libre.
Les dossiers de travail sont sous ~/Projets (monté en NFS sur les nœuds GPU).

    python3 outils/musique_yue2.py               # tous les morceaux
    python3 outils/musique_yue2.py generique     # un seul
    python3 outils/musique_yue2.py --graine 7

Sortie : assets/brut/musique/<morceau>_<graine>/… (audio.flac) — à écouter et choisir, puis convertir en
pistes DFPlayer (générique = 0022, thème = 0023) :
    ffmpeg -i audio.flac -af loudnorm=I=-16:TP=-1.5:LRA=11 -ac 2 -b:a 160k assets/sons/0022.mp3
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
RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "assets" / "brut" / "musique"

STYLE_70 = ("French, 1970s French summer pop, sunny and cheerful, Provencal vibe, bright accordion, "
            "plucked mandolin, bouncy bass, light disco drums, glockenspiel, handclaps, vintage analog "
            "recording, 70s pinball arcade fun, {voix}, 118 BPM, major key")

MORCEAUX = {
    # générique chanté (écran d'accueil, début de partie)
    "generique": ("joyful female vocal, playful", """[Verse]
Sous les platanes il fait si chaud
Les cigales chantent tout là-haut
Une boule roule sur le gravier
Fanny sourit, on va jouer

[Chorus]
Fanny, Fanny, tire et pointe au soleil
Fanny, Fanny, l'été n'a pas de pareil
De Marseille jusqu'à Sydney
On fait le tour, on fait le tour

[Verse]
Le vieux Marius sort son mètre
Il jure qu'il a gagné peut-être
Le chien s'enfuit avec le bouchon
Tout le monde court, quelle passion

[Chorus]
Fanny, Fanny, tire et pointe au soleil
Fanny, Fanny, l'été n'a pas de pareil
De Marseille jusqu'à Sydney
On fait le tour, on fait le tour"""),
    # thème de jeu, presque instrumental (chœurs « la la »)
    "theme": ("cheerful female backing choir singing la la la, mostly instrumental", """[Intro]
La la la, la la la

[Chorus]
La la la, la la la la
Pa pa pa, pa pa pa pa
La la la, la la la la
Pa pa pa, pa pa pa

[Chorus]
La la la, la la la la
Pa pa pa, pa pa pa pa
La la la, la la la la
Pa pa pa, pa pa pa"""),
}


def generer(nom, graine):
    voix, paroles = MORCEAUX[nom]
    d = SORTIE / f"{nom}_{graine}"
    if (d / "fini.txt").exists():
        print(f"déjà fait : {d.name}", flush=True)
        return
    d.mkdir(parents=True, exist_ok=True)
    req = {"id": f"fanny_{nom}_{graine}", "style": STYLE_70.format(voix=voix), "lyrics": paroles,
           "cot": "full", "seed": graine,
           "semantic_sampling": {"temperature": 1.0, "top_p": 0.95, "top_k": 100,
                                 "repetition_penalty": 1.2, "max_tokens": 6000},
           "abc_sampling": {"temperature": 0.7, "top_p": 0.9, "top_k": 30}}
    (d / "requete.json").write_text(json.dumps(req, ensure_ascii=False, indent=1), encoding="utf-8")
    noeud = noeuds.choisir("chanson", OUTILS["yue2"])
    t0 = time.time()
    with tache(f"fanny-pinball : musique {nom}", OUTILS["yue2"], noeud=noeud):
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
    ap.add_argument("--graine", nargs="*", type=int, default=[1970, 1975])
    a = ap.parse_args()
    for nom in a.morceaux:
        for g in a.graine:
            generer(nom, g)


if __name__ == "__main__":
    main()
