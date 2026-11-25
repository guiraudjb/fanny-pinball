#!/usr/bin/env bash
# Construit une table vierge : moteur/construire.sh <dossier de la table>
#   1. python3 <dossier>/table.py : plan (sortie/table.json, entete.vbs, images)
#   2. sons du moteur (moteur/sons/*.wav) s'ils manquent
#   3. générateur Rust : sortie/<Nom>.vpx
#   4. vpxtool verify (structure du fichier) s'il est installé
set -euo pipefail
MOTEUR="$(dirname "$(readlink -f "$0")")"
TABLE="$(readlink -f "${1:?usage : moteur/construire.sh <dossier de la table>}")"
export PATH="$HOME/.cargo/bin:$PATH"
python3 "$TABLE/table.py"
[ -f "$MOTEUR/sons/bumper.wav" ] || python3 "$MOTEUR/sons.py"
(cd "$MOTEUR/generateur" && cargo build --release --quiet)
"$MOTEUR/generateur/target/release/generateur-tables" "$TABLE"
if command -v vpxtool >/dev/null; then for f in "$TABLE"/sortie/*.vpx; do vpxtool verify "$f"; done; fi
