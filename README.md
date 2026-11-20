# Fanny Pinball

Flipper web avec Fanny, championne de pétanque : **Fanny Pétanque World Tour**.
Prototype HTML5 + [Matter.js](https://brm.io/matter-js/), pensé dès le départ pour une
**réplique physique** pilotée par un Arduino Mega 2560 Pro (afficheurs TM1637, LED WS2812B,
boutons d'arcade, pièces imprimées en 3D) : voir [docs/MATERIEL.md](docs/MATERIEL.md).

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
- **T-O-U-R** : les couloirs du haut et les bumpers (tous les 3 coups) allument les lettres ;
  TOUR complet = bonus ×2, ×3 … ×5, et le ×5 allume l'**extra ball** au Cercle (lampe EB).
  **Changement de couloir** : chaque appui sur un batteur décale les lettres allumées.
- **Le Cercle** est un trou d'éjection en haut à droite.
- **Couloir du bouchon** (haut gauche, tir de la palette droite) : le cochonnet allume le
  **CARREAU** sur TIRER pendant 20 s (lettre + 10 000 × n). POINTER puis BOUCHON = **BIBERON**.
- **Trois cibles rondes** du mur gauche : les trois = **TRIPLETTE** (lettre + boule pointée).
- **Rampe** : chaque passage allume l'escale suivante du World Tour (Marseille → Sydney) ;
  en multiball, chaque rampe rapporte le **jackpot**. 7 escales = Grand Chelem (+50 000) + **extra ball**.
- **Extra ball** : deux au plus par partie (lampe REJOUE) ; au-delà, elle vaut 25 000.
- 3 billes, sauvetage de bille 8 s ; le **bonus** de fin de bille est décompté sous les yeux du
  joueur (« BONUS X3 », puis le score monte par paquets).
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
| Lancer | Espace, ↓ | couloir de lancement |
| Nouvelle partie | Entrée | bouton Jouer |
| Pièce (crédit) | C | |
| Pause / son | P / M | |

## Organisation du code

| Fichier | Rôle |
|---|---|
| `js/table.js` | Géométrie en millimètres réels et corps Matter.js |
| `js/rules.js` | Règles : contacts → bobines, lampes, afficheurs, sons (à porter en C++ sur le Mega) |
| `js/sim.js` | Physique : transforme les chocs en contacts, exécute les bobines |
| `js/render.js` | Dessin du plateau ; `LAMP_LAYOUT` = ordre des LED WS2812B |
| `js/segfont.js` | Police 7 segments identique aux TM1637 |
| `js/audio.js` | Bruitages `assets/sons/00NN.mp3` (= pistes du DFPlayer), musique ; synthèse en repli |

## Habillage et sons

Ambiance d'été provençal, ode à la pétanque, avec une touche d'humour.

| Outil | Rôle |
|---|---|
| `outils/habillage_krea2.py` | Plateau, fronton, sprites de Fanny avec Krea 2 (client ComfyUI de chat-studio, ADN « Fanny Pin-up Rétro » + style « Comics Moderne Cell-Shading ») → `assets/brut/` |
| `outils/preparer_assets.py` | Choix des variantes → `assets/` (recadrage, disque des bumpers, détourage du fond vert) |
| `outils/bruitages.py` | Bruitages par synthèse physique, sans IA : boules d'acier, carillons des années 70, bobines, knocker |
| `outils/musique_yue2.py` | Générique et thème façon variété des années 70 avec YuE2 (pistes 22, 23) |
| `outils/voix_fanny.py` | Voix de Fanny : demucs isole son chant dans le générique, VoiceStudio la clone (voix de synthèse) et dit les répliques de `outils/voix_fanny.json` (pistes 24 à 44) |
