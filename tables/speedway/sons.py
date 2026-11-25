#!/usr/bin/env python3
"""Bruitages « Speedway » par synthèse (sans IA, numpy seul) : speedway/sons/<nom>.wav, 44,1 kHz mono.

Mêmes noms que les sons neutres du moteur (moteur/sons.py) : le générateur les remplace par ceux-ci.
Modèles :
- moteur : monocylindre 4 temps au méthanol, une explosion tous les deux tours (f = tr/min / 120) ; chaque
  explosion = bouffée de bruit + choc grave, passée dans la résonance de l'échappement (deux filtres en bande) ;
  le régime suit une courbe (ralenti, coup de gaz, passage en dérapage, coupure) ; effet Doppler pour le passage ;
- schiste : grêle de petits clics (graviers) sur un souffle filtré ;
- public : une centaine de voix de bruit filtré dans les formants, modulées au hasard, enveloppe d'acclamation ;
- ruban de départ : claquement élastique ; sifflet du juge, sirène, klaxon.

    python3 sons.py
"""
import os, wave
import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sons')
rng = np.random.default_rng(1928)          # 1928 : premières courses de speedway en Angleterre


def t_(d):
    return np.arange(int(SR * d)) / SR


def passe_bande(x, f0, q):
    """filtre résonant du 2e ordre (biquad passe-bande)"""
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = np.array([al, 0, -al]) / (1 + al)
    a = np.array([1, -2 * np.cos(w) / (1 + al), (1 - al) / (1 + al)])
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def passe_bas(x, k):
    y = np.empty_like(x); a = 0.0
    for i, v in enumerate(x):
        a += k * (v - a); y[i] = a
    return y


def moteur(rpm, d, rugosite=0.5):
    """rpm : fonction du temps (s) → tr/min ; d : durée"""
    n = int(SR * d)
    t = np.arange(n) / SR
    r = np.array([rpm(x) for x in t])
    phase = np.cumsum(r / 120.0) / SR                  # nombre d'explosions
    x = np.zeros(n)
    k_prec = -1
    for i in range(n):
        k = int(phase[i])
        if k != k_prec:
            k_prec = k
            L = int(SR * 0.012)
            j = np.arange(min(L, n - i))
            boum = np.exp(-j / (SR * 0.0025)) * (rng.uniform(-1, 1, len(j)) * rugosite + np.sin(2 * np.pi * 95 * j / SR))
            x[i:i + len(j)] += boum * rng.uniform(0.8, 1.2)
    e = passe_bande(x, 180, 1.5) + 0.7 * passe_bande(x, 620, 2.5) + 0.25 * passe_bande(x, 1900, 3)
    return e


def doppler(x, v=0.25):
    """passage devant le micro : hauteur qui baisse, volume en cloche"""
    n = len(x); t = np.linspace(-1, 1, n)
    vitesse = 1 + v * (-np.tanh(3 * t))
    pos = np.clip(np.cumsum(vitesse) * (n - 1) / np.sum(vitesse), 0, n - 1)
    y = np.interp(pos, np.arange(n), x)
    return y / (1 + 6 * t * t)


def schiste(d, densite=900, souffle=0.4):
    n = int(SR * d)
    x = passe_bas(rng.uniform(-1, 1, n), 0.15) * souffle
    for _ in range(int(densite * d)):
        i = rng.integers(0, n - 200); L = rng.integers(30, 160)
        x[i:i + L] += rng.uniform(-1, 1, L) * np.exp(-np.arange(L) / 25) * rng.uniform(0.2, 1)
    env = np.minimum(1, np.arange(n) / (SR * 0.02)) * np.exp(-np.arange(n) / (SR * d * 0.45))
    return x * env


def public(d, acclamation=1.0, n_voix=90):
    n = int(SR * d)
    t = np.arange(n) / SR
    x = np.zeros(n)
    base = rng.uniform(-1, 1, n)
    for k in range(n_voix):
        f = rng.choice([500, 700, 900, 1200, 1600, 2400]) * rng.uniform(0.85, 1.15)
        m = 0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(1, 5) * t + rng.uniform(0, 6))
        decale = np.roll(base, rng.integers(0, n))
        x += passe_bande(decale[:: 1], f, 4)[:n] * m
        if k > n_voix * 0.25 and acclamation < 0.5:
            break
    env = np.minimum(1, t / (0.15 + 0.3 * (1 - acclamation))) * np.minimum(1, (d - t) / (0.4 * d))
    return x * env


def ruban(d=0.25):
    t = t_(d)
    return np.sin(2 * np.pi * (300 + 900 * np.exp(-t * 30)) * t) * np.exp(-t * 18) + schiste(d, 300, 0.1) * 0.5


def sifflet(d=0.6):
    t = t_(d)
    f = 2900 + 120 * np.sin(2 * np.pi * 38 * t)        # roulement de la bille du sifflet
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.05)


def sirene(d=1.6):
    t = t_(d)
    f = 650 + 350 * (0.5 - 0.5 * np.cos(2 * np.pi * t / 0.8))
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.5
    return passe_bas(x, 0.25)


def klaxon(d=0.5):
    t = t_(d)
    x = np.sign(np.sin(2 * np.pi * 420 * t)) + 0.6 * np.sign(np.sin(2 * np.pi * 528 * t))
    return passe_bas(x, 0.2) * np.minimum(1, t / 0.01) * np.minimum(1, (d - t) / 0.03)


def mix(*xs):
    n = max(len(x) for x in xs)
    return sum(np.pad(x, (0, n - len(x))) for x in xs)


def apres(s, x):
    return np.concatenate([np.zeros(int(SR * s)), x])


def courbe(*pts):
    """régime par points (temps s, tr/min), interpolé"""
    ts, rs = zip(*pts)
    return lambda x: float(np.interp(x, ts, rs))


def norm(x, g=1.0):
    return x / max(1e-9, np.abs(x).max()) * g


SONS = {
    'bumper': lambda: norm(moteur(courbe((0, 4000), (0.08, 9500), (0.3, 5000)), 0.35)),
    'lance_pierre': lambda: norm(mix(schiste(0.35, 1400, 0.3), 0.4 * moteur(courbe((0, 7000), (0.3, 8500)), 0.3))),
    'cible': lambda: norm(ruban(0.25)),
    'couloir': lambda: norm(doppler(moteur(courbe((0, 8500), (0.6, 8800)), 0.6), 0.2)),
    'couloirs_faits': lambda: norm(mix(public(1.4, 1), apres(0.1, 0.5 * klaxon(0.4)))),
    'rampe': lambda: norm(mix(doppler(moteur(courbe((0, 7500), (0.5, 9800), (1.2, 9000)), 1.2), 0.3),
                              apres(0.3, 0.5 * schiste(0.8, 1600, 0.4)))),
    'tourniquet': lambda: norm(moteur(courbe((0, 6000), (0.06, 6000)), 0.06)) * 0.6,
    'jackpot': lambda: norm(mix(public(2.2, 1), apres(0.05, 0.6 * klaxon(0.5)), apres(0.7, 0.6 * klaxon(0.5)))),
    'multiball': lambda: norm(mix(*[apres(0.15 * k, moteur(courbe((0, 3000), (0.8, 9000), (1.2, 7000), (2.6, 9800)), 2.6))
                                    for k in range(4)], apres(1.2, ruban(0.3)), apres(1.4, 0.6 * public(1.6, 1)))),
    'extra': lambda: norm(mix(klaxon(0.35), apres(0.45, klaxon(0.6)), apres(0.2, 0.7 * public(1.6, 1)))),
    'drain': lambda: norm(mix(moteur(courbe((0, 9000), (0.25, 7000), (0.6, 1500), (1.0, 0)), 1.0),
                              apres(0.2, 0.5 * public(1.3, 0.3)))),
    'depart': lambda: norm(mix(moteur(courbe((0, 1500), (0.4, 1500), (0.7, 8000), (1.1, 4000), (1.4, 9500)), 1.8),
                               apres(1.3, ruban(0.3)))),
    'tilt': lambda: norm(sirene(1.6)),
    'alerte': lambda: norm(sifflet(0.5)),
    'lancement': lambda: norm(mix(moteur(courbe((0, 2500), (0.15, 9800), (0.6, 8500)), 0.6), schiste(0.5, 1000, 0.3))),
    'combo': lambda: norm(mix(schiste(0.6, 1800, 0.5), moteur(courbe((0, 9800), (0.6, 8200)), 0.6))),
    'mode': lambda: norm(mix(klaxon(0.25), apres(0.3, klaxon(0.25)), apres(0.6, klaxon(0.5)))),
    'record': lambda: norm(mix(public(3.0, 1), apres(0.2, klaxon(0.8)))),
    'fin': lambda: norm(mix(moteur(courbe((0, 6000), (1.5, 1500), (2.5, 1200)), 2.5), apres(0.2, 0.6 * public(2.0, 0.6)))),
    'balle_rendue': lambda: norm(mix(sifflet(0.3), apres(0.35, moteur(courbe((0, 2000), (0.2, 8000), (0.7, 7000)), 0.7)))),
    'banque': lambda: norm(public(1.2, 1)),
}


def ecrire(nom, x):
    x = np.clip(norm(x, 0.85), -1, 1)
    with wave.open(os.path.join(OUT, nom + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for nom, f in SONS.items():
        ecrire(nom, f())
        print(nom, flush=True)
    print(f'{len(SONS)} bruitages → {OUT}')
