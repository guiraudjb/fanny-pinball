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
| `generateur/` | crate Rust (bibliothèque `vpin`, celle de vpxtool) : murs, palettes, bumpers, lance-pierres, cibles, couloirs, Cercle, tourniquet, rampe en trois tronçons, lampes, afficheurs, matières, sons |
| `table.vbs` | règles : portage fidèle de `js/rules.js` (mêmes valeurs, mêmes numéros de sons) |
| `apercu.mjs` | contrôle visuel sans vpinball : `vpxtool export gltf` puis rendu three.js |

## Correspondances

- Le rendu vient du décor d'origine (primitives VPX sans collision) ; la physique, des éléments VPX dont le rendu
  est alors caché. Palettes, cibles F-A-N-N-Y et lanceur du décor suivent la physique (`Anim_Timer`).

- 1 unité VP = 0,54 mm (bille de 27 mm = 50 u) ; même repère que le jeu (y vers le joueur). Pente 6,5°.
- Sons : `assets/sons/00NN.mp3` deviennent `s00NN` (numéros du DFPlayer de la réplique) ; musiques sur le fronton.
- Lampes : `L_<nom>` de `LAMP_LAYOUT` (render.js), pilotées par `MajLampes` comme `Rules.lamps()`.
- Afficheurs : `Afficheur` (score, 8 caractères) et `AfficheurInfo` (4 caractères), comme les TM1637.
- Touches : celles de vpinball (palettes, lanceur, départ, crédit, bourrages). Trois coups de caisse rapprochés
  ferment le pendule (ATTENTION, ATTENTION, TILT).

## Essai automatique

`VPinballX_GL -c1 test -Play FannyPinball.vpx` : le script lance une partie, tire le lanceur à fond, écrit les
positions de la bille dans le journal de vpinball (`ESSAI t=… x=… y=…`) puis lève les palettes. Lanceur réglé ainsi
(`TIR_LANCEUR` = 200 : la bille monte le couloir, passe le portillon et fait le tour du haut).

Encore à régler en jeu : force des lance-pierres (80), éjection du Cercle (`EjecterCercle`, 12), capteur de rampe.
