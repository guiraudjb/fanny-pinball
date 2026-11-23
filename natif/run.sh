#!/usr/bin/env bash
# Lance Fanny Pinball (version native). Compile au premier lancement ou après une modification des sources,
# exporte les scènes 3D si elles manquent, puis démarre le jeu. Les options sont transmises au jeu, par exemple :
#   ./run.sh                    menu principal
#   ./run.sh --plein-ecran      plein écran
#   ./run.sh --leger            détail bas (machine modeste)
set -euo pipefail
ici="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$ici"

if ! command -v cargo >/dev/null; then
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
fi
command -v cargo >/dev/null || { echo "Rust absent : https://rustup.rs (puis paquets libsdl2-dev libsdl2-mixer-dev)"; exit 1; }

# scènes 3D (exportées depuis le jeu web par Chrome sans écran)
if [ ! -f donnees/scene.glb ] || [ ! -f donnees/monde.json ]; then
  command -v node >/dev/null || PATH="$(ls -d "$HOME"/aitools/node*/bin 2>/dev/null | head -1):$PATH"
  command -v node >/dev/null || { echo "donnees/scene.glb manque et Node.js est absent pour l'exporter"; exit 1; }
  echo "Export des données (une fois)…"
  (cd .. && [ -f natif/donnees/monde.json ] || node outils/exporter_natif.mjs)
  (cd .. && node outils/exporter_scene_natif.mjs)
  (cd .. && node outils/exporter_scene_natif.mjs --px-mm 1.6 --sortie natif/donnees/scene_leger.glb)
fi

# compilation si l'exécutable manque ou si une source est plus récente
bin=target/release/fanny-pinball
if [ ! -x "$bin" ] || [ -n "$(find src Cargo.toml -newer "$bin" -print -quit)" ]; then
  echo "Compilation…"
  cargo build --release --quiet
fi

exec "$bin" "$@"
