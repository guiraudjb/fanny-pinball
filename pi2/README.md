# Fanny Pinball — Version native Rust pour Raspberry Pi 2 Model B

Portage natif 2D complet de **Fanny Pinball** écrit en **Rust + SDL2**, conçu spécialement pour tourner à **60 FPS constants** sur un **Raspberry Pi 2 Model B** (ARMv7, 1 Go de RAM, GPU VideoCore IV) sans navigateur et même **sans bureau graphique** (mode console KMSDRM).

### Ce qui est inclus
- **Physique 2D dédiée en Rust pur (480 Hz, zéro dépendance)** : géométrie exacte de `js/table.js`, batteurs balayés avec transfert de vitesse angulaire, multiball 3 billes, rampe sur courbe Catmull-Rom avec pente réelle, tourniquet (spinner), Le Cercle (saucer), cibles tombantes `F-A-N-N-Y`, 10 rollovers, bourrage 3 directions + pendule TILT.
- **Toutes les règles d'origine (`js/rules.js`)** : Multiball Triplette, Jackpot & Super Jackpot, World Tour (7 escales + Grand Chelem), Pointer / Bouchon / Biberon / Carreau, Triplette, bonus `T-O-U-R` ×2..×5, Extra Ball, Ball Save, Match, Clac/Crédits et record sauvegardé.
- **Rendu 2D accéléré matériellement (OpenGL ES 2.0 / KMSDRM)** : réutilise directement `assets/plateau.jpg`, `assets/fanny_victoire.png`, `assets/fanny_lancer.png`, les 32 inserts lumineux et un bandeau fronton LED ambre.
- **Audio natif (`SDL2_mixer` / `libmpg123`)** : joue les 54 pistes MP3 d'origine (`assets/sons/0001.mp3` .. `0054.mp3`), les musiques en boucle, les voix de Fanny sur canal dédié et le clic synthétique du tourniquet.
- **Écran vertical & caisse dédiée** : rotation matérielle `0° / +90° / -90°` (`O` ou `--rot 90`), plein écran (`F` ou `--fullscreen`), et compatibilité directe avec le contrôleur Arduino Pro Micro (`../controleur/`).

---

## 1. Système recommandé sur le Pi 2 Model B

- **Idéal pour une caisse dédiée** : **Raspberry Pi OS Lite (32-bit, Bookworm)** — aucun bureau X11/Wayland, démarrage rapide, ~45 Mo de RAM utilisés en jeu.
- Fonctionne aussi très bien sur **Raspberry Pi OS Desktop** et sur n'importe quel **PC Linux**.

---

## 2. Installation des dépendances et compilation

Sur le Raspberry Pi 2 B (ou PC Linux) :

```bash
# 1. Dépendances SDL2 + outils de compilation
sudo apt update
sudo apt install -y build-essential pkg-config libsdl2-dev libsdl2-image-dev libsdl2-mixer-dev git

# 2. Installer Rust (si pas déjà présent)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# 3. Compiler en mode release
#    (CARGO_BUILD_JOBS=2 évite de saturer le 1 Go de RAM du Pi 2 B pendant la compilation)
cd fanny-pinball/pi2
CARGO_BUILD_JOBS=2 cargo build --release
```

Le binaire compilé se trouve dans :
`pi2/target/release/fanny-pinball-pi2`

---

## 3. Lancement

### Depuis Raspberry Pi OS Desktop ou un PC Linux
```bash
./target/release/fanny-pinball-pi2 --fullscreen --rot 90
```

### Depuis Raspberry Pi OS Lite (sans X11, directement sur HDMI via KMSDRM)
S'assurer que l'utilisateur appartient aux groupes `video`, `input`, `render` et `audio` :
```bash
sudo usermod -aG video,input,render,audio "$USER"
```
*(Se déconnecter / reconnecter une fois.)*

Puis lancer directement depuis la console :
```bash
SDL_VIDEODRIVER=kmsdrm ./target/release/fanny-pinball-pi2 --fullscreen --rot 90
```

### Options en ligne de commande
| Option | Effet |
| :--- | :--- |
| `-f`, `--fullscreen` | Démarre directement en plein écran (curseur masqué) |
| `--rot 0` / `--rot 90` / `--rot -90` | Orientation du plateau pour écran posé à la verticale |
| `--pente 6.5` | Inclinaison du plateau (`5.0°` à `8.0°`) |
| `--assets /chemin/assets` | Chemin explicite vers `assets/` (détecté automatiquement sinon) |
| `--fps` | Affiche le compteur FPS dans le bandeau |

Les préférences (record, rotation, pente, son) sont sauvegardées automatiquement dans `~/.config/fanny-pinball-pi2.conf`.

---

## 4. Démarrage automatique sur la caisse (Raspberry Pi OS Lite)

Pour que le flipper démarre tout seul quelques secondes après la mise sous tension du Pi 2 B, créer `/etc/systemd/system/fanny-pinball.service` (adapter `User` et les chemins si besoin) :

```ini
[Unit]
Description=Fanny Pinball (Pi 2 B)
After=sound.target systemd-user-sessions.service

[Service]
User=pi
SupplementaryGroups=video input render audio
WorkingDirectory=/home/pi/fanny-pinball/pi2
Environment=SDL_VIDEODRIVER=kmsdrm
ExecStart=/home/pi/fanny-pinball/pi2/target/release/fanny-pinball-pi2 --fullscreen --rot 90
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Puis activer le service :
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fanny-pinball.service
```

---

## 5. Commandes (clavier & Arduino Pro Micro)

| Touche (code physique) | Action |
| :--- | :--- |
| `Shift G` / `←` / `Z` | Palette gauche (+ décalage `T-O-U-R`) |
| `Shift D` / `→` / `/` | Palette droite (+ décalage `T-O-U-R`) |
| `↓` / `Entrée` | Lancer de bille (maintenir pour doser, relâcher pour tirer) |
| `S` / `Entrée` | Démarrer une partie (`Start`) |
| `5` / `C` | Insérer une pièce (crédit) |
| `↑` / `Espace` | Bourrage frontal |
| `Ctrl G` / `Ctrl D` | Bourrage latéral gauche / droit |
| `O` | Pivoter l'affichage (`0° → +90° → -90°`) |
| `F` / `F11` | Plein écran |
| `+` / `-` | Ajuster la pente du plateau (`5,0°` → `8,0°`) |
| `P` | Pause |
| `M` | Couper / remettre le son |
| `I` | Afficher / masquer les FPS |
| `Échap` / `Q` | Quitter |
