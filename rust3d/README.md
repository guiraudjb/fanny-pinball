# Fanny Pinball 3D — Version native Rust (OpenGL 3.3 Core)

Version **3D temps réel native** de **Fanny Pinball** écrite en Rust + OpenGL 3.3 Core (via SDL2), **sans navigateur, sans JavaScript ni WebAssembly**.

### Points forts
- **Ultra-léger et fluide (60–144 FPS)** : physique 480 Hz en Rust pur (< 0,1 ms/image), maillages CAO (`assets/cao/pieces.glb` + `assets/cao/caisse.glb`) fusionnés par matériau (~35 appels de dessin/image), MSAA 4×, zéro fuite mémoire.
- **Zéro dépendance réseau supplémentaire** : utilise uniquement `sdl2` (OpenGL, `SDL2_image`, `SDL2_mixer`).
- **Scène 3D complète** : caisse WPC, pieds, fronton rétroéclairé (`assets/fronton.jpg`) avec afficheurs LED ambre temps réel, plateau texturé (`assets/plateau.jpg`), 32 inserts lumineux 3D, rampe PVC translucide 3D, fils chromés wireforms, 3 pop bumpers animés, batteurs 3D, tourniquet 360°, 10 rollovers, lanceur externe coulissant.
- **4 caméras 3D** (`Joueur`, `Haute` pincab, `Tour` libre à la souris, `Lilliputien` promenade libre sur le plateau).
- **Écran vertical 90° natif** (`O` ou `--rot 90`) dans la matrice de projection (résolution native 100 % nette) + **100 % compatible** avec le contrôleur Arduino Pro Micro (`../controleur/`).

---

## Compilation et lancement

### 1. Dépendances (Debian 13 / Ubuntu)
```bash
sudo apt update && sudo apt install -y rustc cargo build-essential pkg-config libsdl2-dev libsdl2-image-dev libsdl2-mixer-dev
```

### 2. Compiler et lancer
```bash
# Mode fenêtré avec compteur FPS dans la barre de titre
cd rust3d && cargo run --release -- --fps

# Mode plein écran vertical (écran pivoté à 90° + caméra haute pincab)
cd rust3d && cargo run --release -- --fullscreen --rot 90 --haute --fps
```

Une fois compilé, le binaire autonome se lance directement :
```bash
./rust3d/target/release/fanny-pinball-3d --fullscreen --rot 90
```

---

## Commandes

| Touche | Action |
| :--- | :--- |
| `Shift G` / `←` / `Z` | Palette gauche (+ décalage `T-O-U-R`) |
| `Shift D` / `→` / `/` | Palette droite (+ décalage `T-O-U-R`) |
| `↓` / `Entrée` | Lancer de bille (maintenir pour doser, relâcher pour tirer) |
| `S` / `Entrée` | Démarrer une partie (`Start`) |
| `5` / `C` | Insérer une pièce (crédit) |
| `↑` / `Espace` | Bourrage frontal |
| `Ctrl G` / `Ctrl D` | Bourrage latéral gauche / droit |
| `K` | Changer de caméra (`Joueur` → `Haute` → `Tour`) |
| `G` | Mode promenade **Lilliputien** (`ZQSD`/flèches + souris, `E`/`C` hauteur, `Shift` rapide, `R` reset, `G`/`Échap` quitter) |
| `O` | Pivoter l'affichage (`0° → +90° → -90°`) |
| `F` / `F11` | Plein écran |
| `+` / `-` | Inclinaison du plateau (`5,0°` → `8,0°`) |
| `P` | Pause |
| `M` | Couper / remettre le son |
| `I` | Afficher / masquer les FPS dans le titre |
| `Échap` / `Q` | Quitter |
