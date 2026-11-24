#!/usr/bin/env bash
# Fabrique la table Visual Pinball : outils/vpx/sortie/FannyPinball.vpx
#   1. exporter_vpx.mjs : géométrie (donnees/table.json) et plateau peint (donnees/plateau.png) depuis la version web
#   2. decor_glb.py : décor 3D de la version d'origine (natif/donnees/scene.glb) → donnees/decor
#   3. generateur (Rust, bibliothèque vpin) : éléments, décor, matières, images, sons, script table.vbs
#   4. vpxtool verify + audit (structure du fichier et analyse du VBScript)
#   5. apercu.mjs : rendu de contrôle sans Visual Pinball (sortie/apercu.png)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
export PATH="$HOME/.cargo/bin:$HOME/aitools/node/bin:$PATH"
node exporter_vpx.mjs
python3 decor_glb.py
(cd generateur && cargo run --release --quiet)
vpxtool verify sortie/FannyPinball.vpx
vpxtool audit sortie/FannyPinball.vpx
[ "${1:-}" = --sans-apercu ] || node apercu.mjs
