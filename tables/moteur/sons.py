#!/usr/bin/env python3
"""Sons neutres des tables vierges, synthétisés (aucun enregistrement) : moteur/sons/<nom>.wav, 22 050 Hz mono 16 bits.

Le script les joue par leur nom (Son "bumper"). L'habillage d'une table pourra les remplacer par les siens sous le
même nom.
"""
import os, wave
import numpy as np

SR = 22050
ICI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ICI, 'sons')


def env(n, att=0.004, dec=0.15):
    t = np.arange(n) / SR
    return np.minimum(1, t / att) * np.exp(-t / dec)


def ton(f, d, dec=0.15, forme='sin', glisse=0.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(f * (1 + glisse * t / d)) / SR
    x = np.sin(ph) if forme == 'sin' else np.sign(np.sin(ph)) * 0.6 if forme == 'carre' else 2 * (ph / (2 * np.pi) % 1) - 1
    return x * env(n, dec=dec)


def bruit(d, dec=0.05, passe_bas=0.3):
    n = int(d * SR)
    x = np.random.default_rng(1).uniform(-1, 1, n)
    y = np.zeros(n)
    for i in range(1, n):
        y[i] = y[i - 1] + passe_bas * (x[i] - y[i - 1])
    return y / max(1e-9, np.abs(y).max()) * env(n, dec=dec)


def suite(notes, d=0.09, forme='carre', dec=0.08):
    return np.concatenate([ton(f, d, dec, forme) for f in notes])


def mix(*xs):
    n = max(len(x) for x in xs)
    return sum(np.pad(x, (0, n - len(x))) for x in xs)


SONS = {
    'bumper': lambda: mix(ton(180, 0.18, 0.05, 'carre', -0.4), 0.6 * bruit(0.1, 0.02, 0.5)),
    'lance_pierre': lambda: mix(ton(120, 0.12, 0.04, 'carre', -0.3), 0.8 * bruit(0.08, 0.02, 0.6)),
    'palette': lambda: 0.7 * bruit(0.07, 0.015, 0.35),
    'cible': lambda: mix(ton(880, 0.1, 0.03), 0.4 * bruit(0.05, 0.01, 0.7)),
    'tombante': lambda: mix(ton(330, 0.15, 0.05, 'scie', -0.5), 0.5 * bruit(0.08, 0.02)),
    'banque': lambda: suite([523, 659, 784, 1047], 0.08),
    'couloir': lambda: ton(1320, 0.12, 0.05),
    'couloirs_faits': lambda: suite([784, 988, 1175, 1568], 0.07),
    'rampe': lambda: ton(400, 0.5, 0.3, 'scie', 1.2) * 0.7,
    'trou': lambda: mix(ton(90, 0.25, 0.1, 'carre'), 0.6 * bruit(0.12, 0.04, 0.2)),
    'ejection': lambda: mix(ton(140, 0.15, 0.05, 'carre', -0.5), 0.7 * bruit(0.08, 0.02, 0.5)),
    'tourniquet': lambda: ton(2200, 0.03, 0.01, 'carre') * 0.5,
    'jackpot': lambda: suite([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.08),
    'multiball': lambda: suite([392, 523, 659, 784, 659, 784, 1047, 1319], 0.1, 'scie'),
    'extra': lambda: suite([659, 880, 1109, 1319, 1760], 0.12, 'sin', 0.15),
    'drain': lambda: ton(220, 0.9, 0.4, 'scie', -0.6),
    'depart': lambda: suite([392, 523, 659, 784], 0.12, 'carre', 0.12),
    'bonus': lambda: ton(1046, 0.05, 0.02, 'carre') * 0.6,
    'tilt': lambda: ton(110, 1.2, 0.8, 'carre') * 0.8,
    'alerte': lambda: suite([880, 0.01, 880], 0.12, 'carre', 0.06),
    'credit': lambda: ton(1568, 0.25, 0.1),
    'clac': lambda: mix(bruit(0.08, 0.01, 0.9), ton(2600, 0.06, 0.02, 'carre')),
    'lancement': lambda: 0.8 * bruit(0.25, 0.08, 0.15),
    'combo': lambda: suite([784, 1175, 1568], 0.07, 'sin', 0.1),
    'mode': lambda: suite([330, 392, 494, 659], 0.14, 'scie', 0.14),
    'chrono': lambda: ton(1760, 0.06, 0.02, 'carre') * 0.6,
    'record': lambda: suite([523, 659, 784, 1047, 1319, 1568, 2093], 0.1),
    'fin': lambda: suite([523, 392, 330, 262], 0.18, 'sin', 0.2),
    'balle_rendue': lambda: suite([659, 784, 659, 784], 0.08, 'sin', 0.08),
}


def ecrire(nom, x):
    x = np.clip(x / max(1e-9, np.abs(x).max()) * 0.8, -1, 1)
    with wave.open(os.path.join(OUT, nom + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for nom, f in SONS.items():
        ecrire(nom, f())
    print(f'{len(SONS)} sons → {OUT}')
