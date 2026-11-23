# Fanny Pinball — version native (Rust)

Réécriture complète du portage Rust. Elle remplace `rust3d/`, qui avait sa propre physique 2D et ses propres maillages.
Ici, rien n'est refait à la main : la version native reprend directement ce que fait la version web.

| | Source | Fichier |
|---|---|---|
| Monde physique | tous les colliders de `js/sim.js` (plateau, rampe, caoutchoucs, palettes, matières, groupes, rôles) | `donnees/monde.json` |
| Scène 3D | la scène Three.js de `js/render3d.js` : caisse habillée, plateau peint, pièces CAO, rampe décorée, caméras | `donnees/scene.glb` |
| Règles | portage ligne à ligne de `js/rules.js` | `src/regles.rs` |
| Sons | les 54 MP3 de `assets/sons` | (lus à l'exécution) |

## Ce que fait chaque module

- `src/physique.rs` : rapier3d 0.22 avec les mêmes réglages que la version web (480 Hz, `lengthUnit` 1, erreur linéaire
  admise 0,001, 8 itérations, règles de combinaison « produit »). On y retrouve :
  - les palettes motorisées : coup de bobine de 40 ms, maintien, ressort de rappel, fin de course à 8° ;
  - le modèle de caoutchouc : rebond e(v) = 1 − (1 − e1)·v^0,2 au premier contact, hystérésis ensuite ;
  - les coups de bobine des bumpers et lance-pierres ;
  - le tourniquet, qui prend son énergie à la bille ;
  - le Cercle, le lanceur à ressort, l'évacuation, le bourrage et le pendule du tilt.
- `src/regles.rs` : la partie complète (multiball, jackpots, World Tour, Carreau, extra ball, match, tilt), les lampes et
  les afficheurs.
- `src/rendu.rs` : OpenGL 3.3, avec :
  - les textures du glTF, mipmaps et filtrage anisotrope jusqu'à 16× ;
  - le plateau repeint à 3,2 px/mm, soit 4 042 px de haut ;
  - un éclairage à trois lumières avec reflets selon la rugosité et un métal teinté ;
  - les pièces mobiles `dyn_*` et les matériaux lumineux `lampe_*` / `emis_*` animés ;
  - les afficheurs du fronton : la texture `afficheurs` est exportée éteinte, puis ses segments sont redessinés à chaque changement.
- `src/audio.rs` : SDL2_mixer. La voix de Fanny a son propre canal, la musique tourne en boucle et le clic du
  tourniquet est synthétisé.

## Préparer les données (depuis la racine du dépôt)

```sh
node outils/exporter_natif.mjs          # → natif/donnees/monde.json (monde physique)
node outils/exporter_scene_natif.mjs    # → natif/donnees/scene.glb (Chrome sans écran ; --habillage <nom>)
```

Il faut refaire ces deux exports après toute modification de la table, de la CAO ou de l'habillage.

## Compiler et jouer

Dépendances système (Debian) : `libsdl2-dev libsdl2-mixer-dev`.

```sh
cd natif
cargo run --release
cargo test --release      # course des palettes, évacuation, rampe
```

## Commandes

Ce sont les mêmes touches que la version web et que le contrôleur Pro Micro (`controleur/fanny_pincab`).

| Touche | Action |
|---|---|
| Maj gauche / Maj droite | palettes |
| Bas (maintenir puis relâcher) | lanceur |
| S ou Entrée | départ |
| 5 | pièce |
| Espace / Haut | bourrage frontal |
| Ctrl gauche / Ctrl droit | bourrage latéral |
| C | caméra suivante (caméras du jeu web, en paysage ou en portrait selon la fenêtre) ; quitte l'orbite |
| Souris : glisser / molette | caméra orbitale autour de la machine / zoom |
| P | pause |
| M | couper le son |
| F / F11 | plein écran |
| + / − | pente du plateau |
| Échap | quitter |

Le score et l'afficheur d'informations s'allument sur le fronton. Ils utilisent la même police 7 segments que les TM1637 de la réplique et que le jeu web (`js/segfont.js`). Le titre de la fenêtre les reprend aussi, avec la caméra et la cadence d'images.
