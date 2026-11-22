# Fanny Pinball

Flipper web avec Fanny, championne de pétanque : **Fanny Pétanque World Tour**.
Prototype HTML5, physique 3D [Rapier](https://rapier.rs/) (WebAssembly), pensé dès le départ pour une
**réplique physique** pilotée par un Arduino Mega 2560 Pro (afficheurs TM1637, LED WS2812B,
boutons d'arcade, pièces imprimées en 3D) : voir [docs/MATERIEL.md](docs/MATERIEL.md).

- [Cahier des charges](docs/CAHIER_DES_CHARGES.md) : les exigences du projet et leur état.
- [Progression](docs/PROGRESSION.md) : les étapes franchies et ce qui reste à faire.

## Jouer en ligne, installer l'application

**https://guiraudjb.github.io/fanny-pinball/**

La page est une application installable (PWA) : « Installer l'application » dans Chrome/Edge,
ou « Sur l'écran d'accueil » dans Safari. Le jeu entier (≈ 6,5 Mo, sons compris) est mis en cache à
la première visite et se joue ensuite hors ligne, en plein écran.

Après toute modification des fichiers servis, relancer `python3 outils/pwa.py` avant le commit :
il régénère les icônes et la liste du service worker (`sw.js`), dont la version est l'empreinte des
fichiers. Les joueurs reçoivent ainsi la nouvelle version au chargement suivant. En local
(`localhost`, `127.0.0.1`), le service worker n'est pas enregistré, sauf avec `?sw=1`.

## Lancer en local

```sh
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000 (les modules ES ne se chargent pas en `file://`).

## Règles (esprit flipper des années 70)

- **F-A-N-N-Y** : abattre les 5 cibles allume **le Cercle** ; une bille dans le Cercle allumé
  lance le **multiball Triplette** (3 billes). Ensuite il faut F-A-N-N-Y deux fois, puis trois…
- **Jackpot** : en multiball, chaque rampe rapporte le jackpot (20 000, +5 000 à chaque fois,
  +10 000 par F-A-N-N-Y ; la valeur reste acquise pour le multiball suivant). Trois jackpots
  allument le **super jackpot** au Cercle (3 × le jackpot).
- **T-O-U-R** : seul le passage dans un couloir du haut allume sa lettre ;
  TOUR complet = bonus ×2, ×3 … ×5, et le ×5 allume l'**extra ball** au Cercle (lampe EB).
  **Changement de couloir** : chaque appui sur un batteur décale les lettres allumées.
- **Le Cercle** est un trou d'éjection en haut à droite.
- **Couloir du bouchon** (haut gauche, tir de la palette droite) : le cochonnet allume le
  **CARREAU** sur TIRER pendant 20 s (10 000 × n). POINTER puis BOUCHON = **BIBERON**.
- **Trois cibles rondes** du mur gauche : les trois = **TRIPLETTE** (boule pointée).
- **Rampe** : chaque passage allume l'escale suivante du World Tour (Marseille → Sydney) ;
  en multiball, chaque rampe rapporte le **jackpot**. 7 escales = Grand Chelem (+50 000) + **extra ball**.
- **Extra ball** : deux au plus par partie (lampe REJOUE) ; au-delà, elle vaut 25 000.
- 3 billes, sauvetage de bille 8 s ; le **bonus** de fin de bille est décompté sous les yeux du
  joueur (« BONUS X3 », puis le score monte par paquets).
- **Bourrage et tilt** : la barre d'espace donne un coup de caisse (la bille reprend de l'élan,
  la table tressaute). Un coup par seconde ne craint rien ; des coups rapprochés font osciller le
  pendule : deux « ATTENTION » par bille, puis **TILT** sur les afficheurs : batteurs, bumpers et
  lance-pierres coupés, plus aucun point, bille perdue sans bonus.
- **Le clac** : le knocker claque et une **partie gratuite** est gagnée à 150 000, 300 000 et
  500 000 points, et quand le record est battu.
- **Le match** : en fin de partie, l'afficheur info tire un nombre de 00 à 90 ; s'il tombe sur les
  deux derniers chiffres du score, clac et partie gratuite. Les parties gratuites (9 au plus,
  gardées dans le navigateur) sont consommées par START, affichées « CR n » ; la touche C
  ajoute une pièce, mais le jeu web reste en partie libre.

## Commandes

| Action | Clavier | Tactile |
|---|---|---|
| Flipper gauche | Maj gauche, ← | moitié gauche du plateau |
| Flipper droit | Maj droite, → | moitié droite du plateau |
| Lancer | ↓, Entrée | couloir de lancement |
| Bourrage (coup de caisse) | Espace | |
| Nouvelle partie | Entrée | bouton Jouer |
| Pièce (crédit) | C | |
| Pause / son | P / M | |
| Vue 2D / 3D / 3D légère | V | bouton Vue |
| Caméra 3D (joueur, haute, plateau, machine, tour) | K | bouton Caméra ; en « tour » : glisser pour tourner, molette pour zoomer |
| Vue machine : verrouiller l'angle et le zoom | L | glisser pour l'angle, molette ou pincer pour le zoom, puis bouton « Verrouiller la vue » pour jouer à la souris ou au doigt |

## Organisation du code

| Fichier | Rôle |
|---|---|
| `js/table.js` | Géométrie en millimètres réels ; corps Matter.js servant de gabarits 2D (formes, rendu 2D) |
| `js/rules.js` | Règles : contacts → bobines, lampes, afficheurs, sons (à porter en C++ sur le Mega) |
| `js/sim.js` | Physique 3D (Rapier, `vendor/rapier.module.js`) : la bille d'acier roule et rebondit sur les surfaces réelles de la CAO (`assets/cao/collision.glb`) et sur les éléments actifs ; transforme les chocs en contacts, exécute les bobines |
| `js/render.js` | Dessin du plateau en 2D ; `LAMP_LAYOUT` = ordre des LED WS2812B ; `drawFloor()` peint aussi la texture du plateau 3D |
| `js/render3d.js` | Vue 3D (Three.js r170, `vendor/`, chargé à la demande) : plateau incliné, pièces de la CAO (`assets/cao/pieces.glb`), caisse, pieds et fronton avec afficheurs (`assets/cao/caisse.glb`), ombres, bille d'acier ; même physique |
| `js/habillages.js` | Habillages provisoires de la caisse en 3D (bouton « Habillage » / touche H, caméras machine et tour) : huit décors dessinés aux cotes de la caisse WPC avec la palette et les sprites |
| `outils/cao_web.py` | Pièces et caisse de la CAO (STL) → `assets/cao/pieces.glb` et `caisse.glb` pour la vue 3D, `collision.glb` pour la physique, sans dépendance |
| `js/segfont.js` | Police 7 segments identique aux TM1637 |
| `js/audio.js` | Bruitages `assets/sons/00NN.mp3` (= pistes du DFPlayer), musique ; synthèse en repli |

## Réplique physique : plans et CAO

Le dossier `cao/` génère le modèle 3D (FreeCAD) et les plans cotés de la réplique à partir de la géométrie du jeu :
- plateau percé, pièces à imprimer, détecteurs ;
- caisse et fronton aux cotes WPC.

Voir [docs/CONSTRUCTION.md](docs/CONSTRUCTION.md) et [docs/plans/plans_fanny_pinball.pdf](docs/plans/plans_fanny_pinball.pdf).

## Habillage et sons

Ambiance d'été provençal, ode à la pétanque, avec une touche d'humour.

| Outil | Rôle |
|---|---|
| `outils/habillage_krea2.py` | Plateau, fronton, sprites de Fanny avec Krea 2 (client ComfyUI de chat-studio, ADN « Fanny Pin-up Rétro » + style « Comics Moderne Cell-Shading ») → `assets/brut/` |
| `outils/preparer_assets.py` | Choix des variantes → `assets/` (recadrage, disque des bumpers, détourage du fond vert) |
| `outils/bruitages.py` | Bruitages par synthèse physique, sans IA : boules d'acier, carillons des années 70, bobines, knocker |
| `outils/musique_yue2.py` | Générique et thème façon variété des années 70 avec YuE2 (pistes 22, 23) |
| `outils/voix_fanny.py` | Voix de Fanny : demucs isole son chant dans le générique, VoiceStudio la clone (voix de synthèse) et dit les répliques de `outils/voix_fanny.json` (pistes 24 à 44) |
