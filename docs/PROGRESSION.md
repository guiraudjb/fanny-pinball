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

## Vue 3D : couleurs, flipper complet (21/11)

- Couleurs : le plateau 3D paraissait délavé. Tone mapping Neutral au lieu d'ACES, éclairage moins fort et moins crème, vernis réduit. Saturation mesurée du plateau : 94 avant, 130 après, 133 en 2D.
- Flipper complet : la CAO exporte aussi la caisse en STL (`cao/sortie/caisse/*.stl`), et `outils/cao_web.py` en fait `assets/cao/caisse.glb`. Il contient les flancs, la façade, l'arrière, le fond, le fronton, les pieds et la barre de verrouillage, aux cotes WPC. Le plateau du jeu y est posé à sa place exacte dans la caisse.
- Ajouts dans la vue : porte du monnayeur, boutons start, lancer et flippers aux perçages des plans, sol de la salle.
- Fronton : vitre rétroéclairée avec l'illustration, et panneau des afficheurs en dessous, avec les mêmes TM1637 que la réplique (score sur 2 × 4 chiffres, info sur 4). Ils suivent la partie.
- Nouvelle caméra « machine » qui montre tout le flipper, des pieds au haut du fronton.
- Pieds affinés d'après les sources publiées (PinWiki, VPForums, Pinside, Marco Specialties) :
  - pieds WPC de 28-1/2" (724 mm) et non 32" ;
  - cornière pliée plaquée sur les deux faces de l'angle, droite sur la zone boulonnée puis effilée ;
  - 2 boulons 3/8"-16 × 2-1/2" à tête bombée par pied, passés en diagonale dans l'arête de la caisse jusqu'à la platine d'angle intérieure (Williams 01-11400-1). Les trous sont à 2-1/4" d'entraxe, celui du bas à 5" du haut du pied ;
  - au bas, une plaque soudée et un vérin réglable : contre-écrou, tige 3/8"-16, patin Ø 1-3/4" ;
  - finition thermolaquée noir satiné, boulons et platines zingués.
  - Aucune source ne donne la section du pied, l'épaisseur de tôle ni les cotes de la platine. Ce sont des hypothèses (HYP dans `cao/cotes.py`), à mesurer sur les pièces achetées. Les trous de la caisse sont percés en diagonale dans la CAO (flancs, façade, arrière) et figurent sur les planches 08 et 10.
- Jointure plateau / caisse vérifiée. Le jeu latéral est correct : 6,8 mm, soit 3,4 mm de chaque côté. Mais le plateau du jeu fait 42" (1067 mm), alors que la caisse WPC attend un plateau de 46". Il restait 198 mm de vide entre le bord arrière du plateau et le panneau arrière.
  - Solution retenue : une rallonge fixe en contreplaqué de 12 mm, dans le prolongement du plateau, à la même pente. Elle mesure 514 × 196 mm, laisse 3 mm de jeu à l'arrière et porte une encoche de 160 × 40 mm pour les câbles du fronton. Elle repose sur les tasseaux du plateau.
  - Elle est dans la CAO (`cao/sortie/caisse/rallonge.*`), sur les planches 08, 10 et 11, et dans la vue 3D : bois verni comme les coins du plateau, avec le titre du jeu.
- Caméra « tour » : elle tourne seule autour du flipper en 48 s. La hauteur (de 6° à 55°) et la distance varient à d'autres rythmes, donc les angles changent d'un tour à l'autre. Glisser à la souris ou au doigt fait tourner la vue, la molette zoome, et le tour automatique reprend 5 s plus tard. Le jeu reste jouable au clavier.
- Caoutchoucs et cibles (CAO et vue 3D). Le jeu ne change pas : les contours de rebond restent ceux de la physique, et les pièces sont dessinées autour.
  - Poteaux d'entrée des couloirs : poteau Ø 10 avec une gorge Ø 5 à hauteur du centre de la bille (13,5 mm). Un mini-anneau noir 1/8" (corde 2,5 mm) y est logé, affleurant au rayon de rebond. Les guides sont raccourcis de 6 mm pour laisser l'anneau libre.
  - Lance-pierres : les 3 poteaux sont décalés de 8 mm vers l'intérieur pour que la face extérieure de l'anneau 2-1/2" (corde 4 mm) tombe sur la face de rebond. En 3D, l'anneau est un vrai tube tendu autour des poteaux, et le bras le bombe au choc.
  - Palettes : le corps en plastique est réduit de la section du caoutchouc (4 mm). Le caoutchouc rouge est tendu dans la gorge, et sa face extérieure suit le contour de rebond.
  - Cibles tombantes : lame 22,5 × 8,1 mm, 33 mm au-dessus du plateau, coins hauts arrondis R 6. En 3D, elle s'enfonce dans sa lumière au lieu de disparaître. Sous le plateau, la banque porte un cadre, une bobine de réarmement et une barre de relevage.
  - Cibles fixes (POINTER, TIRER, bouchon, cibles rondes 1 à 3) : boîtier à deux joues, axe acier Ø 3, face pendulaire (disque, bras, moyeu) et microrupteur KW11 derrière la face, avec passe-fil. Les 3 cibles rondes sont logées dans des poches du mur de gauche. En 3D, la face bascule sur son axe au choc puis revient.
  - Cotes des caoutchoucs et des cibles : hypothèses (HYP dans `cao/cotes.py`) à vérifier sur les pièces achetées. Les anneaux sont choisis dans les tailles du commerce (PinWiki) et listés dans la nomenclature (planche 11).
  - Pas encore traité : les pointes des guides des couloirs du haut (rayon de rebond 3 mm), trop fines pour un anneau.
- Tablier (apron) : plastron noir en V au bas du plateau, avec une lèvre de 20 mm. Ses bras sont parallèles aux palettes au repos et laissent 31 mm sous leur arrière (37 mm sous la pointe), un peu plus qu'une bille de 27 mm. Le bord passe de y 846 contre les murs à y 964 au centre. Dans le couloir de lancement, il reste à y 1000, sous la bille au repos.
  - Il cache le bac, la montée de la bille et l'autolanceur. Le séparateur du couloir de lancement s'arrête maintenant au tablier.
  - Ses deux bras ramènent vers le trou d'évacuation central les billes des couloirs extérieurs. Ils sont aussi dans la physique du jeu : une bille sortie par un couloir extérieur passe derrière la palette et roule le long de la lèvre jusqu'au trou, en 1,1 s environ.
  - Cartes d'instructions : « Multiball Triplette » (F-A-N-N-Y, Cercle, jackpot, super jackpot) à gauche, « Bonus · Extra ball » (T-O-U-R, ×5, escales, Grand Chelem) à droite. Au centre, « Fanny te la rend » renvoie à la lampe de sauvetage.
  - La lampe de sauvetage passe de y 990 à y 895, au-dessus des palettes et hors de leur balayage : elle était sur le trou d'évacuation.
  - CAO : coque PETG noir 3 mm, à imprimer en 3 tronçons collés, 3 plots à insert M3, cartes plastifiées collées sur le dessus. Le trou d'évacuation, ramené à 70 × 34 pour rester sous l'intervalle entre les pointes des palettes, est devant la lèvre et se voit dans les deux vues ; en 3D, la bille s'y enfonce.
- Caméra « machine » réglable : on choisit l'angle (glisser) et le zoom (molette ou pincer). En zoomant, la vue se rapproche du plateau. Le bouton « Verrouiller la vue » (touche L) fige ce réglage : la souris et le doigt commandent à nouveau le jeu. L'angle, le zoom et le verrou sont mémorisés.
- Service worker : à l'installation, chaque fichier est relu au serveur (`cache: 'reload'`). Avant, le cache HTTP du navigateur pouvait mélanger deux versions, par exemple une ancienne `index.html` avec un nouveau `main.js`.
- POINTER passe à gauche du couloir du bouchon. Elle est encastrée dans le bloc entre le mur gauche et le couloir, face aux palettes. Elle était seule en bas à gauche, vers y 590. Sa lampe et son étiquette la suivent. Dans la CAO, son boîtier est logé dans une poche de la pièce du bouchon, avec au moins 7,8 mm de matière autour.
  - Un essai avec TIRER entre le couloir et la rampe a été abandonné. Il fallait décaler l'entrée de rampe et la cible masquait cette entrée. TIRER reste au centre, à x 239, y 450, et l'entrée de rampe reste à x 160.
- Banque F-A-N-N-Y remontée de 60 mm le long de son axe. La rampe redescend le long du mur droit à moins de 33 mm du plateau (24 mm sous la cible Y) et heurtait la lame Y. La lame la plus proche est maintenant à 11 mm de la rampe. Dans la CAO, le bloc arrière de la banque, haut de 32 mm, est découpé sous la rampe avec 2 mm de jeu.

- La rampe fait elle-même l'entrée. Sa bouche de 52 mm se resserre sur 70 mm jusqu'à sa largeur courante de 39 mm, et ses flancs transparents guident la bille dès la bouche. Les parois grises de l'entrée et la paroi en pointe du fond sont supprimées : la rampe passait au travers de cette paroi.
  - En physique, les parois de l'entrée suivent l'entonnoir. Elles sont marquées `plugin.flanc` et ne sont pas dessinées en 3D, puisque la rampe les représente.
  - À vitesse de palette, la bille entre de ±12 mm autour du centre.
  - Le chemin de la rampe (`GEO.ramps.L`) part maintenant de la bouche, comme dans la CAO. Avant, il partait du capteur, 71 mm plus loin : en 3D, la rampe y démarrait au ras du plateau et traversait le bloc du bouchon. La simulation fait partir la bille à l'abscisse du capteur (`sim.rampDepart`).
  - Entrée décalée de 20 mm vers la droite (bouche à x 180), ce qui dégage le bloc du bouchon. TIRER suit, de 16 mm (x 255), avec sa lampe CARREAU. À 18 mm du poteau droit de la bouche, il restait un recoin où la bille se posait ; elle est maintenant à 45 mm.
- Zone du bouchon refaite comme sur un vrai flipper :
  - La pièce du bouchon devient une carcasse creuse : parois de 6 mm, 9 plots Ø 9 avec inserts en haut et en bas. Elle est découpée sous la rampe avec 2 mm de jeu, alors qu'avant elle la traversait jusqu'à s ≈ 128 mm.
  - Par-dessus, un plastique décoré de 3 mm (`plastique_bouchon`) est posé sur des entretoises de 6 mm. Il déborde de 4 mm sur les couloirs et il est échancré là où la rampe passe plus bas que lui.
  - Une enseigne « ★ ESCALE ★ » (`plastique_rampe`, 64 × 20 mm) passe au-dessus du début de la rampe, inclinée de 40° vers le joueur. Son bord avant est à 6,5 mm au-dessus d'une bille sur la rampe, et ses deux pattes sont collées sur les flancs.
- Plus de poteaux de rampe dans le plateau. Ils n'existaient pas dans la physique, donc la bille les traversait, et sur la vraie machine elle s'y serait coincée.
  - Neuf pattes murales en alu de 3 mm (`patte_rampe_*`) passent sous la rampe et la relient au bord le plus proche côté extérieur. Selon l'endroit, elles sont vissées dans la caisse, posées sur le guide d'arche ou sur le séparateur du couloir de lancement, ou vissées contre le flanc de ce séparateur.
  - Un bras long n'est accepté qu'à plus de 40 mm de haut ; plus bas, la patte reste dans l'emprise de la rampe.
  - Au départ de la rampe, la carcasse du bouchon la porte : ses parois touchent maintenant le dessous de la rampe, sans jeu.
  - La première patte, vers (87, 276), a un bras de 147 mm à 51 mm de haut : il faudra la rigidifier, avec une tôle en U ou une nervure.
- Essais de blocage sans rendu (Node, `sim.js`) : environ 2 600 billes lâchées en grille tous les 9 mm et 2 000 tirs aléatoires. Une bille immobile est repérée par les secousses automatiques de la simulation.
  - Un seul arrêt est apparu, dans l'angle entre le mur gauche et le toit du bloc du bouchon, en pente de 14°. Il est corrigé par un congé de 20 mm, présent dans la physique (éventail de triangles : un cercle entier faisait une nouvelle poche contre le mur) et dans le contour de la pièce.
  - Les pointes aiguës (< 60°) de la CAO (`face_poly` dans `cao/construire.py`) gardent un arrondi de 1,5 mm au lieu d'être raccourcies par l'arrondi général de 9 mm.

## Physique 3D Rapier, finitions caisse, robot et bas de plateau (21–22/11)

- **Physique 3D Rapier (WebAssembly)** : `js/sim.js` remplace la simulation 2D Matter.js par Rapier 3D (`vendor/rapier.module.js`, pas fixe 480 Hz, résistance au roulement, bille qui roule et tourne réellement). Les surfaces passives proviennent directement des STL de la CAO via `assets/cao/collision.glb` (`outils/cao_web.py`).
  - Profil de rampe adouci par raccords paraboliques (`z_rampe`) et languette d'entrée métallique (`languette_rampe`) ; pente de montée portée à 25° pour laisser au moins 36 mm au-dessus du toit du bouchon.
- **Finitions de la caisse CAO et vue 3D** :
  - **Habillages de caisse** (`js/habillages.js`, touche H, caméras machine et tour) : 8 décors peints aux cotes WPC (robe à pois, Riviera, terre battue, carte postale, néon, transat, Art déco, frise du plateau) en plus du bois brut.
  - **Charnières extérieures et mode transport** (touche T) : charnières chromées montées à l'extérieur des flancs ; le fronton se rabat sur la caisse en 3D.
  - **Lanceur à ressort Williams B-12445** : modélisé dans la CAO (boîtier, tige, ressorts, pommeau, embout) et animé à tirage progressif (`↓` maintenu puis relâché).
  - **Finitions** : baguettes latérales inox, barre de verrouillage profilée, grille et ventilateur arrière, ouïes d'aération à lames, boulons de carrosserie.
- **Robot joueur expert et banc d'essai** (`js/robot.js`, `outils/robot.mjs`, `outils/robot_tirs.json`) : joue des parties complètes sans rendu sur la physique Rapier + `collision.glb` (berceau, tirs visés étalonnés, frappes de sauvetage) pour mesurer scores, pertes et blocages.
- **Bas du plateau : lance-pierres et plot central** :
  - Lance-pierres écartés du guide (`SL_JEU = 5` mm), remontés de 20 mm (`SL_LEVE`) et redressés à 68° (au lieu de 60,83°) pour supprimer le pincement de la bille entre palette levée et caoutchouc.
  - Ajout d'un **plot central caoutchouté** (`GEO.centerPost` en (239 ; 932,4), Ø 15, `poteau_11` avec anneau noir 5/16" ID dans la CAO), 13 mm sous les pointes des palettes au repos : plus aucune perte directe en étalonnage palettes baissées.
  - **Sortie de rampe relevée à 34 mm** (`Z_FIN = 34`, descente sur 120 mm, courbe en S `y 500 → 625` suivie de 60 mm droits dans l'axe `x = 417`) : le banc d'essai robot avait révélé un coincement sous la descente de rampe vers `(434, 579)` où le fond passait sous les 27 mm de la bille. À 34 mm en sortie (et `patte_rampe_9` à 50,9 mm), la bille passe librement partout dessous (0 blocage en grille au lieu de 168), le couloir extérieur droit est dégagé et la bille retombe droit dans le couloir de retour droit.
- **Autoplay (répertoire technique complet)** (bouton `Autoplay` / touche `A`) : le robot ([js/robot.js](file:///home/adm1/fanny-pinball/js/robot.js)) maîtrise et enchaîne l'ensemble des gestes du flipper moderne (berceau, *Live Catch*, *Drop Catch*, séparation en multibille, *Dead Bounce*, *Post Pass*, *Tap / Alley Pass*, *Shatz*, changement de couloir T-O-U-R, coups droits, revers, *Flick* visé à la volée, *Slap Save*, *Slide Save* et bourrage central surveillé contre le Tilt), affiche le geste en cours dans le bandeau du jeu, et enchaîne les parties hors ligne (PWA) avec `TIRS_DEFAUT` embarqué ; reprendre les commandes manuelles rend aussitôt la main au joueur.
  - Benchmark et optimisation sur 15 parties : remplacement du minuteur aveugle en berceau par un asservissement sur la position réelle `q.le` (garde-fou à `51,2 mm`), `slideSave` prédictif ciblé sur les poteaux d'outlane et `slapSave` synchronisé sur le temps réel avant impact → score moyen **×3,15** (`19 745 → 62 123 pts`, record `328 660`), rampes **×7,1** (`0,53 → 3,80` / partie), **0 %** de tir/passe déclenché trop tard, **0 tilt** et **0 blocage**.
  - Correctifs dans `js/sim.js` : portillon du couloir de lancement remplacé par un pavé analytique épais de 20 mm (`cuboid`) et activé seulement une fois la bille sur le plateau (`x < playRight - 4`), plus seuil d'immobilité à `0,03 m/s` (élimine définitivement tout encastrement de bille sur le portillon).
- **Géométrie batteurs au standard moderne WPC / Stern (Voie A)** :
  - Batteurs 3" exacts (`r1 = 12`, `r2 = 6,5`, `len = 57,7` → 76,2 mm hors-tout), entraxe ramené à 168 mm (`pivotDX = 84`) → **espacement au repos de 45,9 mm (1,70 bille)**, plein milieu du standard 44,5–47,6 mm.
  - Guides d'inlane alignés exactement sur la **face supérieure** du batteur au repos (`24,5°`, sans cassure) ; position haute symétrique (`-22,5°` sur la face supérieure, axe `-28°`), `ROULEMENT = 0,005` et restitution caoutchouc de palette `0,65` : berceau stable à 100 % à toutes les vitesses, *dead bounce* fonctionnel, jeu > 52 mm avec le poteau bas du lance-pierre.
  - Suppression du plot central (`centerPost` / `poteau_11`) devenu inutile à 45,9 mm d'écart, tablier réaligné (`side = 868`, `front = 960`) et ajout du **bourrage latéral** (`Ctrl gauche` / `Ctrl droit` en plus d'`Espace` / `↑` frontal).
  - Chaîne CAO (`99 objets ; 0 échecs`), GLB (`pieces.glb`, `collision.glb`, `caisse.glb`), 12 planches PDF, ré-étalonnage robot (`outils/robot_tirs.json` + `TIRS_DEFAUT`) et cache PWA (`sw.js`) régénérés.

## Revue de réalisme, palettes aux cotes vérifiées et palette motorisée (23/11)

- **Revue du travail de Gemini (21–22/11)** : écarts relevés entre la physique et un vrai flipper (palettes réglées pour faciliter le berceau, aides à la rampe, bumpers qui imposent leur vitesse, portage Rust en 2D avec rampe sur rail et bonus de vitesse ×1,08…). Les points qui restent sont listés dans « Reste à faire ».
- **Document des batteurs corrigé** (`docs/analyse_de_l_espacement…`) : l'entraxe de 158,7–165,1 mm, le repos de 22–25° et la course de 28–32° n'avaient pas de source (et la course rendait le berceau impossible) ; Shatz = Alley Pass ; palettes Lightning ≈ 1/8" plus courtes. Sources en fin de document.
- **Palettes aux cotes sourcées** (`js/table.js`, `pi2/`, `rust3d/`) : axes à 6-7/8" (174,6 mm, WPC 6-13/16" à 7") et à 7" du bas (178 mm), repos 31°, levée 20° (course 51°, valeurs Visual Pinball / Black Knight), palette 3" conservée. L'écart entre les pointes en découle : 62,7 mm (aucune cote publiée pour le fixer). Les guides de retour et les lance-pierres suivent le nouvel angle de repos. CAO régénérée (108 objets, 0 échec ; la CAO commitée avant n'était pas à jour), GLB, 13 planches.
- **Rebond du caoutchouc de palette** ramené de 0,65 à 0,5 (`js/sim.js`), et à 0,5 fixe dans le Rust (il passait de 0,34 à 0,55 selon que la palette bougeait).
- **Palette motorisée** (`js/sim.js`, option `motorisee`, par défaut) : corps Rapier dynamique (inertie 1e-4 kg·m², HYP) tourné par la bobine comme un vrai jeu — coup de puissance de 40 ms (Fliptronics), puis maintien, nouveau coup si une bille rabat la palette (fin de course), ressort de rappel, butées sans rebond. Une tape plus courte que le coup donne une palette moins forte : les passes douces se jouent par des tapes de 4 à 12 ms. Couple étalonné (0,5 N·m) pour des tirs de ≈ 2,5 m/s comme l'ancien modèle ; course à vide 21 ms, retour 77 ms. Le portage Rust garde l'ancienne palette cinématique.
- **Banc des gestes** `node outils/gestes.mjs [--cinematique]` : berceau, tir, rebond mort, passes depuis le berceau, drop catch, chute au centre, mesurés en réussites. Résultats (même banc) :

  | Geste | Avant (Gemini) | Après |
  | :--- | :---: | :---: |
  | Berceau depuis le couloir de retour | 16/16 | 4/16 |
  | Rebond mort rattrapé sur l'autre palette | 7/24 | 0/24 |
  | Passes depuis le berceau | 6/60 | 7/60 |
  | Drop catch | 16/54 | 2/54 |
  | Tir (m/s, frappe à 30–40 mm) | 2,4–2,6 | 2,4–2,5 |
  | Écart entre les pointes | 45,9 mm | 62,7 mm |

  Une bille qui descend lentement le couloir de retour passe par-dessus la palette levée : avec une résistance au roulement de 0,012 ou une levée à −25°, le berceau remonte à 12/16. **Choix de l'utilisateur (23/11) : garder les cotes et le roulement réels sans retouche** ; c'est au modèle d'amortissement du caoutchouc de progresser.
- **Robot** : réétalonné (sa mise en berceau donne une vitesse d'arrivée à la bille) ; 3 parties de 1,2 à 1,5 min, 19 000 à 25 000 points (avant : 2,3 à 3,2 min, 22 000 à 88 000), toutes les billes perdues entre les palettes. Node.js 22 installé sans sudo dans `~/aitools/node` pour les bancs.

## Caoutchoucs, rampe, blocages et nouvelle version native (23/11)

- **Modèle de caoutchouc** (`js/sim.js`, `caoutchouc()`) :
  - **Premier contact** : la restitution dépend de la vitesse d'impact, e(v) = 1 − (1 − e1)·v^0,2. Elle vaut 0,8 pour les anneaux et 0,5 pour la palette à 1 m/s ; elle est plus forte au choc lent et plus faible au choc vif.
  - **Contact maintenu** : perte par hystérésis égale à 0,05 × l'impulsion normale.
  - **Normale** : elle est ramenée dans le plan du plateau, ce qui supprime les rebonds en l'air de la bille sur les caoutchoucs.
  - **Bumpers et lance-pierres** : leur coup s'ajoute au rebond physique.
  - **Tourniquet** : l'énergie qui lance la plaque est prise à la bille.
- **Gestes** (banc `outils/gestes.mjs`) :

  | Geste | Résultat |
  | :--- | :---: |
  | Berceau | 16/16 |
  | Tirs | 2,1 à 3,4 m/s |
  | Rebond mort | 3/24 |
  | Passes G→D | 5/30 |
  | Passes D→G | 1/30 |
  | Drop catch | 6/54 |

  Le banc sous-estime les passes et le drop catch, parce que le joueur simulé ne corrige pas son geste.
- **Rampe** : elle commence par une montée droite, suivie d'un S de deux arcs de 70 mm.
  - Le fond est un maillage lisse calculé, et les tolérances du solveur sont corrigées (`lengthUnit` 1, erreur admise 0,001). Avant, une unité plus petite faisait freiner la bille sur les arêtes internes.
  - Les flancs montent jusqu'à 103 mm, sous la vitre (105 mm), entre s = 120 et 360 mm, avec des raccords en cosinus. C'est là que la bille sortait du canal.
  - La CAO suit : un seul loft réglé pour le gabarit (la fusion échouait sans le dire et laissait du plastique dans le canal) et 9 pattes de 80 mm au plus.
  - Banc `outils/essai_rampe.mjs` : la rampe est faite à partir d'environ 1,8 m/s en tir centré, et de 2,4 m/s pour toutes les entrées. En dessous de 1,6 m/s, la bille redescend.
- **Points de blocage** (`outils/blocages.mjs`) :
  - Le plateau entier a été balayé au pas de 25 mm, avec plusieurs vitesses de départ. Il ne reste aucun vrai piège : les poteaux ne donnent que des équilibres instables.
  - Pour éviter les faux blocages, le critère est maintenant une bille immobile 3 s à 1 mm près.
- **Contacts déclenchés à 2 cm** (trouvé en traquant les billes « en jeu » du balayage) :
  - Cause : avec `lengthUnit` 1, la distance de prédiction des contacts de Rapier vaut par défaut 0,02 × 1 m, soit 20 mm. Les contacts « commencés » partaient donc à 2 cm de la pièce : un bumper frappait la bille avant qu'elle ne le touche, une cible tombait à distance.
  - Effet visible : au coin du toit du bouchon, le bumper voisin renvoyait la bille vers le haut, et elle faisait des allers-retours sur le toit.
  - Correction : la prédiction est ramenée à 2 mm (`normalizedPredictionDistance` 0,002), dans la version web comme dans la version native.
  - Nouveau balayage :

    | | Avant | Après |
    | :--- | :---: | :---: |
    | Points d'arrêt | 4 | 1 |
    | Billes encore en mouvement à 6 s | 316 | 108, dispersées dans le bas du plateau |
    | Blocages depuis la rampe | 2 | 0 |

    Le point restant est une bille posée pile au sommet du poteau haut du lance-pierres droit (2 départs sur 1 286). C'est un équilibre instable, et un bourrage la libère.
- **Frottement de pivotement** :
  - Constat : la prédiction corrigée a fait tomber le berceau de 16/16 à 0/16. Le 16/16 venait du freinage fantôme à 2 cm. Avec les vrais contacts, une bille qui frappe la palette en biais prend une rotation autour de la verticale, que Rapier ne freine jamais. Cette rotation la poussait le long de la palette levée, par-dessus la pointe.
  - Correction : un frottement de pivotement au plateau est ajouté (`PIVOTEMENT`, 13 rad/s²). Il vient de μ 0,2 et d'une tache de contact d'environ 0,5 mm ; cette valeur est une estimation, pas une mesure.
  - Banc des gestes :

    | Geste | Résultat |
    | :--- | :---: |
    | Berceau, palette tenue | 8/16 |
    | Tirs | 2,1 à 2,6 m/s |
    | Rebond mort | 5/24 |
    | Passes G→D | 5/30 |
    | Passes D→G | 3/30 |
    | Drop catch | 10/54 |

  - Nouvel essai au banc : la réception depuis le couloir de retour (palette levée au passage de la bille).
- **Recherche de bille au lieu de la secousse invisible** :
  - Avant : une bille immobile depuis 1,5 s recevait une vitesse sans aucune cause physique.
  - Maintenant, comme sur une vraie machine, après 8 s d'immobilité les bobines pulsent. Seul le bumper ou le lance-pierres que la bille touche la frappe. Ailleurs, c'est au joueur de bourrer la caisse.
- **Visée du robot** : la table `LE_VOL` (position le long de la palette où frapper pour chaque cible) est réétalonnée sur la physique du jour par `outils/etalonner_le.mjs`.
  - La rampe se fait depuis la palette droite, avec `le` entre 35 et 36,5 mm : une fenêtre étroite, comme sur une vraie machine.
  - Depuis la palette gauche, elle est inaccessible, ce qui est normal puisque l'entrée regarde la palette droite.
  - Parties du robot : 1,3 à 2 minutes, 17 000 à 71 000 points, presque toutes les billes perdues entre les palettes.
- **Collision de la CAO** : les triangles d'aire nulle (sommets arrondis au 0,1 mm dans les STL) sont retirés à l'export (`outils/cao_web.py`).
- **Résistance au roulement sur la rampe** : le même coefficient de 0,005 que sur le plateau s'applique quand la bille roule sur le fond de la rampe. Au tir centré, la rampe demande maintenant environ 2 m/s ; à 2,4 m/s, elle est faite pour toutes les entrées.
- **Vitre** : dans le S de rayon 70 mm, une bille à 2,4–2,8 m/s grimpe le flanc extérieur relevé jusqu'à toucher la vitre (23 essais sur 180). Elle ne peut pas passer par-dessus, puisqu'il reste 2 mm de jeu.
- **Version native réécrite** (`natif/`, voir son README) :
  - Le monde physique est exporté de la version web (`outils/exporter_natif.mjs` → `monde.json`), et la physique de `js/sim.js` est portée sur rapier3d : palettes motorisées, caoutchoucs, bobines, tourniquet.
  - Les règles sont portées ligne à ligne.
  - La scène 3D de la version web est exportée en glTF avec l'habillage de la caisse et le plateau repeint à 3,2 px/mm (`outils/exporter_scene_natif.mjs`). Elle est rendue en OpenGL 3.3 avec mipmaps et filtrage anisotrope.

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
| Réalisme : roulement | Mesurer si possible la résistance au roulement réelle |
| Réalisme : lanceur | Lanceur par tige à ressort |
| Réalisme : rampe | Bille qui touche la vitre dans le S serré (R70) à 2,4–2,8 m/s : élargir le virage ou ajouter une lèvre sur le flanc extérieur |
| Réalisme : aides invisibles | Plafond de vitesse 6 m/s |
| Robot | Réflexes de sauvetage à revoir : il perd presque toutes ses billes entre les palettes |
| Version native | Afficheurs du fronton (aujourd'hui dans le titre de la fenêtre) ; caméras pilotables (tour, lilliputien) ; ombres |
| Plateau | Allongé à 1263 mm par Gemini (standard : 1067 mm) : à rediscuter avec la caisse |
