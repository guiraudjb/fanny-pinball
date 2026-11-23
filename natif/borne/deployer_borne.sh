#!/usr/bin/env bash
# Envoie le jeu natif compilé, ses données et ses sons sur une borne (Debian 13, clé ssh déjà échangée), avec le
# script d'installation. Depuis la racine du dépôt ou d'ailleurs :
#   natif/borne/deployer_borne.sh 192.168.1.73            (puis, sur la borne : bash ~/fanny-pinball/installer_borne.sh)
# Relancé plus tard, il met simplement le jeu à jour (la borne relance le jeu au prochain démarrage).
set -euo pipefail
HOTE="${1:?usage : deployer_borne.sh <adresse de la borne> [dossier distant]}"
DIST="${2:-fanny-pinball}"
NATIF="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$NATIF"
cargo build --release --quiet
for f in donnees/monde.json donnees/scene.glb; do [ -f "$f" ] || { echo "$f manque : ./run.sh l'exporte"; exit 1; }; done
# tar par ssh (rsync n'est pas installé sur une Debian minimale)
tar -C "$NATIF" -czf - --transform 's|^target/release/||;s|^borne/||' \
    target/release/fanny-pinball donnees borne/installer_borne.sh \
  | ssh "$HOTE" "mkdir -p $DIST && tar -C $DIST -xzf -"
tar -C "$NATIF/.." -czf - assets/sons | ssh "$HOTE" "tar -C $DIST -xzf -"
echo "Envoyé sur $HOTE:~/$DIST. Première fois : ssh $HOTE puis  bash ~/$DIST/installer_borne.sh"
