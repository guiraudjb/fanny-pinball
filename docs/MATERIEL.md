# Réplique physique : matériel

Le jeu web sert de maquette à une vraie table. Tout ce qui est dans le jeu doit pouvoir
être construit avec un **Arduino Mega 2560 Pro**, des **afficheurs TM1637**, des LED
**WS2812B**, des **boutons d'arcade**, une **imprimante 3D** et des pièces de flipper du
commerce.

## Principes retenus dans le jeu

| Élément du jeu | Réalisation physique |
|---|---|
| Échelle | 1 unité du jeu = 1 mm. Plateau standard 514 × 1067 mm (20,25" × 42"), bille de flipper 27 mm (1-1/16"), flippers de 63 mm d'axe à pointe, axes écartés de 174 mm à 180 mm du bas, angles 31° / 19°, bumpers à anneau Ø 57 mm et chapeau Ø 68 mm, banque de cibles à 75° au pas de 28 mm, entrée de rampe de 52 mm — cotes relevées dans les tables VPX Black Knight (1980), Black Hole (1981) et Top Score (1975) |
| Règles (`js/rules.js`) | Code à porter presque ligne à ligne en C++ sur le Mega |
| Contacts | Un contact = une entrée du Mega (INPUT_PULLUP, contact vers la masse) |
| Flippers, bumpers, lance-pierres | Le Mega tire la bobine dès que le bouton ou le contact se ferme |
| Lanceur | Bouton d'arcade + bobine de lancement automatique (pas de lanceur à ressort) |
| Le Cercle | Trou d'éjection latéral en haut à droite (comme les « kickout holes » Gottlieb), la bobine renvoie la bille vers les bumpers |
| Couloir du bouchon | Couloir de 38 mm en haut à gauche, dans l'axe du tir de la palette droite, cochonnet (cible fixe ronde rouge) au fond ; blocs pleins à toit en pente de part et d'autre |
| Cibles rondes du mur gauche | 3 cibles fixes à face ronde montées à fleur d'une paroi verticale pleine (pas d'encoche entre elles) |
| Changement de couloir | Le Mega lit aussi les boutons des flippers : chaque appui décale les lettres T-O-U-R allumées |
| Multiball | Le Cercle réexpulse toujours la bille (verrou virtuel) ; les 2 autres billes sortent du bac et sont lancées automatiquement |
| Cibles F-A-N-N-Y | Banque de 5 cibles tombantes en diagonale contre le mur droit (75°), tournée vers le flipper gauche, adossée à un bloc plein ; une seule bobine de remise |
| Rampe | Une seule rampe, à la manière des premières tables à rampe (Black Knight, 1980) : entrée à gauche au tiers de la hauteur, passage au-dessus des couloirs T-O-U-R en suivant l'arrondi du haut, descente à droite vers le couloir de retour droit. Fil d'acier cintré ou tronçons imprimés |
| Couloirs du bas | Guides de couloir de retour dans le prolongement exact du dessus des flippers ; couloirs de 34 mm pour la bille de 27 mm |
| Lancement | Puissance fixe (bobine) réglée pour suivre l'arrondi du haut et retomber dans les couloirs T-O-U-R / les bumpers |
| Lampes | Une LED WS2812B par lampe, dans l'ordre de `LAMP_LAYOUT` (`js/render.js`) |
| Afficheurs | 2 × TM1637 4 chiffres pour le score (8 chiffres), 1 × TM1637 pour « bille + multiplicateur » ; même police 7 segments que `js/segfont.js` |
| Sons | DFPlayer Mini : piste `00NN.mp3` = numéro `SND` de `js/rules.js` |

## Inventaire : ce qui s'achète, ce qui s'imprime

L'Arduino ne fabrique rien de mécanique : il lit des contacts et commande des bobines.
Tout ce qui bouge ou encaisse des chocs vient du commerce ou de l'imprimante.

### À acheter (impossible ou déconseillé à fabriquer)

| Pièce | Qté | Pourquoi l'acheter |
|---|---|---|
| **Bobines (solénoïdes)** | 11 | Cœur de toute la mécanique. Les solénoïdes génériques 12/24 V sont trop faibles pour des flippers ; prendre de vraies bobines de flipper au moins pour les flippers et les bumpers |
| **Mécanismes de flipper complets** (palette, axe, bague, biellette, ressort de rappel, support) | 2 | L'axe et la bague doivent être en métal : une palette imprimée casse ou prend du jeu |
| **Palettes de flipper avec caoutchouc** | 2 | Souvent fournies avec le mécanisme |
| **Ensembles bumper** (corps, jupe, anneau, culasse, contact) | 3 | L'anneau qui frappe la bille et sa tige sont métalliques ; seul le chapeau s'imprime (boule de pétanque) |
| **Caoutchoucs** (anneaux de tailles variées, embouts de poteaux) | ~15 | Le rebond vient du caoutchouc |
| **Bras de lance-pierre + contacts à lames** | 2 | Le bras métallique encaisse les chocs ; la lame doit être en métal |
| **Contacts de couloir** (micro-rupteurs à fil, « rollover ») | 4 + 1 rampe | Le fil acier qui affleure le plateau ne s'imprime pas ; on peut remplacer par une barrière infrarouge |
| **Cibles fixes** POINTER / TIRER / BOUCHON + 3 cibles rondes du mur gauche | 6 | Pièce bon marché, ou micro-rupteur + face imprimée |
| **Contacts du bac à billes et de l'évacuation** | 4 | Micro-rupteurs à levier |
| **Billes de flipper 27 mm** (1-1/16") | 3 + rechange | Billes standard de flipper |
| **Vitre trempée 4 mm** | 1 | Sécurité |
| **Contreplaqué 12 mm** (plateau) + bois de caisse | — | Découpe scie, pas imprimable |
| **Électronique** : Mega 2560 Pro, 11 modules MOSFET logiques (IRLZ44N ou équivalent), diodes 1N4007, alimentation 24 V ≥ 10 A, alimentation 5 V 4 A, fusibles, borniers | — | |
| **Afficheurs** TM1637 4 chiffres | 3 | Rouge pour le score, orange pour l'info |
| **Bande WS2812B** (60 LED/m, découpée) | ~30 LED + éclairage général | |
| **Son** : DFPlayer Mini + carte micro SD + haut-parleur 4 Ω 3 W | 1 | |
| **Boutons d'arcade** : flipper G, flipper D, lancer, start | 4 | Déjà en stock |

### À imprimer en 3D

| Pièce | Remarque |
|---|---|
| Rampe | En tronçons qui tiennent sur le plateau d'impression, assemblés par queues d'aronde ; PETG conseillé |
| Guides de couloirs, poteaux, séparateurs | Poteaux autour d'une vis, embout caoutchouc acheté |
| Chapeaux de bumpers « boules de pétanque » | Translucides, LED WS2812B dessous |
| Coque du Cercle (trou de verrouillage) + support de bobine | Micro-rupteur au fond |
| Corps des cibles F-A-N-N-Y + glissières + bloc arrière | Possible mais délicat ; sinon acheter une banque de 5 |
| Faces des cibles fixes | Sur micro-rupteur |
| Bac à billes et rampe du couloir de lancement | Avec emplacements des micro-rupteurs |
| Portillon à sens unique | Ou fil d'acier plié |
| Supports de LED et diffuseurs d'inserts | Un par lampe |
| Façades des afficheurs, tablier bas | |

### Contacts mécaniques : récapitulatif

| Contact | Type conseillé |
|---|---|
| Boutons flipper / lancer / start | Boutons d'arcade (en stock) |
| Couloirs T-O-U-R | Contact « rollover » à fil sous le plateau |
| Sortie de rampe | Rollover à fil ou barrière IR sur la rampe |
| Cibles F-A-N-N-Y ×5 | Micro-rupteur sous chaque cible (fermé quand elle tombe) |
| Cibles fixes ×2 | Contact à lames intégré ou micro-rupteur |
| Bumpers ×3 | Contact à lames de la jupe (fourni avec l'ensemble) |
| Lance-pierres ×2 | Contacts à lames derrière le caoutchouc |
| Le Cercle | Micro-rupteur au fond du trou |
| Couloir de lancement | Micro-rupteur à levier sous la bille au repos |
| Évacuation + bac à billes ×3 | Micro-rupteurs à levier |

## Câblage proposé sur le Mega 2560 Pro

Entrées en `INPUT_PULLUP`, contact entre la broche et la masse.

| Broche | Entrée | Broche | Entrée |
|---|---|---|---|
| D22 | Bouton flipper gauche | D35 | Cible POINTER |
| D23 | Bouton flipper droit | D36 | Cible TIRER |
| D24 | Bouton lancer | D37 | Le Cercle |
| D25 | Bouton start | D38 | Sortie de rampe |
| D26–D29 | Couloirs T, O, U, R | D39 | Bouchon |
| D30–D34 | Cibles F, A, N, N, Y | D40, D41 | Lance-pierres G, D |
| D42, D43, D47 | Bumpers 1, 2, 3 | D48 | Couloir de lancement |
| D49 | Évacuation | D50–D52 | Bac à billes 1–3 |
| D44–D46 | Cibles rondes 1, 2, 3 (mur gauche) | | |

Sorties vers les modules MOSFET (bobines en 24 V, diode de roue libre sur chaque bobine).

| Broche | Bobine | Remarque |
|---|---|---|
| D2 | Flipper gauche | PWM : impulsion pleine ~40 ms puis maintien ~25 % |
| D3 | Flipper droit | PWM, idem |
| D4, D5 | Lance-pierres G, D | Impulsion ~20 ms |
| D6, D7, D8 | Bumpers 1, 2, 3 | Impulsion ~20 ms |
| D9 | Le Cercle (éjection) | |
| D10 | Remise des cibles F-A-N-N-Y | |
| D11 | Éjection du bac à billes | |
| D12 | Lanceur automatique | |

Autres périphériques :

| Broche | Périphérique |
|---|---|
| A0 | Données WS2812B (résistance 330 Ω en série, condensateur 1000 µF sur le 5 V) |
| A1 / A2 | TM1637 score, 4 premiers chiffres (CLK / DIO) |
| A3 / A4 | TM1637 score, 4 derniers chiffres |
| A5 / A6 | TM1637 info (bille + multiplicateur) |
| D18 / D19 | DFPlayer Mini (Serial1 TX1 / RX1, résistance 1 kΩ sur RX du DFPlayer) |

Il reste environ 12 broches libres (A7–A15, D53) pour des ajouts.

## Sécurité électrique

- Une bobine bloquée sous tension brûle en quelques secondes : le programme coupe toute
  bobine après un délai maximum, et chaque groupe est protégé par un fusible.
- Masse commune entre le 24 V, le 5 V et le Mega ; alimentations séparées pour la
  puissance et la logique.
- Diode de roue libre (1N4007) aux bornes de chaque bobine, cathode vers le +24 V.
- Ne jamais alimenter la bande WS2812B par le régulateur du Mega.

## Sons et musiques

Les sons du jeu web sont synthétisés en attendant les vrais fichiers ; leur numéro
(`SND` dans `js/rules.js`) est déjà le numéro de piste du DFPlayer.

- Bruitages (pistes 1 à 21) : synthèse physique, `outils/bruitages.py`.
- Musiques (22 générique, 23 thème) : **YuE2**, `outils/musique_yue2.py`.
- Voix de Fanny (24 à 44 : « Carreau ! », « Triplette ! », escales…) : **VoiceStudio**, voix clonée sur le chant
  du générique, `outils/voix_fanny.py`. Le DFPlayer ne joue qu'une piste à la fois : sur la réplique, la voix
  passe avant le bruitage (ou un second DFPlayer sur Serial2, D16/D17, pour superposer musique et voix).
