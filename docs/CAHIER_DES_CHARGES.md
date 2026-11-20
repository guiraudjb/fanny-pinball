# Cahier des charges — Fanny Pinball

Exigences du projet, telles que formulées au fil de sa construction. Chaque ligne a un état :
✅ fait · 🔶 partiel · ⬜ à faire. Le détail des étapes est dans [PROGRESSION.md](PROGRESSION.md).

## 1. Objet

Un flipper **« Fanny Pétanque World Tour »** :

1. un **jeu web** jouable au clavier et au tactile (HTML5 + Matter.js), qui sert de maquette ;
2. une **réplique physique** fidèle à cette maquette, pilotée par un Arduino Mega 2560 Pro
   ([MATERIEL.md](MATERIEL.md)).

La maquette doit donc rester transposable telle quelle : mêmes cotes, mêmes contacts, mêmes
lampes, mêmes pistes sonores.

## 2. Esprit de jeu

| Exigence | État |
|---|---|
| Thème pétanque, avec Fanny, championne pin-up rétro | ✅ |
| Gameplay **simple, esprit flipper des années 70** : peu de règles, lisibles | ✅ |
| Rampe, bonus, multiball | ✅ |
| Une lettre T-O-U-R ne s'allume **que** par le passage dans son couloir (ni bumpers, ni TRIPLETTE, ni CARREAU) | ✅ |
| **Changement de couloir** : les appuis sur les batteurs décalent les lettres T-O-U-R allumées | ✅ |
| Haut du plateau garni : chemins et bonus à prendre (tir au carreau, tir au bouchon…) | ✅ |
| Cibles rondes verticales sur le côté gauche, à gauche de la lumière POINTER | ✅ |
| Le Cercle (trou d'éjection) en haut et sur un côté, pas au milieu du plateau | ✅ |

## 3. Géométrie et physique

| Exigence | État |
|---|---|
| **Proportions réelles** en millimètres, relevées sur des tables VPX / VPinMAME de référence | ✅ |
| Angles de rampe réalistes (pas trop raides) | ✅ |
| Flippers alignés et à la bonne taille ; bumpers à la bonne taille | ✅ |
| Cibles tombantes en diagonale | ✅ |
| **Une seule rampe**, sur l'arrondi du haut, entrée visée par le flipper droit, parcours de gauche à droite | ✅ |
| Le lancement retombe dans les couloirs du haut / les bumpers | ✅ |
| **Trois couloirs** de chaque côté en bas (sortie + deux couloirs de retour), lance-pierres rapprochés du centre | ✅ |
| Lance-pierres à l'entraxe du mécanisme Williams 500-5849 (face de 101 mm) | ✅ |
| **Aucune bille coincée** (vérifié par lâchers de billes en grille et parties automatiques) | ✅ |

## 4. Règles de jeu (boucle complète)

| Exigence | État |
|---|---|
| Bonus de fin de bille × multiplicateur, décompté sous les yeux du joueur | ✅ |
| Multiball (3 billes) au Cercle, rallumage progressif | ✅ |
| Jackpots en multiball, super jackpot | ✅ |
| Extra ball (allumée au Cercle, Grand Chelem), plafonnée par partie | ✅ |
| **Le clac** (knocker) et sa **partie gratuite** aux paliers de score et au record | ✅ |
| **Loterie de fin de partie (match)** pour gagner une partie supplémentaire | ✅ |
| Crédits gardés entre deux sessions ; monnayeur facultatif sur la réplique | ✅ |
| Sauvetage de bille | ✅ |
| **Bourrage** à la barre d'espace (coup de caisse) | ✅ |
| **Tilt** : pendule, deux avertissements, puis TILT sur les afficheurs, alimentation coupée, bille perdue sans bonus | ✅ |

## 5. Habillage

| Exigence | État |
|---|---|
| Images générées avec **Krea 2** (via chat-studio) : ADN « Fanny Pin-up Rétro », style « Comics Moderne Cell-Shading » | ✅ |
| **Composition vintage** aux couleurs flashy de Fanny ; **ambiance estivale**, clin d'œil à la pétanque | ✅ |
| « Une œuvre d'art, une ode à la pétanque », avec une **touche d'humour** | ✅ |
| Plateau, rampe, bumpers, lance-pierres habillés | ✅ |
| **Vue 3D** façon Visual Pinball (plateau incliné, volumes, ombres, bille d'acier), vue 2D conservée ; pièces de la CAO, caméras, version légère | ✅ |
| **Fronton** « Fanny Pétanque World Tour » | ✅ |
| Cigale à lunettes dans l'arbre près du soleil, intégration lissée par IA (inpainting Krea 2 dans ComfyUI) | ✅ |
| Pièces en plastique **sans angles vifs** ; la pièce au-dessus du cochonnet d'un seul tenant, arrondie | ✅ |
| Couleurs des pièces **assorties au reste de la table** (lavande, ocre) ; liseré ocre épais | ✅ |

## 6. Sons

| Exigence | État |
|---|---|
| Mélodie estivale (YuE2) : générique chanté et thème de jeu | ✅ |
| **Vrais bruitages** (synthèse physique, sans IA) : boules d'acier, carillons, bobines, knocker | ✅ |
| **Voix de Fanny**, la même que sur la chanson (clonée sur le chant du générique, déclarée voix de synthèse) | ✅ |
| Écoute de contrôle des voix par un humain | 🔶 à faire par le porteur du projet |

## 7. Réplique physique

| Exigence | État |
|---|---|
| Arduino Mega 2560 Pro, afficheurs TM1637, LED WS2812B, boutons d'arcade, DFPlayer Mini | 🔶 câblage et brochage définis ([MATERIEL.md](MATERIEL.md)) |
| Pièces imprimées en 3D | 🔶 liste établie, modèles à dessiner |
| Inventaire des pièces impossibles à fabriquer (à acheter) | ✅ |
| Règles portées en C++ (le module `js/rules.js` n'utilise que compteurs, drapeaux et minuteries) | ⬜ |

Plans et modèle 3D : [CONSTRUCTION.md](CONSTRUCTION.md).
- Les plans sont générés depuis la géométrie du jeu.
- Les cotes des pièces du commerce non vérifiées sont signalées en orange.
- La caisse suit les cotes Williams WPC « standard body » (contreplaqué 19 mm).

## 8. Contraintes de réalisation

- Dépôt **public** : le code, les images de Fanny, les sons et les musiques y sont publiés.
- Page publiée sur GitHub Pages en **application installable (PWA)**, jouable hors ligne.
- Tout ce qui peut se faire **sans IA** (calcul, géométrie, synthèse sonore, retouche) se fait sans IA.
- Outils locaux uniquement (Krea 2 / ComfyUI, YuE2, VoiceStudio, demucs sur les machines du labo).
