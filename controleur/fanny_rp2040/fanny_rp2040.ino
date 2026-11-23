/*
 * Fanny Pinball — manette USB minimale : Waveshare RP2040-Zero + 2 boutons d'arcade + MPU-6050 (GY-521)
 *
 * Le RP2040-Zero se présente comme un clavier USB (aucun pilote). Avec deux boutons seulement, les fonctions
 * de service passent par des accords (les deux boutons ensemble) :
 *
 *   bouton gauche seul ........................ Maj gauche  : palette gauche ; dans les menus, monter
 *   bouton droit seul ......................... Maj droite  : palette droite ; dans les menus, descendre
 *   les deux, appui bref (< 0,35 s) ........... Entrée      : départ de partie ; dans les menus, valider
 *   bouton de lanceur (facultatif, GP13) ...... Bas maintenu : tirer le lanceur, relâcher = lancer
 *   les deux, maintenus ....................... Bas maintenu : tirer le lanceur ; relâcher un bouton = lancer
 *                                               (la force dépend de la durée, pleine puissance vers 1,25 s)
 *   les deux, maintenus 3 s ................... Échap       : pause en partie, retour dans les menus
 *                                               (le lanceur est relâché sans tirer : le jeu ignore ce relâchement)
 *   secousse de la manette (MPU-6050) ......... Espace / Ctrl gauche / Ctrl droit : bourrage frontal / latéral
 *
 * Les palettes suivent toujours les boutons, sans retard ajouté, même pendant un accord : lever les deux palettes
 * reste un geste de jeu. L'accord (second bouton moins de 80 ms après le premier) ajoute seulement Entrée, Bas ou
 * Échap. Un double coup de palette bref envoie donc Entrée, sans effet en cours de partie.
 *
 * Câblage (aucune résistance : tirages internes) :
 *   GP14 ── bouton gauche ── GND        GP15 ── bouton droit ── GND
 *   GP13 ── bouton de lanceur ── GND (facultatif : sans lui, l'accord maintenu tire le lanceur)
 *   GP4 ── SDA du GY-521                GP5 ── SCL du GY-521
 *   3V3 ── VCC du GY-521                GND ── GND du GY-521 (AD0 en l'air ou à GND : adresse 0x68)
 *
 * Environnement : IDE Arduino ou arduino-cli avec le cœur « Raspberry Pi Pico/RP2040 » d'Earle Philhower
 *   (https://github.com/earlephilhower/arduino-pico), carte « Waveshare RP2040 Zero », pile USB « Pico SDK ».
 *   Bibliothèques : uniquement celles du cœur (Wire, Keyboard, EEPROM).
 * Moniteur série (115200) : + / - sensibilité, r recalibrer, d trace de l'accéléromètre, k couper le clavier, ? état.
 */

#include <Wire.h>
#include <Keyboard.h>
#include <EEPROM.h>
#include <math.h>

// ---------------------------------------------------------------------------- brochage
const uint8_t PIN_G = 14, PIN_D = 15, PIN_LANCEUR = 13, PIN_SDA = 4, PIN_SCL = 5;   // GP13 : bouton de lanceur facultatif

// ---------------------------------------------------------------------------- accords
const uint16_t REBOND_MS        = 5;     // anti-rebond des boutons
const uint16_t FENETRE_ACCORD_MS = 80;   // écart maximal entre les deux appuis d'un accord
const uint16_t BREF_MS          = 350;   // en dessous : Entrée ; au-delà : lanceur
const uint16_t ECHAP_MS         = 3000;  // maintien pour Échap

// ---------------------------------------------------------------------------- bourrage
// Repère voulu : +X vers la droite du joueur, +Y vers l'avant (vers l'écran). Ajuster selon le montage du module.
const bool ECHANGER_XY = false, INVERSER_X = false, INVERSER_Y = false;
const float SEUIL_G_DEFAUT = 0.55f, SEUIL_G_MIN = 0.15f, SEUIL_G_MAX = 2.5f;
const float RATIO_LATERAL = 1.15f;       // |X| > |Y|·ratio : bourrage latéral, sinon frontal
const uint16_t PERIODE_MS = 5, FENETRE_PIC_MS = 18, IMPULSION_MS = 30, TEMPS_MORT_MS = 320;
const float ALPHA_BASE = 0.01f;
// les appuis de boutons secouent la manette : pas de bourrage pendant ce délai après un appui
const uint16_t MASQUE_APPUI_MS = 120;

const uint16_t MAGIC = 0xFA43;
struct Config { uint16_t magic; float seuil; };

// ---------------------------------------------------------------------------- état
struct Bouton { uint8_t pin; bool brut, etat; uint32_t maj; };
Bouton bg = { PIN_G, false, false, 0 }, bd = { PIN_D, false, false, 0 }, bl = { PIN_LANCEUR, false, false, 0 };

enum Mode : uint8_t { LIBRE, ACCORD };   // ACCORD : les deux boutons enfoncés ensemble
Mode mode = LIBRE;
bool maj_g = false, maj_d = false;       // Maj envoyés
uint32_t t_appui_g = 0, t_appui_d = 0, t_accord = 0, dernier_appui = 0;
bool lanceur = false, echap_envoye = false;

float seuil = SEUIL_G_DEFAUT, base_x = 0, base_y = 0;
bool capteur = false, capture = false, debug = false, hid = true;
uint8_t adresse = 0x68;
uint32_t derniere_lecture = 0, temps_mort = 0, fin_capture = 0, fin_bourrage = 0, dernier_log = 0;
float pic_x = 0, pic_y = 0;
uint8_t touche_bourrage = 0;

// ---------------------------------------------------------------------------- clavier
void appuyer(uint8_t k) { if (hid) Keyboard.press(k); }
void relacher(uint8_t k) { Keyboard.release(k); }
void taper(uint8_t k) { appuyer(k); delay(25); relacher(k); }

// ---------------------------------------------------------------------------- MPU-6050
bool ecrire(uint8_t reg, uint8_t v) {
  Wire.beginTransmission(adresse); Wire.write(reg); Wire.write(v);
  return Wire.endTransmission() == 0;
}
bool lire1(uint8_t a, uint8_t reg, uint8_t &v) {
  Wire.beginTransmission(a); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(a, (uint8_t)1) != 1) return false;
  v = Wire.read(); return true;
}
bool detecter() {
  const uint8_t adresses[2] = { 0x68, 0x69 };
  for (uint8_t a : adresses) {
    uint8_t id = 0;
    if (lire1(a, 0x75, id) && (id == 0x68 || id == 0x69 || id == 0x70 || id == 0x71 || id == 0x73 || id == 0x98)) {
      adresse = a;
      ecrire(0x6B, 0x00); delay(10);   // réveil
      ecrire(0x1A, 0x03);              // passe-bas ~44 Hz
      ecrire(0x19, 0x04);              // 200 Hz
      ecrire(0x1C, 0x08);              // ±4 g
      return true;
    }
  }
  return false;
}
bool lireG(float &ax, float &ay) {
  Wire.beginTransmission(adresse); Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(adresse, (uint8_t)4) != 4) return false;
  uint8_t b[4];
  for (uint8_t i = 0; i < 4; i++) b[i] = Wire.read();   // lectures séquencées (ordre d'évaluation non garanti dans une expression)
  int16_t rx = (int16_t)((b[0] << 8) | b[1]);
  int16_t ry = (int16_t)((b[2] << 8) | b[3]);
  ax = rx / 8192.0f; ay = ry / 8192.0f;
  return true;
}
void calibrer() {
  if (!capteur) return;
  float sx = 0, sy = 0; int n = 0;
  for (int i = 0; i < 80; i++) { float x, y; if (lireG(x, y)) { sx += x; sy += y; n++; } delay(5); }
  if (n) { base_x = sx / n; base_y = sy / n; }
}
void charger() {
  Config c; EEPROM.get(0, c);
  seuil = (c.magic == MAGIC && isfinite(c.seuil) && c.seuil >= SEUIL_G_MIN && c.seuil <= SEUIL_G_MAX) ? c.seuil : SEUIL_G_DEFAUT;
}
void sauver() { Config c = { MAGIC, seuil }; EEPROM.put(0, c); EEPROM.commit(); }

// ---------------------------------------------------------------------------- boutons et accords
bool lireBouton(Bouton &b, uint32_t t) {   // vrai si l'état a changé
  bool l = digitalRead(b.pin) == LOW;
  if (l != b.brut) { b.brut = l; b.maj = t; }
  if (t - b.maj >= REBOND_MS && b.etat != b.brut) { b.etat = b.brut; return true; }
  return false;
}

void boutons(uint32_t t) {
  bool cg = lireBouton(bg, t), cd = lireBouton(bd, t);
  if (cg && bg.etat) { t_appui_g = t; dernier_appui = t; }
  if (cd && bd.etat) { t_appui_d = t; dernier_appui = t; }
  // bouton de lanceur : Bas tant qu'il est enfoncé (l'accord ne relâche Bas que s'il l'a envoyé lui-même)
  if (lireBouton(bl, t)) {
    if (bl.etat) { dernier_appui = t; if (!lanceur) appuyer(KEY_DOWN_ARROW); }
    else if (!lanceur) relacher(KEY_DOWN_ARROW);
  }
  // les palettes suivent toujours les boutons, accord ou non (lever les deux palettes reste un geste de jeu)
  if (bg.etat != maj_g) { if (bg.etat) appuyer(KEY_LEFT_SHIFT); else relacher(KEY_LEFT_SHIFT); maj_g = bg.etat; }
  if (bd.etat != maj_d) { if (bd.etat) appuyer(KEY_RIGHT_SHIFT); else relacher(KEY_RIGHT_SHIFT); maj_d = bd.etat; }

  if (mode == LIBRE) {
    // accord : le second bouton arrive moins de 80 ms après le premier
    if (bg.etat && bd.etat && ((cg && t - t_appui_d < FENETRE_ACCORD_MS) || (cd && t - t_appui_g < FENETRE_ACCORD_MS))) {
      mode = ACCORD; t_accord = t; lanceur = false; echap_envoye = false;
    }
    return;
  }
  uint32_t duree = t - t_accord;
  if (bg.etat && bd.etat) {
    if (!lanceur && !echap_envoye && duree >= BREF_MS) { appuyer(KEY_DOWN_ARROW); lanceur = true; }
    if (!echap_envoye && duree >= ECHAP_MS) {
      taper(KEY_ESC);
      if (lanceur) { relacher(KEY_DOWN_ARROW); lanceur = false; }
      echap_envoye = true;
    }
    return;
  }
  // un bouton relâché : fin de l'accord
  if (lanceur) { relacher(KEY_DOWN_ARROW); lanceur = false; }
  else if (!echap_envoye && duree < BREF_MS) taper(KEY_RETURN);
  mode = LIBRE;
}

// ---------------------------------------------------------------------------- bourrage
void bourrer(float x, float y, uint32_t t) {
  uint8_t k = (fabsf(x) > fabsf(y) * RATIO_LATERAL) ? (x > 0 ? KEY_RIGHT_CTRL : KEY_LEFT_CTRL) : ' ';
  if (touche_bourrage) relacher(touche_bourrage);
  appuyer(k); touche_bourrage = k; fin_bourrage = t + IMPULSION_MS; temps_mort = t + TEMPS_MORT_MS;
  if (Serial && debug) { Serial.print("[BOURRAGE] "); Serial.println(k == ' ' ? "frontal" : (k == KEY_RIGHT_CTRL ? "droit" : "gauche")); }
}

void accelerometre(uint32_t t) {
  if (touche_bourrage && (int32_t)(t - fin_bourrage) >= 0) { relacher(touche_bourrage); touche_bourrage = 0; }
  if (!capteur || t - derniere_lecture < PERIODE_MS) return;
  derniere_lecture = t;
  float ax, ay;
  if (!lireG(ax, ay)) return;
  float dx = ax - base_x, dy = ay - base_y;
  if (ECHANGER_XY) { float s = dx; dx = dy; dy = s; }
  if (INVERSER_X) dx = -dx;
  if (INVERSER_Y) dy = -dy;
  float m = sqrtf(dx * dx + dy * dy);
  if (!capture && m < seuil * 0.5f) { base_x += ALPHA_BASE * (ax - base_x); base_y += ALPHA_BASE * (ay - base_y); }
  if (Serial && debug && t - dernier_log >= 80) {
    dernier_log = t;
    Serial.printf("dX=%.2f dY=%.2f |a|=%.2f seuil=%.2f\n", dx, dy, m, seuil);
  }
  if ((int32_t)(t - temps_mort) < 0 || t - dernier_appui < MASQUE_APPUI_MS) { capture = false; return; }
  if (!capture) {
    if (m >= seuil) { capture = true; fin_capture = t + FENETRE_PIC_MS; pic_x = dx; pic_y = dy; }
  } else {
    if (fabsf(dx) > fabsf(pic_x)) pic_x = dx;
    if (fabsf(dy) > fabsf(pic_y)) pic_y = dy;
    if ((int32_t)(t - fin_capture) >= 0) { capture = false; bourrer(pic_x, pic_y, t); }
  }
}

// ---------------------------------------------------------------------------- série
void etat() {
  Serial.println("Fanny Pinball — manette RP2040-Zero");
  Serial.printf("  MPU-6050 : %s (0x%02X), seuil %.2f g, clavier %s\n", capteur ? "présent" : "ABSENT", adresse, seuil, hid ? "actif" : "coupé");
  Serial.println("  + / - sensibilité, r recalibrer (manette immobile), d trace, k clavier, ? état");
}
void serie() {
  while (Serial && Serial.available()) {
    char c = Serial.read();
    if (c == '+') { seuil = min(SEUIL_G_MAX, seuil + 0.05f); sauver(); Serial.printf("seuil %.2f g\n", seuil); }
    else if (c == '-') { seuil = max(SEUIL_G_MIN, seuil - 0.05f); sauver(); Serial.printf("seuil %.2f g\n", seuil); }
    else if (c == 'r') { calibrer(); Serial.println("calibré"); }
    else if (c == 'd') { debug = !debug; }
    else if (c == 'k') { hid = !hid; if (!hid) Keyboard.releaseAll(); Serial.println(hid ? "clavier actif" : "clavier coupé"); }
    else if (c == '?') etat();
  }
}

void setup() {
  pinMode(PIN_G, INPUT_PULLUP);
  pinMode(PIN_D, INPUT_PULLUP);
  pinMode(PIN_LANCEUR, INPUT_PULLUP);
  Serial.begin(115200);
  EEPROM.begin(256);
  Wire.setSDA(PIN_SDA);
  Wire.setSCL(PIN_SCL);
  Wire.begin();
  Wire.setClock(400000);
  charger();
  capteur = detecter();
  calibrer();
  Keyboard.begin();
}

void loop() {
  uint32_t t = millis();
  boutons(t);
  accelerometre(t);
  serie();
}
