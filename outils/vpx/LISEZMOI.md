# Fanny Pinball pour Visual Pinball X

Table originale (sans ROM ni PinMAME) pour Visual Pinball X 10.7 ou plus récent, Batocera compris.
Elle est **générée** depuis la version web : on ne la retouche pas dans l'éditeur de vpinball, on modifie
le jeu web, le générateur ou `table.vbs`, puis on relance la construction.

```
outils/vpx/construire.sh          # → outils/vpx/sortie/FannyPinball.vpx (+ apercu.png)
```

Prérequis : Node 22, Google Chrome, Rust récent (rustup) et `vpxtool` (`cargo install vpxtool`).

| Fichier | Rôle |
|---|---|
| `exporter_vpx.mjs` | `donnees/table.json` (géométrie de `js/table.js` en mm) et `donnees/plateau.png` (plateau peint par le moteur 2D, 2 px/mm) |
| `decor_glb.py` | décor 3D de la version d'origine : `natif/donnees/scene.glb` (vue 3D du jeu web) → `donnees/decor` (groupes par matière, textures, plateau HD) ; sans le café ni les pieds |
| `collisions.py` | colliders 3D du jeu d'origine (`natif/donnees/monde.json` : parois, poteaux, rampe et ses pattes, bloc F-A-N-N-Y, guides…) → `donnees/collisions`, primitives VPX invisibles qui remplacent les murs du plan 2D ; calcule aussi les points du balayage |
| `generateur/` | crate Rust (bibliothèque `vpin`, celle de vpxtool) : murs, palettes, bumpers, lance-pierres, cibles, couloirs, Cercle, tourniquet, rampe en trois tronçons, lampes, afficheurs, matières, sons |
| `table.vbs` | règles : portage fidèle de `js/rules.js` (mêmes valeurs, mêmes numéros de sons) |
| `apercu.mjs` | contrôle visuel sans vpinball : `vpxtool export gltf` puis rendu three.js |

## Correspondances

- Le rendu vient du décor d'origine (primitives VPX sans collision) ; la physique, des éléments VPX dont le rendu
  est alors caché. Palettes, cibles F-A-N-N-Y et lanceur du décor suivent la physique (`Anim_Timer`).

- 1 unité VP = 0,54 mm (bille de 27 mm = 50 u) ; même repère que le jeu (y vers le joueur). Pente 6,5°.
- Sons : `assets/sons/00NN.mp3` deviennent `s00NN` (numéros du DFPlayer de la réplique) ; musiques sur le fronton.
- Lampes : `L_<nom>` de `LAMP_LAYOUT` (render.js), pilotées par `MajLampes` comme `Rules.lamps()`.
- Afficheur : `Afficheur`, afficheur à points sous le fronton (score, bille, multiplicateur, messages).
- Touches : celles de vpinball (palettes, lanceur, départ, crédit, bourrages). Trois coups de caisse rapprochés
  ferment le pendule (ATTENTION, ATTENTION, TILT).

## Essai automatique

`VPinballX_GL -c1 test -Play FannyPinball.vpx` : le script lance une partie, tire le lanceur à fond, écrit les
positions de la bille dans le journal de vpinball (`ESSAI t=… x=… y=…`) puis lève les palettes. Lanceur réglé ainsi
(`TIR_LANCEUR` = 200 : la bille monte le couloir, passe le portillon et fait le tour du haut).

Lanceur : celui de vpinball, tiré au clavier, partait tout ou rien (rien sous 0,45 s d'appui, pleine vitesse au-delà de 0,7 s). Le script reprend la loi du jeu web (`js/sim.js forceLanceur`) : la durée d'appui donne le tirage (pleine course en 0,9 s), le ressort précomprimé rend √(énergie), la bille part à `LANCEUR_V` × 1,1 tiré à fond, posée dans l'axe du couloir et sans rotation. `LANCEUR_V` = 30,3 : tiré à fond (tout appui de plus de 0,85 s), la bille suit l'arrondi du haut, tombe dans un couloir T-O-U-R puis dans les bumpers (15 tirs sur 15 à l'essai `lanceur` ; couloirs atteints de 32,5 à 34, au-delà elle fait le tour). Le lanceur de vpinball ne fait plus que le geste (`TIR_LANCEUR` = 5, `TIRAGE_LANCEUR` = 0,1).

Encore à régler en jeu : force des lance-pierres (80), éjection du Cercle (`EjecterCercle`, 12), capteur de rampe.

## Essais sur la machine (Batocera ou VPX local)

`VPinballX_GL -c1 <mode> -Play FannyPinball.vpx`, résultats dans le journal (`Script.Print`) :

- `test` : partie, tir du lanceur, trajectoire de la bille (`ESSAI …`).
- `balayage` : billes posées sans vitesse sur une grille de 20 mm de tout le plateau (751 points) ; une bille immobile après 4,5 s est signalée `BLOQUE x= y=`, une bille sortie du plateau `PERDUE`.
- `rampe` : tirs dans la rampe à trois vitesses, billes posées sous la rampe et lâchées du haut du plateau au-dessus de l'entrée (`RAMPE …`).
- `logique` : toute la logique de jeu, élément par élément (`LOGIQUE …`, tableau `LOGIQUE` du script) : bumpers, lance-pierres, couloirs T-O-U-R et du bas, tourniquet, boules, cibles TIRER / POINTER / BOUCHON, carreau, F-A-N-N-Y, rampe et escales, multiball au Cercle, jackpots, super jackpot, sauvetage, pendule (ATTENTION, TILT), fin de mène et bonus, bille suivante, fin de partie, record, match. Chaque étape écrit les points marqués, le détail des ajouts et l'état du jeu ; les billes évacuées pendant les tirs sont remplacées au lanceur.
- `lanceur` : dosage du lanceur, une bille posée sur la pointe par durée d'appui (300 ms à 3 s) : vitesse de départ, point le plus haut, points marqués et trajet (`LANCEUR …`).
- Les capteurs de vpinball signalent plusieurs fois le même passage : le script ne compte qu'un passage par capteur et par 150 ms (`Doublon`).

## Vue et afficheur

- Vue « bureau » (écran unique paysage, réglage des autres tables de la Batocera) : mode caméra, plateau à gauche vu de face, fond `fond_bureau` composé par le générateur (décor `donnees/fond/fond.jpg`, fronton en haut à droite). Réglage : `VUE_BUREAU` dans `generateur/src/main.rs`, ou `VUE="visée,champ,recul,x,y,z,échelle,mode,décalage"` pour essayer sans recompiler.
- Afficheur à points 128 × 32 sous le fronton : le VPX de la Batocera ne dessine pas le texte des boîtes de texte, le script calcule les points (police 5 × 7, `DessinerAfficheur`) et les envoie par `DMDPixels` à la boîte `Afficheur` marquée DMD.
- Décor du fond (`fond.py`, clin d'œil au jeu Arducible « Fanny Pétanque World Tour ») : carte des escales en aplats ocre avec l'itinéraire de la rampe en pointillés, titre, flipper complet en robe à pois qui tourne sur lui-même (`tourniquet.mjs` : vues de la scène 3D du jeu web exportée avec l'habillage `pois`, posées par `fond.py --tourniquet`) et médaillon de Fanny à gauche ; sous l'afficheur, deux GIF tirés des vidéos du projet (le châssis en action, la boule sur son articulation) et la signature #arducible, the DIY pétanque game. Les sorties (`donnees/fond/` : `fond.jpg`, `chassis.gif`, `articulation.gif`, `tourniquet.gif`) sont versées au dépôt ; `python3 fond.py --source <dépôt Arducible_Fanny_Petanque_World_Tour>` les refait. VPX n'anime pas une image de fond : chaque vue des GIF devient une image de la table, jouée par le script (`AnimerGifs`) sur deux flashers placés dans la scène devant les cadres et tournés vers la caméra (`PANNEAUX` dans `generateur/src/main.rs`).

## Publication

`./paquet.sh [version]` : `sortie/Fanny Pinball (Arducible 2026) v<version>.zip` avec la table nommée selon l'usage (« Nom (Fabricant Année) vX.Y.vpx »), `README.txt` (VPX 10.8 ou plus, aucune ROM, touches, règles, crédits) et les images de `sortie/captures/`. Jeu original : pas de ROM ni de .directb2s, sons et musiques dans le .vpx.
