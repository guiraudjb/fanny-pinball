#!/usr/bin/env python3
# Usage : python3 controleur/fanny_rp2040/circuitpython/test_manette.py [durée en s]
# Attend la manette RP2040-Zero, installe code.py (avec mode test), vérifie le MPU-6050, puis enregistre la console
# en mode test pendant DUREE secondes (aucune touche envoyée au PC).
import os, shutil, sys, time, tty

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "code.py")
DISQUE = os.path.join("/media", os.environ.get("USER", ""), "CIRCUITPY")
PORT = "/dev/ttyACM0"
DUREE = float(sys.argv[1]) if len(sys.argv) > 1 else 180


def dire(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


t = time.time()
while not (os.path.isdir(DISQUE) and os.path.exists(PORT)):
    if time.time() - t > 900:
        dire("manette non branchée après 15 min"); sys.exit(1)
    time.sleep(0.5)
dire("manette branchée")
time.sleep(1.5)
dest = os.path.join(DISQUE, "code.py")
if open(SRC, "rb").read() != open(dest, "rb").read():
    shutil.copyfile(SRC, dest)
    os.sync()
    dire("code.py installé")

fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
tty.setraw(fd)


def lire(d):
    out = b""; t = time.time()
    while time.time() - t < d:
        try:
            out += os.read(fd, 4096)
        except BlockingIOError:
            time.sleep(0.02)
    return out.decode("utf-8", "replace")


time.sleep(1)
os.write(fd, b"\x03"); lire(0.8)
os.write(fd, b"\x04")                       # relance propre : détection du MPU-6050 au démarrage
print(lire(4.0), flush=True)
os.write(fd, b"t")
dire("MODE TEST pendant %d s — faire les gestes (Ctrl-C pour arrêter)" % DUREE)
fin = time.time() + DUREE
try:
    while time.time() < fin:
        s = lire(0.5)
        if s:
            print(s, end="", flush=True)
except KeyboardInterrupt:
    pass
os.write(fd, b"t")
print(lire(1.0), flush=True)
dire("fin du test")
