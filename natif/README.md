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
natif/run.sh              # compile si besoin, exporte les scènes si elles manquent, lance le jeu (options transmises)
cd natif
cargo run --release
cargo test --release      # course des palettes, évacuation, rampe
```

## Machine modeste

Mesures sur un Celeron G3900T (2 cœurs, 2,6 GHz) avec un Intel HD 510, l'entrée de gamme des puces graphiques intégrées,
partie automatique en 1280×800, sans synchronisation verticale (`--profil`) :

| Réglage | Images/s | Rendu par image | Physique par image |
|---|---|---|---|
| normal (anticrénelage 4×) | 66–72 | 10 ms | 3,5 ms |
| `--msaa 0` | 76–80 | 9,3 ms | 3 ms |
| `--leger` | 100–105 | 7 ms | 2 ms |

`--leger` désactive l'anticrénelage, calcule l'image à 70 % de la fenêtre puis l'agrandit, limite le filtrage
anisotrope à 4× et charge `donnees/scene_leger.glb` (textures deux fois moins fines) si elle existe :

```sh
node outils/exporter_scene_natif.mjs --px-mm 1.6 --sortie natif/donnees/scene_leger.glb
cargo run --release -- --leger
```

En plein écran 1920×1080 (`--plein-ecran`, même machine) :

| Réglage | Sans synchro verticale (`--profil`) | En jeu (synchro à 60 Hz, partie de 27 s) |
|---|---|---|
| normal | 47–50 i/s (rendu 14,5 ms) | 60 i/s, aucun rafraîchissement perdu, pire image 27,6 ms |
| `--msaa 0` | 61–64 i/s | 60 i/s |
| `--leger` (image 1344×756) | 86–90 i/s (rendu 8,5 ms) | 60 i/s, aucun rafraîchissement perdu, pire image 28,2 ms |
| `--leger --echelle 0.5` | 113–122 i/s | — |

Le réglage normal tient 60 Hz grâce au travail en parallèle du processeur et de la carte graphique, mais avec peu de
marge (14,5 ms de rendu pour 16,7 ms) ; `--leger` garde la moitié de l'image libre, et l'image, un peu plus douce,
reste nette. La capture (`--capture`) donne le nombre d'images de plus de 20 ms et la pire image.

Autres réglages : `--plein-ecran`, `--echelle 0.5` (définition de l'image calculée, de 0,25 à 1), `--msaa 0|2|4|8`, `--profil` (temps de
physique et de rendu dans la console). La physique reste à 480 Hz dans tous les cas : c'est elle qui garantit les gestes,
et elle ne coûte que 2 à 4 ms par image. Les pièces fixes opaques sont fusionnées par matériau au chargement (environ
370 appels de dessin par image deviennent environ 120).

## Déroulé du jeu

1. **Menu principal** (`src/ecrans.rs`) : Partie libre, Réglages, Quitter. Derrière, la machine est posée au sol, pieds
   repliés et fronton rabattu, dans un café provençal (`js/salle.js`, exporté avec la scène) : tomettes, murs ocre et
   lambris lavande, fenêtres ouvertes sur les champs de lavande et le Ventoux, comptoir en zinc, table de pétanque, olivier,
   affiches de Fanny, guirlande de guinguette. La caméra flâne lentement autour de la machine.
2. **Réglages**, enregistrés dans `~/.config/fanny-pinball/reglages.json` et appliqués aussitôt :
   - affichage fenêtré ou plein écran ;
   - définition (taille de la fenêtre, ou définition de l'image calculée en plein écran, agrandie ensuite à l'écran) ;
   - niveau de détail : Bas (scène légère, image à 75 %, anisotrope 4×), Moyen (anisotrope 8×), Élevé (MSAA 4×, anisotrope 16×) ;
   - volume des effets et volume de la musique (0 à 100).
3. **Partie libre** : tableau des 10 meilleurs scores (`~/.config/fanny-pinball/scores.json`), puis Commencer ou Retour.
4. **Cinématique** (Entrée pour passer, jouée une fois par session) : les pieds se déplient et soulèvent la caisse,
   le fronton se relève, puis la machine se met sous tension (tubes et ampoules qui hésitent, relais, jingle) et la
   caméra rejoint la vue de jeu.
5. **Choix de la vue** : ← → passent d'une caméra à l'autre en direct, Entrée lance la partie.
6. **Fin de partie** : score, puis saisie des trois initiales aux palettes si le score entre au tableau.

Options d'essai : `--ecran menu|reglages|libre|vues|jeu|pause|initiales|cinematique:t` (écran de départ),
`--auto` (partie automatique sans menus), `--capture f.ppm --apres ms`.

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
| P | gel de la physique (essai) |
| M | couper le son |
| F11 | plein écran |
| + / − | pente du plateau |
| Échap | menu de pause (reprendre, changer de vue, abandonner) |

Dans les menus : les palettes (ou ↑) pour choisir, ← → pour modifier, le lanceur (Bas), Entrée ou S pour valider (dans les réglages,
valider fait tourner la valeur), Échap pour revenir. Tout se joue aussi avec la manette à deux boutons
`controleur/fanny_rp2040` (accords : voir son README).

Le score et l'afficheur d'informations s'allument sur le fronton. Ils utilisent la même police 7 segments que les TM1637 de la réplique et que le jeu web (`js/segfont.js`). Le titre de la fenêtre les reprend aussi, avec la caméra et la cadence d'images.
