# Réflexion : Performances et passage en « jeu classique » (hors navigateur)

## 1. Diagnostic : pourquoi la version web actuelle est gourmande

La consommation de ressources ne vient pas uniquement du navigateur (~20 %), mais majoritairement de la charge brute envoyée au moteur physique et au moteur 3D (~80 %) :

1. **Physique CPU (`js/sim.js`, `assets/cao/collision.glb`)**
   - Rapier3D tourne en WebAssembly à **480 Hz** (`DT_MS = 1000 / 480`, soit 8 sous-pas par image à 60 FPS × 8 itérations du solveur = 64 passes par image, avec CCD activé).
   - Le maillage de collision `assets/cao/collision.glb` contient **~93 000 triangles**, issus directement des STL haute précision générés pour l'impression 3D.

2. **Rendu 3D GPU (`js/render3d.js`, `assets/cao/pieces.glb`, `assets/cao/caisse.glb`)**
   - La scène charge **~211 500 triangles** (`pieces.glb` ~142 800 + `caisse.glb` ~68 700), plus les éléments procéduraux (fils chromés, bumpers, inserts).
   - Une shadow map `2048×2048` (`PCFSoftShadowMap`) est recalculée **60 fois par seconde** sur toute la géométrie alors que plus de 95 % du décor est statique.
   - 32 matériaux et textures séparés pour les inserts lumineux, matériaux `MeshPhysicalMaterial` (`clearcoat`), antialiasing activé et `dpr = 1.5`.

3. **Surcoût navigateur**
   - Gestion des onglets, ramasse-miettes JavaScript, couches WebAssembly et WebGL.

---

## 2. Trois pistes pour tourner en mode « jeu classique »

### Option 1 — Optimisation radicale + application bureau dédiée *(rapide, zéro réécriture)*
Conserver le code et la synchronisation directe avec la CAO FreeCAD, tout en divisant la charge par 5 à 10 et en supprimant l'interface navigateur :

- **Maillages dédiés au jeu** dans `outils/cao_web.py` (sans modifier les STL haute définition d'impression 3D) :
  - Décimer `collision.glb` de **93 000 → ~5 000 triangles**.
  - Décimer `pieces.glb` et `caisse.glb` de **211 500 → ~25 000 triangles**.
- **Optimisation moteur (`js/sim.js`, `js/render3d.js`)** :
  - Passer Rapier3D de **480 Hz → 240 Hz** (suffisant grâce au CCD).
  - Alléger les ombres (shadow map `1024×1024`, figer le décor statique ou réserver les ombres dynamiques aux billes et batteurs).
  - Regrouper les 32 inserts lumineux dans un atlas unique et proposer un mode Performance (`dpr = 1`).
- **Exécutable bureau autonome** :
  - Empaquetage léger avec **Tauri** (~10 Mo, sans onglets ni barre d'adresse) ou lanceur dédié ouvrant directement le jeu en fenêtre / plein écran vertical ou horizontal.

**Avantages :** résultat rapide, un seul code source synchronisé avec la CAO, gain estimé **×5 à ×10**.
**Inconvénient :** repose encore sur un moteur WebView (plus léger qu'un navigateur complet, mais pas du natif pur).

---

### Option 2 — Vrai jeu natif compilé *(zéro navigateur, zéro JS/WASM)*
Compiler un véritable exécutable natif Linux / Windows :

- **Piste A : Rust + `rapier3d` natif + `Bevy` (ou `three-d`)**
  - Utilise **exactement le même moteur physique Rapier** qu'actuellement, mais compilé en natif (beaucoup plus rapide que WASM, très faible empreinte RAM).
  - Réutilise directement les maillages `assets/cao/*.glb`, les visuels, les sons et la géométrie/les règles existantes.
- **Piste B : Godot 4**
  - Moteur 3D natif léger (Vulkan / OpenGL 3), import natif des `.glb`, export binaire Linux / Windows en un clic et éditeur visuel intégré.

**Avantages :** performances natives maximales, très faible consommation CPU/RAM, idéal pour un mini-PC dédié, un vieux PC ou un Raspberry Pi.
**Inconvénient :** demande un portage du code JS (`rules.js`, `sim.js`, `render3d.js`, `audio.js`).

---

### Option 3 — Écosystème pincab standard : Visual Pinball X (VPX)
- Moteur C++ ultra-optimisé, référence des pincabs verticaux (Windows / Linux, gestion native multi-écrans plateau + fronton/DMD et interfaces matérielles).
- **Inconvénient :** nécessite de reconstruire la table au format `.vpx` et de réécrire les règles en VBScript, ce qui coupe la synchronisation directe avec ce dépôt.

---

## 3. Synthèse / Recommandation

| Objectif | Option conseillée |
| :--- | :--- |
| Jouer fluide rapidement en gardant un seul dépôt synchronisé avec la CAO | **Option 1** (optimisation maillages/moteur + exécutable Tauri) |
| Vrai binaire natif sans aucun moteur web (machine dédiée / faible puissance) | **Option 2** (Rust + Rapier natif ou Godot 4) |
| Intégration dans un pincab existant sous Visual Pinball | **Option 3** (VPX) |
