#!/usr/bin/env bash
# Assemble les archives de la version native pour Linux et Windows, à partir des exécutables compilés par GitHub
# Actions (.github/workflows/natif.yml) et des données locales (scènes 3D exportées du jeu web, sons, polices).
#
#   outils/release.sh <id du run GitHub>        → dist/fanny-pinball-<version>-{linux-x86_64.tar.gz,windows-x86_64.zip}
#   outils/release.sh <id> --publier            → crée en plus la release v<version> sur GitHub avec ces archives
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
run=${1:?id du run GitHub Actions (gh run list --workflow natif.yml)}
version=$(sed -n 's/^version = "\(.*\)"/\1/p' natif/Cargo.toml | head -1)
dist=dist; tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for f in monde.json scene.glb scene_leger.glb; do
  [ -f natif/donnees/$f ] || { echo "natif/donnees/$f manque (node outils/exporter_*natif*.mjs)"; exit 1; }
done
gh run download "$run" --dir "$tmp/artefacts"

lisezmoi() {   # $1 = linux | windows
  cat <<EOF
Fanny Pinball $version — Pétanque World Tour
============================================

Flipper des années 70 à la provençale. Physique Rapier 3D, café provençal, voix et musiques d'origine.

Lancer
------
EOF
  if [ "$1" = windows ]; then cat <<'EOF'
Double-cliquer sur fanny-pinball.exe (Windows 10 ou 11, 64 bits, carte graphique OpenGL 3.3).
Si Windows SmartScreen bloque le lancement : « Informations complémentaires » puis « Exécuter quand même »
(l'exécutable n'est pas signé).
Réglages et scores : %APPDATA%\fanny-pinball\
EOF
  else cat <<'EOF'
./fanny-pinball   (Linux 64 bits, glibc 2.35 ou plus récent, OpenGL 3.3)

Bibliothèques nécessaires, SDL2 et SDL2_mixer :
  Debian / Ubuntu : sudo apt install libsdl2-2.0-0 libsdl2-mixer-2.0-0
  Fedora          : sudo dnf install SDL2 SDL2_mixer
  Arch            : sudo pacman -S sdl2 sdl2_mixer
Réglages et scores : ~/.config/fanny-pinball/
EOF
  fi
  cat <<'EOF'

Commandes
---------
Maj gauche / Maj droite : palettes          Bas (maintenir puis relâcher) : lanceur
S ou Entrée : départ                        5 : pièce
Espace / Haut : bourrage frontal            Ctrl gauche / droit : bourrage latéral
Échap : pause                               F11 : plein écran
C : caméra suivante                         M : son coupé
Dans les menus : flèches ou palettes pour choisir, Entrée pour valider, Échap pour revenir.

Options : --plein-ecran, --leger (machine modeste)

Sources : https://github.com/guiraudjb/fanny-pinball
EOF
}

assembler() {   # $1 = dossier de destination
  mkdir -p "$1/donnees" "$1/assets"
  cp natif/donnees/{monde.json,scene.glb,scene_leger.glb} "$1/donnees/"
  cp -r natif/donnees/polices "$1/donnees/"
  cp -r assets/sons "$1/assets/"
}

rm -rf "$dist"; mkdir -p "$dist"
nom=fanny-pinball-$version

d="$tmp/linux/$nom"; assembler "$d"
install -m 755 "$tmp/artefacts/linux-x86_64/fanny-pinball" "$d/"
lisezmoi linux > "$d/LISEZMOI.txt"
tar -C "$tmp/linux" -czf "$dist/$nom-linux-x86_64.tar.gz" "$nom"

d="$tmp/windows/$nom"; assembler "$d"
cp "$tmp/artefacts/windows-x86_64/"* "$d/"
lisezmoi windows | sed 's/$/\r/' > "$d/LISEZMOI.txt"
(cd "$tmp/windows" && zip -qr9 "$OLDPWD/$dist/$nom-windows-x86_64.zip" "$nom")

ls -lh "$dist"
if [ "${2:-}" = --publier ]; then
  gh release create "v$version" "$dist"/* --title "Fanny Pinball $version" --notes-file - <<EOF
Première version publiée de Fanny Pinball, flipper des années 70 à la provençale.

- **Windows** (10/11, 64 bits) : \`$nom-windows-x86_64.zip\`, décompresser puis lancer \`fanny-pinball.exe\`.
- **Linux** (64 bits) : \`$nom-linux-x86_64.tar.gz\`, décompresser puis lancer \`./fanny-pinball\` (paquets SDL2 et SDL2_mixer requis, voir LISEZMOI.txt).
- **Navigateur** : https://guiraudjb.github.io/fanny-pinball/

Contenu : physique Rapier 3D (palettes motorisées, caoutchoucs, rampe), règles complètes (F-A-N-N-Y, multiball,
jackpots, World Tour, extra ball, match, tilt), cinématique de dépliage dans un café provençal, réglages, meilleurs scores.
EOF
fi
