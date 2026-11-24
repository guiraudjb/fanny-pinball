#!/usr/bin/env bash
# Archive de publication (VPUniverse, VPForums, Pinball Nirvana) : sortie/Fanny Pinball (Arducible 2026) v<version>.zip
#   - la table, nommée « Nom (Fabricant Année) vX.Y.vpx » ;
#   - README.txt (version de VPX, pas de ROM, touches, règles, crédits) ;
#   - captures/ : images de sortie/captures/ s'il y en a (vue bureau prise sur la machine, plateau…).
# Jeu original : aucune ROM, aucun .directb2s, sons et musiques dans le .vpx.
#   outils/vpx/paquet.sh [version]
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
V="${1:-1.0}"
NOM="Fanny Pinball (Arducible 2026) v$V"
D="sortie/paquet/$NOM"
rm -rf sortie/paquet && mkdir -p "$D"
cp sortie/FannyPinball.vpx "$D/$NOM.vpx"
sed "s/ v1\.0/ v$V/g" README.txt > "$D/README.txt"
if compgen -G "sortie/captures/*" > /dev/null; then mkdir -p "$D/captures" && cp sortie/captures/* "$D/captures/"; fi
(cd sortie/paquet && rm -f "../$NOM.zip" && zip -qr9 "../$NOM.zip" "$NOM")
ls -la "sortie/$NOM.zip"
