/*
 * Fanny Pinball — Contrôleur USB HID pour caisse dédiée (Arduino Pro Micro / ATmega32U4)
 *
 * Fonctionnalités :
 *   - Boutons d'arcade (palettes, lanceur dosé, Start, Crédit, Pause, Plein écran)
 *     en INPUT_PULLUP avec anti-rebond rapide non bloquant (5 ms sur les palettes).
 *   - Détection du bourrage (frontal, gauche, droit) par accéléromètre I2C :
 *     détection automatique MPU-6050 (GY-521) ou ADXL345 (GY-291), sans bibliothèque externe.
 *   - Filtre passe-haut + capture du premier pic (ignore le rebond de la caisse) + temps mort
 *     anti-faux-TILT.
 *   - Réglage en direct de la sensibilité via le Moniteur Série (115200 bauds) + sauvegarde EEPROM.
 *
 * Bibliothèques requises : uniquement les bibliothèques standard Arduino (Wire, Keyboard, EEPROM).
 * Carte dans l'IDE Arduino : "Arduino Micro" ou "SparkFun Pro Micro (5V, 16 MHz)".
 */

#include <Wire.h>
#include <Keyboard.h>
#include <EEPROM.h>
#include <math.h>

// ============================================================================
// 1. BROCHAGE (Arduino Pro Micro : I2C matériel sur D2 = SDA, D3 = SCL)
// ============================================================================
// Chaque bouton se branche simplement entre sa broche et GND (aucune résistance).

const uint8_t PIN_FLIP_G      = 4;   // Palette gauche        -> ShiftLeft
const uint8_t PIN_FLIP_D      = 5;   // Palette droite        -> ShiftRight
const uint8_t PIN_LANCEUR     = 6;   // Lancer (maintenir)    -> ArrowDown
const uint8_t PIN_START       = 7;   // Démarrer partie       -> KeyS
const uint8_t PIN_PIECE       = 8;   // Pièce / Crédit        -> Digit5
const uint8_t PIN_PAUSE       = 9;   // Pause (optionnel)     -> KeyP
const uint8_t PIN_PLEIN_ECRAN = 10;  // Plein écran (opt.)    -> KeyF
const uint8_t PIN_INHIBITION  = A0;  // Relié à GND = coupe l'envoi clavier (maintenance)

// ============================================================================
// 2. RÉGLAGES ACCÉLÉROMÈTRE & BOURRAGE
// ============================================================================

// Orientation du module dans la caisse :
// Convention souhaitée :
//   +X : vers la DROITE de la caisse (un coup poussant la caisse à droite -> bourrage droit)
//   +Y : vers l'ARRIÈRE/HAUT du plateau (un coup frontal vers l'avant -> bourrage frontal)
// Ajuster ces 3 booléens selon le sens de montage physique du module (sans recâbler) :
const bool ECHANGER_XY = false;
const bool INVERSER_X  = false;
const bool INVERSER_Y  = false;

// Sensibilité par défaut (en g) — réglable en direct dans le Moniteur Série avec '+' et '-'
const float SEUIL_G_DEFAUT   = 0.45f;   // typiquement 0.30 (sensible) à 0.80 (caisse rigide)
const float SEUIL_G_MIN      = 0.15f;
const float SEUIL_G_MAX      = 2.50f;
const float RATIO_LATERAL    = 1.15f;   // |X| > |Y| * ratio -> bourrage latéral, sinon frontal

// Filtrage & temporisations (tout est non bloquant : les palettes gardent < 5 ms de latence)
const uint16_t PERIODE_ACCEL_MS = 5;    // 200 Hz
const uint16_t FENETRE_PIC_MS   = 18;   // capture du premier pic d'impulsion avant le rebond
const uint16_t DUREE_IMPULS_MS  = 30;   // durée d'appui synthétique de la touche de bourrage
const uint16_t COOLDOWN_MS      = 320;  // temps mort après un coup (évite les faux TILT)
const float    ALPHA_BASE       = 0.01f;// suivi lent de la gravité / dérive thermique

// Sauvegarde EEPROM
const uint16_t EEPROM_MAGIC = 0xFA42;
struct ConfigEEPROM {
  uint16_t magic;
  float seuilG;
};

// ============================================================================
// 3. GESTION DES BOUTONS (anti-rebond individuel non bloquant)
// ============================================================================

struct Bouton {
  uint8_t pin;
  uint8_t touche;
  uint8_t debounceMs;
  const char* nom;
  bool brut;
  bool etat;          // true = appuyé
  bool envoye;        // true = touche actuellement enfoncée côté USB
  uint32_t majMs;
};

Bouton boutons[] = {
  { PIN_FLIP_G,      KEY_LEFT_SHIFT,  5,  "Flip G",      false, false, false, 0 },
  { PIN_FLIP_D,      KEY_RIGHT_SHIFT, 5,  "Flip D",      false, false, false, 0 },
  { PIN_LANCEUR,     KEY_DOWN_ARROW,  8,  "Lanceur",     false, false, false, 0 },
  { PIN_START,       's',             20, "Start",       false, false, false, 0 },
  { PIN_PIECE,       '5',             20, "Piece",       false, false, false, 0 },
  { PIN_PAUSE,       'p',             20, "Pause",       false, false, false, 0 },
  { PIN_PLEIN_ECRAN, 'f',             20, "Plein ecran", false, false, false, 0 },
};
const uint8_t NB_BOUTONS = sizeof(boutons) / sizeof(boutons[0]);

// ============================================================================
// 4. PILOTE I2C SANS BIBLIOTHÈQUE : MPU-6050 (GY-521) ET ADXL345 (GY-291)
// ============================================================================

enum TypeCapteur : uint8_t {
  CAPTEUR_AUCUN = 0,
  CAPTEUR_MPU6050,
  CAPTEUR_ADXL345
};

TypeCapteur capteur = CAPTEUR_AUCUN;
uint8_t addrCapteur = 0;

bool i2cEcrire(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool i2cLire1(uint8_t addr, uint8_t reg, uint8_t &out) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)1) != 1) return false;
  out = Wire.read();
  return true;
}

bool detecterCapteur() {
  uint8_t id = 0;

  // 1) Test ADXL345 (0x53 par défaut, 0x1D si SDO/ALT au +3.3V)
  const uint8_t addrsAdxl[2] = { 0x53, 0x1D };
  for (uint8_t i = 0; i < 2; i++) {
    if (i2cLire1(addrsAdxl[i], 0x00, id) && id == 0xE5) {
      addrCapteur = addrsAdxl[i];
      capteur = CAPTEUR_ADXL345;
      i2cEcrire(addrCapteur, 0x2C, 0x0B);  // BW_RATE : 200 Hz
      i2cEcrire(addrCapteur, 0x31, 0x09);  // DATA_FORMAT : FULL_RES + ±4 g (3.9 mg/LSB)
      i2cEcrire(addrCapteur, 0x2D, 0x08);  // POWER_CTL : mode mesure
      return true;
    }
  }

  // 2) Test MPU-6050 / clones MPU-6500 / MPU-9250 (0x68 par défaut, 0x69 si AD0 au +3.3V)
  const uint8_t addrsMpu[2] = { 0x68, 0x69 };
  for (uint8_t i = 0; i < 2; i++) {
    if (i2cLire1(addrsMpu[i], 0x75, id) &&
        (id == 0x68 || id == 0x69 || id == 0x70 || id == 0x71 || id == 0x73 || id == 0x98)) {
      addrCapteur = addrsMpu[i];
      capteur = CAPTEUR_MPU6050;
      i2cEcrire(addrCapteur, 0x6B, 0x00);  // PWR_MGMT_1 : réveil
      delay(10);
      i2cEcrire(addrCapteur, 0x1A, 0x03);  // CONFIG : filtre passe-bas ~44 Hz (atténue les clics de boutons)
      i2cEcrire(addrCapteur, 0x19, 0x04);  // SMPLRT_DIV : 1000 / (1 + 4) = 200 Hz
      i2cEcrire(addrCapteur, 0x1C, 0x08);  // ACCEL_CONFIG : ±4 g (8192 LSB/g)
      return true;
    }
  }

  capteur = CAPTEUR_AUCUN;
  return false;
}

bool lireAccelG(float &ax, float &ay, float &az) {
  if (capteur == CAPTEUR_ADXL345) {
    Wire.beginTransmission(addrCapteur);
    Wire.write(0x32);  // DATAX0
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(addrCapteur, (uint8_t)6) != 6) return false;
    uint8_t xL = Wire.read(), xH = Wire.read();
    uint8_t yL = Wire.read(), yH = Wire.read();
    uint8_t zL = Wire.read(), zH = Wire.read();
    int16_t rx = (int16_t)((xH << 8) | xL);
    int16_t ry = (int16_t)((yH << 8) | yL);
    int16_t rz = (int16_t)((zH << 8) | zL);
    ax = rx * 0.0039f;
    ay = ry * 0.0039f;
    az = rz * 0.0039f;
    return true;
  }

  if (capteur == CAPTEUR_MPU6050) {
    Wire.beginTransmission(addrCapteur);
    Wire.write(0x3B);  // ACCEL_XOUT_H
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(addrCapteur, (uint8_t)6) != 6) return false;
    uint8_t xH = Wire.read(), xL = Wire.read();
    uint8_t yH = Wire.read(), yL = Wire.read();
    uint8_t zH = Wire.read(), zL = Wire.read();
    int16_t rx = (int16_t)((xH << 8) | xL);
    int16_t ry = (int16_t)((yH << 8) | yL);
    int16_t rz = (int16_t)((zH << 8) | zL);
    ax = rx / 8192.0f;
    ay = ry / 8192.0f;
    az = rz / 8192.0f;
    return true;
  }

  return false;
}

// ============================================================================
// 5. ÉTAT DU BOURRAGE, CALIBRATION ET MODE SÉRIE
// ============================================================================

float seuilG = SEUIL_G_DEFAUT;
float baseX = 0.0f, baseY = 0.0f;
uint32_t derniereLectureMs = 0;
uint32_t cooldownJusquaMs  = 0;

// Capture du premier pic de choc
bool captureActive = false;
uint32_t finCaptureMs = 0;
float picX = 0.0f, picY = 0.0f;

// Touche de bourrage actuellement maintenue (relâchement non bloquant)
uint8_t toucheBourrage = 0;
uint32_t finBourrageMs = 0;

// Options série / maintenance
bool hidActifSerie = true;
bool debugAccel    = false;
uint32_t dernierLogMs = 0;

bool hidAutorise() {
  return hidActifSerie && (digitalRead(PIN_INHIBITION) == HIGH);
}

void chargerConfig() {
  ConfigEEPROM cfg;
  EEPROM.get(0, cfg);
  if (cfg.magic == EEPROM_MAGIC && isfinite(cfg.seuilG) &&
      cfg.seuilG >= SEUIL_G_MIN && cfg.seuilG <= SEUIL_G_MAX) {
    seuilG = cfg.seuilG;
  } else {
    seuilG = SEUIL_G_DEFAUT;
  }
}

void sauverConfig() {
  ConfigEEPROM cfg = { EEPROM_MAGIC, seuilG };
  EEPROM.put(0, cfg);
}

void calibrerRepos() {
  if (capteur == CAPTEUR_AUCUN) return;
  float sx = 0.0f, sy = 0.0f;
  uint8_t n = 0;
  for (uint8_t i = 0; i < 80; i++) {
    float ax, ay, az;
    if (lireAccelG(ax, ay, az)) {
      sx += ax;
      sy += ay;
      n++;
    }
    delay(5);
  }
  if (n > 0) {
    baseX = sx / n;
    baseY = sy / n;
  }
}

void afficherStatut() {
  if (!Serial) return;
  Serial.println(F("\n=== Fanny Pinball - Controleur Pro Micro ==="));
  Serial.print(F("Capteur I2C : "));
  if (capteur == CAPTEUR_MPU6050)      Serial.print(F("MPU-6050"));
  else if (capteur == CAPTEUR_ADXL345) Serial.print(F("ADXL345"));
  else                                 Serial.print(F("Aucun (boutons seuls)"));
  if (capteur != CAPTEUR_AUCUN) {
    Serial.print(F(" (0x")); Serial.print(addrCapteur, HEX); Serial.print(')');
  }
  Serial.println();
  Serial.print(F("Seuil bourrage : ")); Serial.print(seuilG, 2); Serial.println(F(" g"));
  Serial.print(F("Clavier USB HID : ")); Serial.println(hidAutorise() ? F("ACTIF") : F("INHIBÉ"));
  Serial.println(F("Commandes : '+'/'-' seuil | 'r' recalibrer | 'd' debug | 'k' HID on/off | '?' aide"));
}

void declencherBourrage(float gx, float gy, uint32_t maintenant) {
  uint8_t touche;
  const char* lib;

  if (fabsf(gx) > fabsf(gy) * RATIO_LATERAL) {
    if (gx < 0.0f) {
      touche = KEY_LEFT_CTRL;
      lib = "GAUCHE";
    } else {
      touche = KEY_RIGHT_CTRL;
      lib = "DROIT";
    }
  } else {
    touche = KEY_UP_ARROW;
    lib = "FRONTAL";
  }

  if (hidAutorise()) {
    if (toucheBourrage != 0) Keyboard.release(toucheBourrage);
    Keyboard.press(touche);
    toucheBourrage = touche;
    finBourrageMs = maintenant + DUREE_IMPULS_MS;
  }

  cooldownJusquaMs = maintenant + COOLDOWN_MS;

  if (Serial) {
    Serial.print(F("[BOURRAGE ")); Serial.print(lib);
    Serial.print(F("] dX=")); Serial.print(gx, 2);
    Serial.print(F("g dY=")); Serial.print(gy, 2);
    Serial.println('g');
  }
}

void traiterBoutons(uint32_t maintenant) {
  bool autorise = hidAutorise();
  for (uint8_t i = 0; i < NB_BOUTONS; i++) {
    Bouton &b = boutons[i];
    bool lecture = (digitalRead(b.pin) == LOW);
    if (lecture != b.brut) {
      b.brut = lecture;
      b.majMs = maintenant;
    }
    if ((maintenant - b.majMs) >= b.debounceMs && b.etat != b.brut) {
      b.etat = b.brut;
      if (b.etat) {
        if (autorise) {
          Keyboard.press(b.touche);
          b.envoye = true;
        }
        if (Serial && debugAccel) {
          Serial.print(F("[BOUTON] ")); Serial.println(b.nom);
        }
      } else if (b.envoye) {
        Keyboard.release(b.touche);
        b.envoye = false;
      }
    }
    // Sécurité : si l'inhibition est activée pendant qu'un bouton est tenu
    if (!autorise && b.envoye) {
      Keyboard.release(b.touche);
      b.envoye = false;
    }
  }
}

void traiterAccelerometre(uint32_t maintenant) {
  // Relâchement non bloquant de la touche de bourrage
  if (toucheBourrage != 0 && (int32_t)(maintenant - finBourrageMs) >= 0) {
    Keyboard.release(toucheBourrage);
    toucheBourrage = 0;
  }

  if (capteur == CAPTEUR_AUCUN) return;
  if ((maintenant - derniereLectureMs) < PERIODE_ACCEL_MS) return;
  derniereLectureMs = maintenant;

  float ax, ay, az;
  if (!lireAccelG(ax, ay, az)) return;

  // Composantes dynamiques (gravité retirée)
  float dx = ax - baseX;
  float dy = ay - baseY;

  // Orientation dans le repère de la caisse
  if (ECHANGER_XY) { float tmp = dx; dx = dy; dy = tmp; }
  if (INVERSER_X)  dx = -dx;
  if (INVERSER_Y)  dy = -dy;

  float mag = sqrtf(dx * dx + dy * dy);

  // Mise à jour lente de la ligne de base uniquement au repos (évite de fausser pendant un choc)
  if (!captureActive && mag < seuilG * 0.5f) {
    baseX += ALPHA_BASE * (ax - baseX);
    baseY += ALPHA_BASE * (ay - baseY);
  }

  if (Serial && debugAccel && (maintenant - dernierLogMs) >= 80) {
    dernierLogMs = maintenant;
    Serial.print(F("dX=")); Serial.print(dx, 2);
    Serial.print(F("  dY=")); Serial.print(dy, 2);
    Serial.print(F("  |a|=")); Serial.print(mag, 2);
    Serial.print(F("  seuil=")); Serial.println(seuilG, 2);
  }

  // En période de temps mort après un coup : on ignore les vibrations résiduelles de la caisse
  if ((int32_t)(maintenant - cooldownJusquaMs) < 0) return;

  if (!captureActive) {
    if (mag >= seuilG) {
      captureActive = true;
      finCaptureMs = maintenant + FENETRE_PIC_MS;
      picX = dx;
      picY = dy;
    }
  } else {
    // On retient la plus forte amplitude dans la courte fenêtre d'impulsion initiale
    if (fabsf(dx) > fabsf(picX)) picX = dx;
    if (fabsf(dy) > fabsf(picY)) picY = dy;
    if ((int32_t)(maintenant - finCaptureMs) >= 0) {
      captureActive = false;
      declencherBourrage(picX, picY, maintenant);
    }
  }
}

void traiterSerie() {
  if (!Serial) return;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '+') {
      seuilG = min(SEUIL_G_MAX, seuilG + 0.05f);
      sauverConfig();
      Serial.print(F("Seuil = ")); Serial.print(seuilG, 2); Serial.println(F(" g (sauve)"));
    } else if (c == '-') {
      seuilG = max(SEUIL_G_MIN, seuilG - 0.05f);
      sauverConfig();
      Serial.print(F("Seuil = ")); Serial.print(seuilG, 2); Serial.println(F(" g (sauve)"));
    } else if (c == 'r' || c == 'R') {
      calibrerRepos();
      Serial.println(F("Calibration au repos effectuee."));
    } else if (c == 'd' || c == 'D') {
      debugAccel = !debugAccel;
      Serial.print(F("Debug accel : ")); Serial.println(debugAccel ? F("ON") : F("OFF"));
    } else if (c == 'k' || c == 'K') {
      hidActifSerie = !hidActifSerie;
      if (!hidActifSerie) Keyboard.releaseAll();
      Serial.print(F("Clavier USB HID : ")); Serial.println(hidActifSerie ? F("ACTIF") : F("INHIBÉ"));
    } else if (c == '?' || c == 'h' || c == 'H') {
      afficherStatut();
    }
  }
}

// ============================================================================
// 6. SETUP & LOOP
// ============================================================================

void setup() {
  for (uint8_t i = 0; i < NB_BOUTONS; i++) {
    pinMode(boutons[i].pin, INPUT_PULLUP);
  }
  pinMode(PIN_INHIBITION, INPUT_PULLUP);

  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(100000UL);  // I2C 100 kHz : robuste même avec des fils de 20-30 cm dans la caisse
#ifdef WIRE_HAS_TIMEOUT
  Wire.setWireTimeout(3000, true);
#endif

  chargerConfig();
  detecterCapteur();
  calibrerRepos();

  Keyboard.begin();

  // Petite attente pour laisser le port série s'ouvrir au branchement si besoin
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 1200) {}
  afficherStatut();
}

void loop() {
  uint32_t maintenant = millis();
  traiterBoutons(maintenant);
  traiterAccelerometre(maintenant);
  traiterSerie();
}
