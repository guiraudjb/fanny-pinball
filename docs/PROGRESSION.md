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

### 7. CAO, plans cotés et caisse (20 novembre)

- Géométrie du jeu exportée de `js/table.js` (`cao/exporter_geometrie.py`) : le jeu et la réplique partagent les mêmes cotes.
- Modèle commun `cao/modele.py` :
  - 62 pièces et 155 perçages ;
  - les fixations par vis M3 par dessous, avec des inserts ;
  - les inserts de lampes ;
  - les détecteurs (rollovers à fil, cibles fixes, Cercle, lancement, bac, barrière IR) ;
  - la rampe en tronçons sur 9 poteaux.
- FreeCAD (`cao/construire.py`) produit :
  - le plateau percé ;
  - les pièces en STEP et STL ;
  - la caisse et le fronton WPC ;
  - l'assemblage.
- Blender produit les rendus de contrôle.
- 12 planches cotées en PDF : [CONSTRUCTION.md](CONSTRUCTION.md).
- Recherche d'une caisse nue dans le commerce : seulement aux États-Unis ou en version « flipper virtuel ». La caisse se construit aux cotes WPC.

## Couloirs du bas et lance-pierres (20/11)

- Trois couloirs de chaque côté : sortie, et deux couloirs de retour séparés par un poteau, qui se rejoignent sur le guide du flipper. Les lance-pierres se rapprochent du centre (bord vertical de x 78 à x 120).
- La face des lance-pierres passe de 127 à 101 mm entre poteaux, l'entraxe du mécanisme Williams 500-5849. L'angle de la face est conservé.
- Les deux arrondis de l'entrée de rampe sont maintenant inscrits dans les coins. L'ancien cercle dépassait du toit et retenait la bille.
- Le lâcher en grille a été refait après ces changements.

## T-O-U-R (20/11)

- Vérification : chaque capteur de couloir ne se déclenche que si la bille passe dans ce couloir (59 passages simulés, aucun faux contact).
- Les lettres allumées « sans passage » venaient des règles : bumpers (tous les 3 coups), TRIPLETTE et CARREAU allumaient la lettre suivante. Ces trois sources sont retirées. Seul le passage dans le couloir allume sa lettre. Le changement de couloir aux batteurs est conservé.

## Plans DWG Pinball Makers (20/11)

- LibreDWG 0.14 compilé en local, sans sudo. Les 8 DWG sont convertis en DXF et relevés (détail dans [CONSTRUCTION.md](CONSTRUCTION.md)).
- Ne sont plus des hypothèses : la bague des flippers (Ø 12,7), la platine des flippers (128,6 × 97,6), la banque de cibles (171,5 × 89) et les lumières des cibles (23,5 × 9).
- Cibles F-A-N-N-Y au pas Williams de 31,75 mm au lieu de 28 mm. Nouveau lâcher en grille, cibles levées puis baissées : aucune bille coincée.

## Application installable (20/11)

- Manifeste, service worker (cache complet, jeu hors ligne, plein écran) et icônes tirées du sprite de Fanny, sans IA.
- `outils/pwa.py` : à relancer avant chaque commit qui touche aux fichiers servis.

## Vue 3D, étape 1 (20/11)

- Three.js r170 copié dans `vendor/` (licence MIT, `vendor/three.LICENSE`). Il n'est chargé que si la vue 3D est demandée.
- La physique ne change pas : `js/render3d.js` ne fait que dessiner. Le moteur 2D peint le plateau (illustration, lampes, Cercle, tablier) dans une texture posée sur un plateau incliné à 6,5°.
- En volume : parois chromées, poteaux à anneau de caoutchouc, plastiques sérigraphiés (même dessin qu'en 2D), lance-pierres avec caoutchouc qui s'éclaire au choc, bumpers à chapeau peint, cibles tombantes et rondes, cochonnets, flippers, lanceur.
- La rampe est surélevée avec le profil de la CAO : montée à 14°, 62 mm au-dessus du plateau, descente sur 300 mm. Elle a des rails chromés et des poteaux de support.
- Caisse en bois et barre de verrouillage. Ombres portées, bille d'acier qui reflète l'environnement.
- Caméra à la place du joueur, cadrée automatiquement. Le toucher est ramené aux coordonnées du plateau ; l'aller-retour écran ↔ table est exact.
- Bouton « Vue » et touche V. La 3D est la vue par défaut quand le navigateur gère WebGL 2, et le choix est mémorisé.
- Sur la carte graphique Intel HD 510 de Pilote2 : environ 31 images/s en 3D contre 44 en 2D.


## Vue 3D, étape 2, et lenteur de la bille (20/11)

- Lenteur signalée : la physique était juste (bille à 1,08 m/s² le long du plateau, comme un vrai plateau à 6,5°), c'est la vue 3D qui ralentissait le jeu. À chaque clignotement de lampe, la texture du plateau (1028 × 2134 px) était redessinée et renvoyée à la carte graphique. Et la boucle plafonnait le pas de temps à 50 ms : sous 20 images/s, le jeu passait au ralenti.
- Corrections : le plateau est peint une seule fois, lampes éteintes. Les lampes sont des pastilles lumineuses avec un halo, qu'on affiche ou cache. Le pas de temps rattrape le temps réel jusqu'à 10 images/s (plafond de 100 ms). Une erreur de dessin n'arrête plus la partie. Résolution plafonnée à 1,5.
- Résultat sur l'Intel HD 510 : de 31 à 51 images/s en 3D, temps de jeu égal au temps réel.
- Lampes : insert lumineux insensible à l'ombre + halo additif ; éclat des bumpers et des lance-pierres au choc.
- Rampe : décor appliqué sur la longueur (liserés rouge et jaune, chevrons, « ★ WORLD TOUR ★ » sur l'arrondi), flancs teintés, lèvre métallique d'entrée.
- Reflets : plateau verni (clearcoat). La bille reflète la vraie table grâce à une capture faite une fois au chargement, éclairée par des plafonniers que le joueur ne voit pas.

## Bille piégée entre les lance-pierres (20/11)

- Signalé : la bille rebondissait sans fin d'un lance-pierre à l'autre. Reproduit : 24 billes sur 60 tournaient en orbite stable, jusqu'à 46 coups en 12 s. Les lance-pierres plus rapprochés renvoyaient la bille exactement à la même hauteur sur la face opposée.
- Correction dans `js/sim.js` (`SLING_TUNE`) : coup penché un peu vers le bas (≈ 18° au-dessus de l'horizontale au lieu de 29°) et légèrement dispersé (±6°, ±12 %), comme un vrai lance-pierre. Plus aucune orbite sur 60 billes : 1,3 coup en moyenne, 7 au plus.
- Sur la réplique, le même effet se règle par la course du bras et la tension du caoutchouc.

## Vue 3D, étape 3 (20/11)

- Pièces de la CAO dans le jeu : `outils/cao_web.py` convertit les STL de `cao/sortie/pieces/` en un glTF binaire de 0,86 Mo (37 pièces, 68 000 triangles, repère du jeu), sans dépendance ni IA. Le jeu le lit avec un petit décodeur, sans module Three.js supplémentaire.
- Pièces concernées : arche, guides, séparateurs, déflecteur, entrée de rampe, pièce du bouchon, bloc F-A-N-N-Y, mur des cibles, plastiques des lance-pierres (posés sur leurs poteaux, comme sur la réplique), poteaux, poteaux de rampe, tablier. Les plastiques reçoivent le décor sur le dessus.
- Chaque pièce masque les volumes provisoires qu'elle remplace (points témoins dans son contour, ou à moins de 8 mm). 50 volumes sur 54 sont remplacés. Restent le couloir de lancement (alu, sans modèle) et le bord gauche de la caisse.
- Caméra (bouton ou touche K) : joueur (38°), haute (55°), plateau (80°, écrans verticaux). Choix mémorisé ; par défaut, haute sur un écran étroit.
- 3D légère (bouton Vue ou touche V : 2D → 3D → 3D légère) : sans ombres ni vernis, à la résolution de l'écran. Automatique sur téléphone, ou si une partie descend sous 40 images/s.
- Intel HD 510 : 47 images/s en qualité haute, 59 en 3D légère.
- Après chaque `freecadcmd cao/construire.py` : `python3 outils/cao_web.py`, puis `python3 outils/pwa.py`.

## Reste à faire

| Sujet | Détail |
|---|---|
| Écoute des voix | Vérifier à l'oreille le timbre et la prononciation des pistes 24 à 50 |
| Réglages | Paliers du clac, nombre d'extra balls, partie libre : constantes en tête de `js/rules.js`, à ajuster après quelques parties |
| Réplique : logiciel | Porter `js/rules.js` en C++ pour le Mega (même découpage : contacts → bobines, lampes, afficheurs, sons) |
| Réplique : mécanique | Acheter les mécanismes, relever les cotes en orange (HYP) sur les pièces reçues, mettre à jour `cao/cotes.py` et régénérer les plans ([CONSTRUCTION.md](CONSTRUCTION.md)) |
| Réplique : impression | Imprimer une pièce test (poteau, guide) pour valider inserts et tolérances, puis la série |
| Caisse | Débiter et assembler la caisse et le fronton (planches 08, 09, 11) |
| Son sur la réplique | Le DFPlayer ne joue qu'une piste à la fois : priorité à la voix, ou second DFPlayer sur Serial2 |
