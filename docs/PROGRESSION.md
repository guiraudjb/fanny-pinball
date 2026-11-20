# Progression — Fanny Pinball

Journal du projet, du plus ancien au plus récent. Les exigences correspondantes sont dans
[CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md).

## État au 20 novembre 2026

- **Jeu web : jouable de bout en bout.** La boucle de jeu est complète : bonus, multiball, jackpots,
  extra ball, clac et partie gratuite, match de fin de partie. La table est habillée et sonorisée,
  avec la voix de Fanny.
- **Réplique physique : conçue sur le papier.** Le brochage, la nomenclature et les pièces à acheter
  ou à imprimer sont définis. Il reste à fabriquer et à porter les règles en C++.

## Étapes

### 1. Prototype et géométrie (19–20 novembre)

- Création du dépôt et prototype Matter.js : rampe, bonus, multiball, thème pétanque.
- Architecture pensée pour la réplique :
  - `rules.js` ne connaît que des contacts, des bobines, des lampes et des afficheurs ;
  - les numéros de son sont les pistes du DFPlayer ;
  - l'ordre des lampes est l'ordre des LED.
- Proportions reprises de tables VPX / VPinMAME de référence. Les angles de rampe trop raides et les
  flippers mal alignés ont été corrigés.
- Banque de cibles F-A-N-N-Y en diagonale, rampe unique sur l'arrondi du haut, lancement qui
  retombe sur les bumpers.
- Inventaire du matériel et des pièces impossibles à fabriquer ([MATERIEL.md](MATERIEL.md)).

### 2. Habillage Krea 2 et sons (20 novembre)

- Plateau, fronton « Fanny Pétanque World Tour » et sprites de Fanny générés par Krea 2 :
  été provençal, pétanque, humour (le chien, la cigale à lunettes…).
- Bumpers agrandis : le rayon donné par VPX n'était que celui de l'anneau.
- Changement de couloir, couloir du bouchon (tir au carreau, biberon), le Cercle déplacé en haut
  à droite, trois cibles rondes à gauche de POINTER.
- Billes coincées éliminées : blocs pleins à toit en pente, puis vérification par lâchers en grille
  (564 points, aucune bille coincée) et parties automatiques.
- Bruitages par synthèse physique ; générique et thème avec YuE2 (commits `b46727c`, `fb52aca`).

### 3. Voix de Fanny (20 novembre)

- Le chant du générique est isolé par demucs. Les deux premiers vers servent de référence à
  VoiceStudio, et la voix est déclarée comme voix de synthèse.
- 21 répliques (pistes 24 à 44) branchées sur les règles, une seule voix à la fois (`ce48dfe`).

### 4. Finitions visuelles (20 novembre)

- **Cigale** déplacée dans l'arbre près du soleil, sans IA (`retouche_plateau.py`), puis fondue
  par inpainting Krea 2 dans ComfyUI (`lissage_krea2.py`) (`50080aa`, `606904b`).
- **Rampe** redessinée en plastique transparent des années 80 : liserés, rails chromés, chevrons,
  « WORLD TOUR » (`461cdc7`).
- **Pièces en plastique** : supports de cibles, pièce du bouchon d'un seul tenant aux coins arrondis,
  lance-pierres, bumpers. Elles sont sérigraphiées en lavande et ocre, assorties à la table, avec un
  liseré ocre épais (`0910fce`, `ed5f0d5`, `b0ac29a`, `1221f70`).

### 5. Boucle de jeu complète (20 novembre)

- **Clac** et partie gratuite à 150 000, 300 000 et 500 000 points et au record battu ; crédits gardés.
- **Match** de fin de partie (tirage de 00 à 90) pour gagner une partie.
- **Extra ball** allumée au Cercle (TOUR au ×5) ou donnée au Grand Chelem, deux au plus par partie.
- **Multiball** à rallumage progressif, **jackpot** conservé, **super jackpot** au Cercle.
- **Bonus** décompté. Knocker (D13) et monnayeur (D53) ajoutés au brochage. Sons 45–46, voix 47–50
  (`816e494`).

### 6. Bourrage et tilt (20 novembre)

- Barre d'espace : coup de caisse. Les billes reprennent de l'élan, la table tressaute et un coup
  sourd se fait entendre (piste 51).
- Pendule de tilt simulé (amorti : un coup par seconde reste sans danger). Deux « ATTENTION » par
  bille, puis **TILT** affiché sur les deux afficheurs 7 segments. Le relais d'alimentation retombe
  (batteurs, bumpers, lance-pierres), plus aucun point, la bille est perdue sans bonus ni sauvetage.
- Réplique : pendule sur A7, relais d'alimentation sur D14. Voix 53–54 (« Doucement ! », « Tilt ! »).

## Reste à faire

| Sujet | Détail |
|---|---|
| Écoute des voix | Vérifier à l'oreille le timbre et la prononciation des pistes 24 à 50 |
| Réglages | Paliers du clac, nombre d'extra balls, partie libre : constantes en tête de `js/rules.js`, à ajuster après quelques parties |
| Réplique : logiciel | Porter `js/rules.js` en C++ pour le Mega (même découpage : contacts → bobines, lampes, afficheurs, sons) |
| Réplique : mécanique | Dessiner les pièces 3D, acheter les bobines, les cibles et les flippers ([MATERIEL.md](MATERIEL.md)) |
| Son sur la réplique | Le DFPlayer ne joue qu'une piste à la fois : priorité à la voix, ou second DFPlayer sur Serial2 |
