# Fanny Pinball — manette USB : RP2040-Zero sous CircuitPython (7.x ou plus), 2 boutons d'arcade (+ lanceur facultatif),
# MPU-6050. Même comportement que ../fanny_rp2040.ino (version Arduino). À copier en code.py sur le disque CIRCUITPY ;
# nécessite lib/adafruit_hid (bundle Adafruit).
#
#   bouton gauche (GP13) ............ Maj gauche : palette gauche ; menus : monter
#   bouton droit (GP15) ............. Maj droite : palette droite ; menus : descendre
#   bouton lanceur (GP14, facult.) .. Bas maintenu : tirer le lanceur, relâcher = lancer
# (broches réglables ci-dessous : BROCHE_GAUCHE, BROCHE_DROITE, BROCHE_LANCEUR)
#   les deux, appui bref ............ Entrée : départ ; menus : valider
#   les deux, maintenus ............. Bas maintenu : lanceur (relâcher un bouton = lancer)
#   les deux, maintenus 3 s ......... Échap : pause ; menus : retour
#   secousse (MPU-6050) ............. Espace / Ctrl gauche / Ctrl droit : bourrage frontal / latéral
#
# Câblage : boutons entre la broche et GND (tirages internes) ; GY-521 : SDA→GP4, SCL→GP5, VCC→3V3, GND→GND.
# Console série (screen /dev/ttyACM0 115200) : + / - seuil, r recalibrer, d trace, k couper le clavier, t mode test (événements écrits, rien envoyé), ? état.

import time
import struct
import board
import busio
import digitalio
import microcontroller
import supervisor
import sys
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode as K

# ---------------------------------------------------------------- réglages
REBOND_MS = 5
FENETRE_ACCORD_MS = 80
BREF_MS = 350
ECHAP_MS = 3000
# repère voulu : +X vers la droite du joueur, +Y vers l'avant ; corriger ici selon le montage du module
ECHANGER_XY, INVERSER_X, INVERSER_Y = False, False, False
SEUIL_DEFAUT, SEUIL_MIN, SEUIL_MAX = 0.55, 0.15, 2.5
RATIO_LATERAL = 1.15
PERIODE_MS, FENETRE_PIC_MS, IMPULSION_MS, TEMPS_MORT_MS = 5, 18, 30, 320
ALPHA_BASE = 0.01
MASQUE_APPUI_MS = 120          # un appui de bouton secoue la manette : pas de bourrage juste après
MAGIC = 0xFA43                 # mémoire non volatile : MAGIC (2 octets) + seuil (float)


def ms():
    return time.monotonic_ns() // 1_000_000


# ---------------------------------------------------------------- clavier
clavier = None
while clavier is None:
    try:
        clavier = Keyboard(usb_hid.devices)
    except OSError:
        time.sleep(0.5)           # l'hôte USB n'est pas encore prêt
hid = True
test = False                  # mode test (touche t) : rien n'est envoyé au PC, chaque événement est écrit sur la console
NOMS = {K.LEFT_SHIFT: "Maj gauche", K.RIGHT_SHIFT: "Maj droite", K.DOWN_ARROW: "Bas", K.ESCAPE: "Echap",
        K.ENTER: "Entree", K.SPACE: "Espace", K.LEFT_CONTROL: "Ctrl gauche", K.RIGHT_CONTROL: "Ctrl droit"}
t0_test = 0


def trace(action, k):
    print("[TEST %6.2f s] %s %s" % ((ms() - t0_test) / 1000, action, NOMS.get(k, k)))


def appuyer(k):
    if test:
        trace("appui  ", k)
        return
    if hid:
        try:
            clavier.press(k)
        except OSError:
            pass


def relacher(k):
    if test:
        trace("relache", k)
        return
    try:
        clavier.release(k)
    except OSError:
        pass


def taper(k):
    if test:
        trace("frappe ", k)
        return
    appuyer(k)
    time.sleep(0.025)
    relacher(k)


# ---------------------------------------------------------------- boutons
class Bouton:
    def __init__(self, broche):
        self.io = digitalio.DigitalInOut(broche)
        self.io.switch_to_input(pull=digitalio.Pull.UP)
        self.brut = self.etat = False
        self.maj = 0

    def lire(self, t):
        """vrai si l'état stable a changé"""
        l = not self.io.value
        if l != self.brut:
            self.brut, self.maj = l, t
        if t - self.maj >= REBOND_MS and self.etat != self.brut:
            self.etat = self.brut
            return True
        return False


BROCHE_GAUCHE, BROCHE_DROITE, BROCHE_LANCEUR = board.GP13, board.GP15, board.GP14
bg, bd, bl = Bouton(BROCHE_GAUCHE), Bouton(BROCHE_DROITE), Bouton(BROCHE_LANCEUR)

# ---------------------------------------------------------------- MPU-6050 (sans bibliothèque)
i2c, adresse = None, 0x68
try:
    i2c = busio.I2C(board.GP5, board.GP4, frequency=400_000)   # SCL, SDA
except Exception as e:                                         # pas de capteur : pas de tirage sur SDA/SCL
    print("I2C indisponible :", e)


def i2c_ecrire(reg, v):
    i2c.writeto(adresse, bytes((reg, v)))


def detecter():
    global adresse
    if i2c is None:
        return False
    while not i2c.try_lock():
        pass
    try:
        for a in (0x68, 0x69):
            try:
                tampon = bytearray(1)
                i2c.writeto_then_readfrom(a, bytes((0x75,)), tampon)
                if tampon[0] in (0x68, 0x69, 0x70, 0x71, 0x73, 0x98):
                    adresse = a
                    i2c_ecrire(0x6B, 0x00)    # réveil
                    time.sleep(0.01)
                    i2c_ecrire(0x1A, 0x03)    # passe-bas ~44 Hz
                    i2c_ecrire(0x19, 0x04)    # 200 Hz
                    i2c_ecrire(0x1C, 0x08)    # ±4 g
                    return True
            except OSError:
                pass
        return False
    finally:
        i2c.unlock()


tampon_acc = bytearray(4)


def lire_g():
    if not i2c.try_lock():
        return None
    try:
        i2c.writeto_then_readfrom(adresse, bytes((0x3B,)), tampon_acc)
    except OSError:
        return None
    finally:
        i2c.unlock()
    x, y = struct.unpack(">hh", tampon_acc)
    return x / 8192.0, y / 8192.0


capteur = detecter()
base_x = base_y = 0.0


def calibrer():
    global base_x, base_y
    if not capteur:
        return
    sx = sy = 0.0
    n = 0
    for _ in range(80):
        v = lire_g()
        if v:
            sx += v[0]
            sy += v[1]
            n += 1
        time.sleep(0.005)
    if n:
        base_x, base_y = sx / n, sy / n


def charger_seuil():
    m, s = struct.unpack("<Hf", microcontroller.nvm[0:6])
    return s if m == MAGIC and SEUIL_MIN <= s <= SEUIL_MAX else SEUIL_DEFAUT


def sauver_seuil(s):
    microcontroller.nvm[0:6] = struct.pack("<Hf", MAGIC, s)


seuil = charger_seuil()
calibrer()

# ---------------------------------------------------------------- état
LIBRE, ACCORD = 0, 1
mode = LIBRE
maj_g = maj_d = False
t_appui_g = t_appui_d = t_accord = dernier_appui = 0
lanceur = echap_envoye = False
capture = debug = False
derniere_lecture = temps_mort = fin_capture = fin_bourrage = dernier_log = 0
pic_x = pic_y = 0.0
sens = [0.0, 0.0]          # premier mouvement franc sur X et Y
touche_bourrage = None


def boutons(t):
    global maj_g, maj_d, t_appui_g, t_appui_d, dernier_appui, mode, t_accord, lanceur, echap_envoye
    cg, cd = bg.lire(t), bd.lire(t)
    if cg or cd:
        dernier_appui = t      # appui comme relâchement : le choc du bouton n'est pas un bourrage
    if cg and bg.etat:
        t_appui_g = t
    if cd and bd.etat:
        t_appui_d = t
    # bouton de lanceur : Bas tant qu'il est enfoncé (l'accord ne relâche Bas que s'il l'a envoyé)
    if bl.lire(t):
        dernier_appui = t
        if bl.etat:
            if not lanceur:
                appuyer(K.DOWN_ARROW)
        elif not lanceur:
            relacher(K.DOWN_ARROW)
    # les palettes suivent toujours les boutons, accord ou non
    if bg.etat != maj_g:
        (appuyer if bg.etat else relacher)(K.LEFT_SHIFT)
        maj_g = bg.etat
    if bd.etat != maj_d:
        (appuyer if bd.etat else relacher)(K.RIGHT_SHIFT)
        maj_d = bd.etat

    if mode == LIBRE:
        if bg.etat and bd.etat and ((cg and t - t_appui_d < FENETRE_ACCORD_MS) or (cd and t - t_appui_g < FENETRE_ACCORD_MS)):
            mode, t_accord, lanceur, echap_envoye = ACCORD, t, False, False
        return
    duree = t - t_accord
    if bg.etat and bd.etat:
        if not lanceur and not echap_envoye and duree >= BREF_MS:
            appuyer(K.DOWN_ARROW)
            lanceur = True
        if not echap_envoye and duree >= ECHAP_MS:
            taper(K.ESCAPE)
            if lanceur:
                relacher(K.DOWN_ARROW)
                lanceur = False
            echap_envoye = True
        return
    # un bouton relâché : fin de l'accord
    if lanceur:
        relacher(K.DOWN_ARROW)
        lanceur = False
    elif not echap_envoye and duree < BREF_MS:
        taper(K.ENTER)
    mode = LIBRE


def bourrer(x, y, t):
    global touche_bourrage, fin_bourrage, temps_mort
    if abs(x) > abs(y) * RATIO_LATERAL:
        k, nom = (K.RIGHT_CONTROL, "droit") if x > 0 else (K.LEFT_CONTROL, "gauche")
    else:
        k, nom = K.SPACE, "frontal"
    if touche_bourrage is not None:
        relacher(touche_bourrage)
    appuyer(k)
    touche_bourrage, fin_bourrage, temps_mort = k, t + IMPULSION_MS, t + TEMPS_MORT_MS
    if debug or test:
        print("[BOURRAGE] %s (X %+.2f g, Y %+.2f g ; premier mouvement X %+.2f, Y %+.2f)" % (nom, x, y, sens[0], sens[1]))


def accelerometre(t):
    global touche_bourrage, derniere_lecture, base_x, base_y, dernier_log, capture, fin_capture, pic_x, pic_y
    if touche_bourrage is not None and t >= fin_bourrage:
        relacher(touche_bourrage)
        touche_bourrage = None
    if not capteur or t - derniere_lecture < PERIODE_MS:
        return
    derniere_lecture = t
    v = lire_g()
    if not v:
        return
    ax, ay = v
    dx, dy = ax - base_x, ay - base_y
    if ECHANGER_XY:
        dx, dy = dy, dx
    if INVERSER_X:
        dx = -dx
    if INVERSER_Y:
        dy = -dy
    m = (dx * dx + dy * dy) ** 0.5
    if not capture and m < seuil * 0.5:
        base_x += ALPHA_BASE * (ax - base_x)
        base_y += ALPHA_BASE * (ay - base_y)
    if debug and t - dernier_log >= 80:
        dernier_log = t
        print("dX=%.2f dY=%.2f |a|=%.2f seuil=%.2f" % (dx, dy, m, seuil))
    if t < temps_mort or t - dernier_appui < MASQUE_APPUI_MS:
        capture = False
        return
    # l'axe vient du pic de la fenêtre ; le sens vient du PREMIER mouvement (l'arrêt d'une secousse à la main est
    # plus brutal que son départ et donnerait le sens inverse)
    if not capture:
        if m >= seuil:
            capture, fin_capture, pic_x, pic_y = True, t + FENETRE_PIC_MS, dx, dy
            sens[0] = dx if abs(dx) >= seuil * 0.5 else 0.0
            sens[1] = dy if abs(dy) >= seuil * 0.5 else 0.0
    else:
        if abs(dx) > abs(pic_x):
            pic_x = dx
        if abs(dy) > abs(pic_y):
            pic_y = dy
        if sens[0] == 0.0 and abs(dx) >= seuil * 0.5:
            sens[0] = dx
        if sens[1] == 0.0 and abs(dy) >= seuil * 0.5:
            sens[1] = dy
        if t >= fin_capture:
            capture = False
            bourrer(abs(pic_x) * (1 if sens[0] >= 0 else -1), abs(pic_y) * (1 if sens[1] >= 0 else -1), t)


def etat():
    print("Fanny Pinball — manette RP2040-Zero (CircuitPython)")
    print("  MPU-6050 : %s (0x%02X), seuil %.2f g, clavier %s" % ("présent" if capteur else "ABSENT", adresse, seuil, "actif" if hid else "coupé"))
    print("  + / - sensibilité, r recalibrer (manette immobile), d trace, k clavier, t mode test, ? état")


def serie():
    global seuil, debug, hid, test, t0_test
    while supervisor.runtime.serial_bytes_available:
        c = sys.stdin.read(1)
        if c in "+-":
            seuil = min(SEUIL_MAX, max(SEUIL_MIN, seuil + (0.05 if c == "+" else -0.05)))
            sauver_seuil(seuil)
            print("seuil %.2f g" % seuil)
        elif c == "r":
            calibrer()
            print("calibré")
        elif c == "d":
            debug = not debug
        elif c == "k":
            hid = not hid
            if not hid:
                clavier.release_all()
            print("clavier actif" if hid else "clavier coupé")
        elif c == "t":
            test = not test
            t0_test = ms()
            clavier.release_all()
            print("MODE TEST : aucune touche envoyée au PC" if test else "mode test terminé : clavier actif")
        elif c == "?":
            etat()


etat()
while True:
    t = ms()
    boutons(t)
    accelerometre(t)
    serie()
