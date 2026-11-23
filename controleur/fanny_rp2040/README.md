# Manette minimale : RP2040-Zero, 2 (ou 3) boutons d'arcade, MPU-6050

Une manette USB pour jouer à **Fanny Pinball** (version web et version native `natif/`) avec très peu de matériel :

| Quantité | Composant | Rôle |
|:---:|---|---|
| 1 | Waveshare **RP2040-Zero** | clavier USB (aucun pilote), port série de réglage |
| 2 | boutons d'arcade | palettes gauche et droite |
| 1 *(facultatif)* | bouton d'arcade | lanceur (sinon : les deux boutons maintenus) |
| 1 | **MPU-6050** (GY-521) | bourrage : secouer la manette |

## Câblage

Aucune résistance : le firmware active les tirages internes. Le RP2040 fonctionne en 3,3 V, comme le MPU-6050 :
on l'alimente directement par la broche 3V3.

```text
                 RP2040-Zero
              ┌───────────────┐
  GY-521 SDA ─┤ GP4      GP15 ├─ bouton DROIT ── GND
  GY-521 SCL ─┤ GP5      GP14 ├─ bouton LANCEUR ── GND   (facultatif)
  GY-521 VCC ─┤ 3V3      GP13 ├─ bouton GAUCHE ── GND
  GY-521 GND ─┤ GND           │
              └───────[USB-C]─┘
```

Fixer le MPU-6050 à plat dans le boîtier, à peu près au centre. Les axes se corrigent dans le firmware
(`ECHANGER_XY`, `INVERSER_X`, `INVERSER_Y`), sans recâbler.

## Commandes

| Geste | Touche envoyée | En partie | Dans les menus |
|---|---|---|---|
| bouton gauche | Maj gauche | palette gauche | monter |
| bouton droit | Maj droite | palette droite | descendre |
| bouton de lanceur (GP14) | Bas, maintenu | tirer le lanceur, relâcher = lancer | **valider** |
| les deux, appui bref (< 0,35 s) | Entrée | départ de partie | valider (dans les réglages : fait tourner la valeur) |
| les deux, maintenus | Bas, maintenu | tirer le lanceur, relâcher un bouton = lancer (pleine puissance vers 1,25 s) | — |
| les deux, maintenus 3 s | Échap | pause | retour |
| secousse avant | Espace | bourrage frontal | — |
| secousse gauche / droite | Ctrl gauche / droit | bourrage latéral | — |

Les palettes suivent toujours les boutons, sans retard ajouté, même pendant un accord : lever les deux palettes
pour garder la bille reste possible. Un « accord », c'est le second bouton enfoncé moins de 80 ms après le premier.
Un double coup de palette bref envoie donc aussi Entrée, ce qui n'a aucun effet en cours de partie. Dans les menus,
les deux palettes d'un accord s'annulent (monter puis descendre), et le jeu natif ignore la touche Bas tant que les
deux Maj sont tenues.

Le bourrage est masqué pendant 120 ms après chaque appui, pour qu'un coup sec sur un bouton ne passe pas pour une
secousse.

## Installer le firmware : CircuitPython (le plus simple)

Si la carte affiche un disque **CIRCUITPY** quand on la branche, il suffit de copier
[`circuitpython/code.py`](circuitpython/code.py) à la racine de ce disque. La carte redémarre aussitôt avec le
nouveau programme, sans compilation. Il faut la bibliothèque `lib/adafruit_hid` du bundle Adafruit, déjà fournie avec
la plupart des images CircuitPython de manettes. Essayé avec CircuitPython 7.3.3. Le seuil de bourrage est gardé dans
`microcontroller.nvm`.

Ne pas maintenir BOOT au branchement : BOOT sert à installer un nouveau système (fichier `.uf2` sur le disque
`RPI-RP2`), pas à copier `code.py`.

La console série est la même que la version Arduino (`screen /dev/ttyACM0 115200`). Ctrl‑C arrête le programme et
Ctrl‑D le relance, par exemple après avoir câblé le MPU‑6050 : il n'est détecté qu'au démarrage.

## Installer le firmware : Arduino

1. IDE Arduino : *Préférences → URL de gestionnaire de cartes* :
   `https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json`,
   puis installer « Raspberry Pi Pico/RP2040 » dans le gestionnaire de cartes.
2. Carte « **Waveshare RP2040 Zero** », *USB Stack* : « Pico SDK ».
3. Ouvrir `fanny_rp2040.ino` et téléverser. Au tout premier téléversement, brancher le RP2040-Zero en maintenant
   son bouton **BOOT** : il apparaît comme une clé USB `RPI-RP2`.

En ligne de commande :

```sh
arduino-cli core install rp2040:rp2040 --additional-urls <URL ci-dessus>
arduino-cli compile -b rp2040:rp2040:waveshare_rp2040_zero controleur/fanny_rp2040
arduino-cli upload  -b rp2040:rp2040:waveshare_rp2040_zero -p /dev/ttyACM0 controleur/fanny_rp2040
```

## Réglage du bourrage

Ouvrir le moniteur série à 115200 bauds (ou `screen /dev/ttyACM0 115200`) :

| Touche | Effet |
|---|---|
| `?` | état : capteur détecté, adresse, seuil |
| `+` / `-` | seuil de secousse ± 0,05 g (enregistré en mémoire flash) ; 0,55 g par défaut |
| `r` | recalibrer le repos (manette immobile) |
| `d` | trace de l'accéléromètre et des bourrages détectés |
| `k` | couper ou rétablir le clavier USB (pour régler sans envoyer de touches) |

Avec `d`, secouer la manette vers l'avant doit afficher `[BOURRAGE] frontal`, et vers la droite `[BOURRAGE] droit`.
Sinon, ajuster `ECHANGER_XY`, `INVERSER_X` ou `INVERSER_Y`.
