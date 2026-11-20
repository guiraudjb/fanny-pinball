#!/usr/bin/env python3
"""Bruitages de la table par synthèse physique (sans IA, numpy seul).

Chaque son est un modèle simple de l'objet réel :
- boule d'acier qui en frappe une autre : modes de flexion inharmoniques d'une sphère pleine, très amortis ;
- carillons des flippers des années 70 (Gottlieb 10 / 100 / 1000 points) : barre métallique frappée,
  partiels 1 : 2,76 : 5,40 : 8,93 ;
- bobines (flipper, bumper, lance-pierre, « knocker » de partie gratuite) : choc sourd dans le bois de la
  caisse (mode grave amorti) + claquement métallique du plongeur ;
- bois (cochonnet) : modes de poutre courte, amortissement rapide ;
- roulement de la bille sur la rampe en fil : bruit filtré modulé par la rotation.

Sortie : assets/sons/00NN.mp3, NN = numéro SND de js/rules.js = piste du DFPlayer.

    python3 outils/bruitages.py
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "assets" / "sons"
rng = np.random.default_rng(1975)


def t_(d):
    return np.arange(int(SR * d)) / SR


def modes(freqs, amps, decays, d, jitter=0.0):
    t = t_(d)
    s = np.zeros_like(t)
    for f, a, k in zip(freqs, amps, decays):
        f = f * (1 + rng.uniform(-jitter, jitter))
        s += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / k)
    return s


def bruit(d, couleur=0.0):
    n = rng.standard_normal(int(SR * d))
    if couleur:                       # passe-bas à un pôle : 0 = blanc, 0.98 = sourd
        y = np.zeros_like(n); acc = 0.0
        for i, v in enumerate(n):
            acc = couleur * acc + (1 - couleur) * v; y[i] = acc
        n = y / (np.abs(y).max() + 1e-9)
    return n


def env(d, att=0.001, dec=0.05):
    t = t_(d)
    return np.minimum(t / att, 1) * np.exp(-t / dec)


def place(piste, son, a, gain=1.0):
    i = int(a * SR)
    fin = min(len(piste), i + len(son))
    piste[i:fin] += gain * son[:fin - i]


def piste(d):
    return np.zeros(int(SR * d))


# ------------------------------------------------------------------ briques
def clac_boules(force=1.0, d=0.35):
    """Deux boules d'acier qui se choquent (le « carreau »)."""
    f0 = rng.uniform(2900, 3300)
    s = modes([f0, f0 * 1.71, f0 * 2.58, f0 * 3.44, f0 * 4.9], [1, .7, .5, .35, .2],
              [.06, .045, .03, .02, .012], d, jitter=.02)
    clic = bruit(0.004) * env(0.004, 0.0002, 0.0015)
    s[:len(clic)] += 1.2 * clic
    return force * s


def carillon(f, d=1.6, force=1.0):
    """Barre de carillon frappée par un marteau à bobine."""
    s = modes([f, f * 2.76, f * 5.40, f * 8.93], [1, .55, .3, .12], [d * .45, d * .25, d * .12, d * .06], d)
    marteau = bruit(0.01, 0.6) * env(0.01, 0.0003, 0.003)
    s[:len(marteau)] += .6 * marteau
    return force * s


C10, C100, C1000 = 1046.5, 784.0, 523.25          # do, sol, do grave : les trois carillons


def bobine(force=1.0, grave=90, d=0.18):
    """Bobine qui tire : choc sourd dans la caisse + claquement du plongeur."""
    s = modes([grave, grave * 2.3, grave * 4.1], [1, .4, .2], [.05, .03, .015], d)
    s += .5 * bruit(d, 0.85) * env(d, 0.0005, 0.02)
    s += .35 * modes([1800, 2700, 4100], [1, .6, .3], [.01, .008, .005], d)
    return force * s


def bois(f=900, d=0.15, force=1.0):
    """Cochonnet en bois frappé par la bille."""
    s = modes([f, f * 2.6, f * 5.1], [1, .5, .2], [.025, .012, .006], d, jitter=.03)
    s += .3 * bruit(d, .5) * env(d, .0003, .004)
    return force * s


def roulement(d=1.0, monte=True):
    """Bille qui roule sur la rampe en fil d'acier."""
    t = t_(d)
    n = bruit(d, 0.7)
    vitesse = np.linspace(1, .55, len(t)) if monte else np.linspace(.6, 1, len(t))
    rot = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(28 * vitesse) / SR)
    chant = np.sin(2 * np.pi * np.cumsum(1900 * vitesse) / SR) * .15
    e = np.minimum(t / .05, 1) * np.minimum((d - t) / .1, 1)
    return (n * (.6 + .4 * rot) + chant) * e * vitesse


def gravier(d=0.4):
    """Boule qui atterrit dans le gravier (le Cercle, l'évacuation)."""
    s = piste(d)
    for k in range(int(25 * d) + 6):
        a = rng.uniform(0, d * .8)
        g = bruit(.01, .3) * env(.01, .0002, .002 + rng.uniform(0, .003))
        place(s, g, a, rng.uniform(.1, .5) * np.exp(-a / (d * .4)))
    return s


# ------------------------------------------------------------------ sons du jeu
def S_START():
    p = piste(2.0)
    place(p, bobine(.8), 0)
    for i, f in enumerate([C1000, C100, C10, C1000 * 2]):
        place(p, carillon(f, 1.4, .7), .12 + i * .16)
    return p


def S_BUMPER():
    p = piste(.4)
    place(p, bobine(1.0, 110), 0)
    place(p, clac_boules(.55), .004)
    place(p, carillon(C10, .6, .35), .01)
    return p


def S_SLING():
    p = piste(.3)
    place(p, bobine(.8, 140, .2), 0)
    place(p, bruit(.06, .4) * env(.06, .0005, .012), 0, .6)    # caoutchouc qui claque
    return p


def S_FLIP():
    p = piste(.2)
    place(p, bobine(.6, 75, .16), 0)
    return p


def S_DROP():
    p = piste(.3)
    place(p, bois(1500, .12, .7), 0)
    place(p, bobine(.35, 160, .12), .025)
    return p


def S_DROPS_DONE():
    p = piste(1.8)
    place(p, bobine(1.0, 85), 0)
    for i in range(3):
        place(p, carillon(C100, 1.2, .8), .1 + i * .12)
    return p


def S_RAMP():
    p = piste(1.3)
    place(p, roulement(1.1), 0, .7)
    place(p, carillon(C10, 1.0, .5), 1.0)
    return p


def S_LANE():
    p = piste(.9)
    place(p, modes([2400, 3900], [1, .5], [.01, .006], .05), 0, .4)   # fil du contact
    place(p, carillon(C10, .9, .7), .005)
    return p


def S_LANES_DONE():
    p = piste(1.8)
    for i, f in enumerate([C1000, C100, C10]):
        place(p, carillon(f, 1.4, .8), i * .14)
    return p


def S_STANDUP():
    p = piste(.3)
    place(p, bois(820, .2, 1.0), 0)
    return p


def S_SAUCER():
    p = piste(.8)
    place(p, gravier(.5), 0, .8)
    place(p, bobine(.7, 70, .25), .05)
    return p


def S_MULTIBALL():
    p = piste(2.6)
    for i in range(6):
        place(p, clac_boules(.7), i * .09)
    for i, f in enumerate([C1000, C100, C10, C100, C10, C10 * 2]):
        place(p, carillon(f, 1.3, .7), .55 + i * .13)
    return p


def S_JACKPOT():
    p = piste(2.4)
    place(p, clac_boules(1.0, .6), 0)          # le carreau !
    place(p, clac_boules(.6), .18)
    for i in range(8):
        place(p, carillon([C10, C100][i % 2], 1.0, .6), .3 + i * .1)
    return p


def S_CITY():
    p = piste(1.4)
    place(p, carillon(C100, 1.2, .8), 0)
    place(p, carillon(C10, 1.2, .8), .15)
    return p


def S_GRAND_CHELEM():
    p = piste(3.5)
    place(p, knocker(), 0)
    for i in range(14):
        place(p, carillon([C1000, C100, C10][i % 3], 1.4, .65), .2 + i * .1)
    return p


def knocker():
    """Le « knocker » : bobine qui frappe la caisse quand on gagne une partie."""
    return bobine(1.3, 55, .35) + .6 * modes([140, 330], [1, .4], [.08, .04], .35)


def S_EXTRA():
    p = piste(1.0)
    place(p, knocker(), 0)
    return p


def S_BALL_SAVE():
    p = piste(1.4)
    place(p, carillon(C10, 1.0, .7), 0)
    place(p, carillon(C10 * 1.5, 1.0, .7), .12)
    place(p, bobine(.6, 90), .3)
    return p


def S_DRAIN():
    p = piste(1.0)
    place(p, gravier(.4), 0, .6)
    place(p, bois(300, .3, .8), .15)
    return p


def S_BONUS():
    p = piste(.8)
    place(p, carillon(C1000, .8, .8), 0)
    return p


def S_GAME_OVER():
    p = piste(2.6)
    for i, f in enumerate([C10, C100, C1000]):
        place(p, carillon(f, 1.6, .7), i * .35)
    place(p, bobine(.8, 60, .3), 1.2)
    return p


def S_LAUNCH():
    p = piste(1.0)
    place(p, bobine(1.0, 80, .2), 0)
    place(p, roulement(.8, monte=False), .03, .5)
    return p


def S_CLAC():
    """Le CLAC : le knocker frappe la caisse en bois — partie gratuite."""
    p = piste(1.2)
    place(p, knocker(), 0, 1.3)
    place(p, bois(220, .4, .9), .004)
    return p


def S_MATCH():
    """Tirage du match : les rouleaux du compteur défilent (cliquetis de relais) puis s'arrêtent."""
    p = piste(2.8)
    t, k = 0.0, 0
    while t < 2.45:
        place(p, bois(1400 + 90 * (k % 5), .05, .5), t, .6)
        t += .06 + .1 * (t / 2.45) ** 2; k += 1
    place(p, bobine(.9, 70, .25), 2.5)
    return p


SND = ["START", "BUMPER", "SLING", "FLIP", "DROP", "DROPS_DONE", "RAMP", "LANE", "LANES_DONE", "STANDUP",
       "SAUCER", "MULTIBALL", "JACKPOT", "CITY", "GRAND_CHELEM", "EXTRA", "BALL_SAVE", "DRAIN", "BONUS",
       "GAME_OVER", "LAUNCH"]


def ecrire(n, s):
    s = s / (np.abs(s).max() + 1e-9) * 0.89
    # petite réverbération de caisse en bois (deux échos courts)
    r = s.copy()
    for dl, g in ((0.011, .18), (0.023, .1)):
        k = int(dl * SR); r[k:] += g * s[:-k]
    r = r / (np.abs(r).max() + 1e-9) * 0.89
    wav = OUT / f"{n:04d}.wav"
    pcm = (r * 32767).astype("<i2").tobytes()
    import wave
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame",
                    "-b:a", "128k", str(OUT / f"{n:04d}.mp3")], check=True)
    wav.unlink()


EXTRA = {45: "CLAC", 46: "MATCH"}    # pistes ajoutées après les voix (24-44)


def main():
    """python3 outils/bruitages.py [NOM …]   (sans argument : toutes les pistes)"""
    OUT.mkdir(parents=True, exist_ok=True)
    noms = set(sys.argv[1:])
    for i, nom in [*enumerate(SND, 1), *EXTRA.items()]:
        if noms and nom not in noms:
            continue
        ecrire(i, globals()[f"S_{nom}"]())
        print(f"{i:04d}.mp3  {nom}")


if __name__ == "__main__":
    main()
