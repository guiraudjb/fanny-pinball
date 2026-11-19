#!/usr/bin/env python3
"""Voix de Fanny (Pilote2) : réserve le GPU du nœud de voix, démarre VoiceStudio, lance
outils/voix_fanny_noeud.py SUR le nœud, puis arrête VoiceStudio (il garde ~3,4 Go de VRAM au repos).

    python3 outils/voix_fanny.py [--noeud gpu-b] [--refaire]
Journal : assets/brut/voix/voix.log
"""
import os, subprocess, sys, time

R = "/home/adm1/Projets/Dépots_Privés/RefonteRévisions"
ICI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, f"{R}/scripts/outils")
import noeuds  # noqa: E402
from gpu import tache, OUTILS, decharger_ollama  # noqa: E402

os.makedirs(f"{ICI}/assets/brut/voix", exist_ok=True)
journal = open(f"{ICI}/assets/brut/voix/voix.log", "a", encoding="utf-8")


def log(m):
    m = f"[{time.strftime('%d/%m %H:%M:%S')}] {m}"
    print(m, flush=True); journal.write(m + "\n"); journal.flush()


n = sys.argv[sys.argv.index("--noeud") + 1] if "--noeud" in sys.argv else noeuds.choisir("voix", OUTILS["voicestudio"])
log(f"voix de Fanny : nœud {n}")
code = 1
with tache("fanny-pinball : voix de Fanny (demucs + VoiceStudio)", OUTILS["voicestudio"], service="VoiceStudio", noeud=n):
    decharger_ollama(n=n)
    if not noeuds.vs_demarrer(n):
        raise SystemExit(f"VoiceStudio ne démarre pas sur {n}")
    log(f"VoiceStudio prêt sur {n}")
    argv = [noeuds.CONF["python"], f"{ICI}/outils/voix_fanny_noeud.py"] + (["--refaire"] if "--refaire" in sys.argv else [])
    p = subprocess.Popen(noeuds.commande(n, argv, ICI, {"PYTHONUNBUFFERED": "1"}), stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, stdin=subprocess.DEVNULL)
    try:
        for l in p.stdout:
            if l.strip():
                log(l.rstrip("\r\n"))
        code = p.wait()
    finally:
        if p.poll() is None:
            p.terminate()
        log(f"arrêt de VoiceStudio sur {n} : {noeuds.vs_arreter(n) or 'rien'}")
log(f"fin (code {code})")
sys.exit(code)
