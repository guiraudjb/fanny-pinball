# Contrôleur USB pour caisse dédiée (Arduino Pro Micro)

Ce dossier contient le firmware prêt à téléverser pour piloter **Fanny Pinball** depuis une caisse de mini-flipper / pincab maison avec :
- des **boutons d'arcade** (palettes, lancer de bille dosé, Start, Crédit, Pause, Plein écran),
- un **accéléromètre I2C** pour le bourrage (frontal, gauche et droit),
- un **Arduino Pro Micro (ATmega32U4)** reconnu nativement comme clavier USB HID sous Linux, Windows et macOS (aucun pilote nécessaire).

> **Zero dépendance externe** : le sketch [fanny_pincab.ino](fanny_pincab/fanny_pincab.ino) n'utilise que les bibliothèques standard d'Arduino (`Wire`, `Keyboard`, `EEPROM`) et détecte automatiquement au démarrage un **MPU-6050 (GY-521)** ou un **ADXL345 (GY-291)**.

---

## 1. Liste du matériel

| Quantité | Composant | Remarques |
| :---: | :--- | :--- |
| 1 | **Arduino Pro Micro 5 V / 16 MHz** (ATmega32U4) | Version **USB-C** recommandée (plus robuste que micro-USB). |
| 2 | **Boutons d'arcade latéraux** (Ø 28–30 mm) | Palettes gauche et droite. Privilégier des microswitchs basse force (type Sanwa ou boutons de flipper). |
| 1 | **Bouton d'arcade « Lancer »** (façade droite) | Appui court = tir faible, maintien (jusqu'à 0,9 s) = pleine puissance. |
| 2–4 | **Boutons de service** (façade gauche) | **Start** + **Pièce/Crédit** (recommandés), **Pause** et **Plein écran** (optionnels). |
| 1 | **Accéléromètre I2C : MPU-6050 (GY-521)** *ou* **ADXL345 (GY-291)** | Prendre un module avec **régulateur 3,3 V intégré** si le Pro Micro est en 5 V. |
| 1 | **Câble USB data** + fils Dupont / cosses 4,8 mm ou 2,8 mm | Attention : vérifier que le câble USB transporte bien les données (pas uniquement la charge). |
| *(opt.)* 1 | **Interrupteur de maintenance** | Relié entre `A0` et `GND` pour désactiver l'envoi clavier pendant les réglages. |

---

## 2. Schéma de câblage

Tous les boutons se câblent simplement entre leur broche Arduino et une masse commune (`GND`) grâce aux résistances `INPUT_PULLUP` internes (**aucune résistance externe nécessaire**).

```text
                    +-------------------------+
                    |   ARDUINO PRO MICRO     |
                    |      (ATmega32U4)       |
                    |                         |
   MPU-6050 /  SDA -| D2 (SDA)            VCC |- VCC (5V vers module avec régul. 3.3V)
   ADXL345     SCL -| D3 (SCL)            GND |- GND (masse commune capteur + boutons)
                    |                         |
   Palette G  -[o]- | D4                  A0  | -[o]- Interrupteur maintenance (opt.)
   Palette D  -[o]- | D5                      |
   Lanceur    -[o]- | D6                      |
   Start      -[o]- | D7                      |
   Crédit     -[o]- | D8                      |
   Pause (opt)-[o]- | D9                      |
   Plein écr. -[o]- | D10                     |
                    +-------------------------+
                           |
                     (tous les retours
                      des boutons -> GND)
```

### Correspondance des touches avec `js/main.js`

*Fanny Pinball* lit les codes physiques de touches (`e.code`), donc ce câblage fonctionne **à l'identique sur clavier AZERTY ou QWERTY**.

| Fonction | Broche | Touche USB envoyée | Action dans le jeu |
| :--- | :---: | :--- | :--- |
| Palette gauche | `D4` | `KEY_LEFT_SHIFT` (`ShiftLeft`) | Batteur gauche + défilement `T-O-U-R` |
| Palette droite | `D5` | `KEY_RIGHT_SHIFT` (`ShiftRight`) | Batteur droit + défilement `T-O-U-R` |
| Lancer de bille | `D6` | `KEY_DOWN_ARROW` (`ArrowDown`) | Tir dosé (maintenir puis relâcher) |
| Start | `D7` | `'s'` (`KeyS`) | Démarre une partie (ne tire pas en cours de jeu) |
| Pièce / Crédit | `D8` | `'5'` (`Digit5`) | Ajoute un crédit |
| Pause *(optionnel)* | `D9` | `'p'` (`KeyP`) | Met en pause / reprend |
| Plein écran *(optionnel)* | `D10` | `'f'` (`KeyF`) | Bascule en plein écran vertical/horizontal |
| Bourrage frontal | I2C | `KEY_UP_ARROW` (`ArrowUp`) | Coup de caisse vers l'avant |
| Bourrage gauche | I2C | `KEY_LEFT_CTRL` (`ControlLeft`) | Coup latéral gauche (*Slide Save*) |
| Bourrage droit | I2C | `KEY_RIGHT_CTRL` (`ControlRight`) | Coup latéral droit (*Slide Save*) |

---

## 3. Montage mécanique de l'accéléromètre

La qualité du bourrage dépend beaucoup de la fixation du capteur :
1. **Visser fermement** le module sur le bois du fond de caisse (avec entretoises isolantes en nylon), bien à plat, près du centre. Ne pas utiliser de mousse double-face épaisse qui amortit les chocs.
2. **Éloigner le capteur des boutons de palettes** pour éviter que le claquement d'un microswitch ne soit pris pour un bourrage.
3. Si l'axe X ou Y est inversé selon le sens dans lequel tu as vissé le module, il suffit de modifier ces 3 lignes en haut de [fanny_pincab.ino](fanny_pincab/fanny_pincab.ino) sans rien recâbler :
   ```cpp
   const bool ECHANGER_XY = false;
   const bool INVERSER_X  = false;
   const bool INVERSER_Y  = false;
   ```

---

## 4. Téléversement (Arduino IDE)

1. Ouvrir `controleur/fanny_pincab/fanny_pincab.ino` dans **Arduino IDE**.
2. Choisir la carte :
   - **Arduino Micro** *(fonctionne directement sans paquet additionnel)*, ou
   - **SparkFun Pro Micro** (`ATmega32U4 5V, 16 MHz`) si le support de cartes SparkFun est installé.
3. Sélectionner le port série du Pro Micro puis cliquer sur **Téléverser**.

> **Astuce si le Pro Micro ne répond plus** : relier brièvement `RST` à `GND` **deux fois de suite** (< 0,5 s) pour forcer le bootloader pendant 8 secondes, puis lancer le téléversement.

---

## 5. Réglage de la sensibilité du bourrage en direct

Ouvrir le **Moniteur Série** à **115200 bauds** (avec la caisse posée à sa place définitive) :

| Commande | Action |
| :---: | :--- |
| `?` | Affiche le capteur détecté (`MPU-6050` ou `ADXL345`), le seuil actuel et l'état HID |
| `d` | Active/désactive l'affichage en direct des accélérations (`dX`, `dY`, `|a|`) |
| `+` | Rend le bourrage **moins sensible** (`+0,05 g`, sauvegardé en EEPROM) |
| `-` | Rend le bourrage **plus sensible** (`-0,05 g`, sauvegardé en EEPROM) |
| `r` | Recalibre la position de repos |
| `k` | Coupe/réactive temporairement l'envoi clavier USB (pratique pendant les tests) |

### Méthode rapide de calibration
1. Taper `k` (pour éviter d'envoyer des touches au PC pendant le test) puis `d`.
2. Appuyer énergiquement sur les deux boutons de palettes et observer le pic `|a|` affiché (par ex. `0.15 g`).
3. Donner ensuite un vrai petit coup sur le côté ou l'avant de la caisse et noter le pic (par ex. `0.55 g`).
4. Régler le seuil avec `+` / `-` **entre les deux** (ici autour de `0.35` – `0.45 g`) : la valeur est mémorisée automatiquement dans l'EEPROM.
5. Vérifier le signe `dX` / `dY` sur un coup gauche, droit et frontal, puis retaper `d` et `k` pour jouer.

---

## 6. Évolution possible : vrai tire-bille mécanique analogique

Si tu souhaites remplacer plus tard le bouton « Lancer » par un **vrai lanceur à ressort mécanique** couplé à un potentiomètre linéaire (ou capteur Hall) branché sur une entrée analogique (`A1`) du même Pro Micro :
- le Pro Micro pourra exposer un axe analogique en **Gamepad USB HID** (bibliothèque `Joystick.h`),
- et *Fanny Pinball* pourra lire directement la course exacte du tire-bille via l'API `navigator.getGamepads()` dans `js/main.js`.
