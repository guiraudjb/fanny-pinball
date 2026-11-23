#!/usr/bin/env bash
# Prépare une Debian 13 minimale en borne Fanny Pinball : affichage X minimal sans bureau, connexion automatique sur
# tty1, jeu natif lancé en plein écran au démarrage.
#
# À lancer SUR LA BORNE, en utilisateur normal (pas root), depuis le dossier qui contient le jeu :
#   ~/fanny-pinball/fanny-pinball, ~/fanny-pinball/donnees/, ~/fanny-pinball/assets/sons/
#   (envoyés par natif/borne/deployer_borne.sh depuis la machine de développement)
#   bash ~/fanny-pinball/installer_borne.sh
# Le mot de passe sudo est demandé une fois. Le script peut être relancé sans risque.
#
# Quand on choisit « Quitter » dans le menu du jeu : voir QUITTER ci-dessous.
set -euo pipefail

QUITTER="${QUITTER:-eteindre}"    # eteindre : la borne s'éteint ; relancer : le jeu redémarre ; console : retour au terminal
DETAIL="${DETAIL:-Bas}"           # niveau de détail au premier lancement (Bas conseillé pour une machine modeste)
DEFINITION="${DEFINITION:-1920x1080}"   # définition de l'écran imposée à X (une télé 4K démarrerait en 3840x2160)

JEU="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
UTIL="$(id -un)"
[ "$UTIL" = root ] && { echo "À lancer en utilisateur normal (sudo est appelé quand il faut)."; exit 1; }
[ -x "$JEU/fanny-pinball" ] && [ -f "$JEU/donnees/monde.json" ] || { echo "Jeu absent de $JEU (lancer deployer_borne.sh d'abord)."; exit 1; }

echo "== 1/7 Paquets : serveur X minimal, Mesa (OpenGL), SDL2, son ALSA"
sudo apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
  xserver-xorg-core xserver-xorg-input-libinput xinit x11-xserver-utils \
  libgl1-mesa-dri libglx-mesa0 libegl-mesa0 mesa-utils \
  libsdl2-2.0-0 libsdl2-mixer-2.0-0 alsa-utils unclutter-xfixes

echo "== 2/7 Accès matériel de $UTIL (vidéo, son, entrées)"
sudo usermod -aG video,audio,input,render "$UTIL"
# serveur X lancé par un utilisateur depuis la console
echo -e "allowed_users=anybody\nneeds_root_rights=yes" | sudo tee /etc/X11/Xwrapper.config >/dev/null

# extinction sans mot de passe, pour « Quitter » (seulement cette commande)
echo "$UTIL ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff" | sudo tee /etc/sudoers.d/borne-fanny >/dev/null
sudo chmod 440 /etc/sudoers.d/borne-fanny
sudo visudo -cf /etc/sudoers.d/borne-fanny >/dev/null

echo "== 3/7 Connexion automatique de $UTIL sur tty1"
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf >/dev/null <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $UTIL --noclear %I \$TERM
EOF
sudo systemctl daemon-reload

echo "== 4/7 Lancement automatique de l'affichage puis du jeu"
DEB="# --- borne Fanny Pinball : affichage au démarrage sur tty1 (installer_borne.sh)"
if ! grep -qF "$DEB" "$HOME/.bash_profile" 2>/dev/null; then
  cat >> "$HOME/.bash_profile" <<EOF

$DEB
if [ -z "\${DISPLAY:-}" ] && [ "\$(tty)" = /dev/tty1 ] && [ ! -e "\$HOME/.borne_pause" ]; then
  exec startx -- -nocursor vt1 >"\$HOME/.borne_x.log" 2>&1
fi
EOF
fi
cat > "$HOME/.xinitrc" <<EOF
#!/bin/sh
# borne Fanny Pinball (installer_borne.sh)
xset s off -dpms s noblank          # pas de mise en veille de l'écran
# définition de l'écran (sortie raccordée), si l'écran la propose
SORTIE=\$(xrandr | awk '/ connected/{print \$1; exit}')
[ -n "\$SORTIE" ] && xrandr --output "\$SORTIE" --mode $DEFINITION 2>/dev/null
unclutter --start-hidden &          # pointeur de souris caché
cd "$JEU"
while true; do
  ./fanny-pinball --plein-ecran >>"\$HOME/.borne_jeu.log" 2>&1
  code=\$?
  [ \$code -ne 0 ] && { sleep 2; continue; }      # plantage ou arrêt extérieur : on relance
  case "$QUITTER" in                                # code 0 : « Quitter » choisi dans le menu
    eteindre) sudo -n /usr/bin/systemctl poweroff; sleep 30 ;;
    relancer) sleep 1; continue ;;
  esac
  touch "\$HOME/.borne_pause"; exit 0              # console : pas de relance avant le prochain démarrage
done
EOF
chmod +x "$HOME/.xinitrc"
# le retour en console n'est valable que jusqu'au prochain démarrage
sudo tee /etc/tmpfiles.d/borne-fanny.conf >/dev/null <<EOF
r $HOME/.borne_pause
EOF

echo "== 5/7 Réglages du jeu (plein écran, détail $DETAIL), sauf s'ils existent déjà"
CFG="$HOME/.config/fanny-pinball"
mkdir -p "$CFG"
if [ ! -f "$CFG/reglages.json" ]; then
  cat > "$CFG/reglages.json" <<EOF
{ "plein_ecran": true, "resolution": [1280, 720], "detail": "$DETAIL", "volume_effets": 8, "volume_musique": 6,
  "vue": "joueur", "vertical_horaire": true }
EOF
fi

echo "== 6/7 Son : sortie HDMI raccordée à l'écran (sinon la puce de la carte mère)"
# périphérique HDMI dont le nom est celui de l'écran (ELD) : « HDMI 0 [LG TV SSCR2] » plutôt que « HDMI 1 [HDMI 1] »
LIGNE=$(aplay -l 2>/dev/null | grep -E "^(carte|card) [0-9]+ : .*HDMI" | grep -vE "\[HDMI [0-9]+\]$" | head -1 || true)
if [ -n "$LIGNE" ]; then
  CARTE=$(echo "$LIGNE" | sed -E 's/^[a-z]+ [0-9]+ : ([^ ]+) .*/\1/')
  PERI=$(echo "$LIGNE" | sed -E 's/.*(périphérique|device) ([0-9]+) :.*/\2/')
  cat > "$HOME/.asoundrc" <<EOF
# borne Fanny Pinball (installer_borne.sh) : son vers l'écran HDMI
pcm.!default { type plug slave.pcm "dmix:CARD=$CARTE,DEV=$PERI" }
ctl.!default { type hw card $CARTE }
EOF
  for i in 0 1 2 3; do amixer -q -c "$CARTE" set "IEC958,$i" on 2>/dev/null || true; done
  sudo alsactl store 2>/dev/null || true
  echo "  son : carte $CARTE, périphérique $PERI ($LIGNE)"
else
  echo "  aucun écran HDMI avec son détecté : son par défaut (carte mère)"
fi

echo "== 7/7 Message de démarrage du chien de garde sp5100_tco (inutile ici) masqué"
echo "blacklist sp5100_tco" | sudo tee /etc/modprobe.d/borne-sp5100-tco.conf >/dev/null

echo
echo "Vérification OpenGL (doit annoncer 3.3 ou plus) :"
glxinfo -B 2>/dev/null | grep -E "renderer|core profile version" || echo "  (visible seulement sous X : après redémarrage, voir ~/.borne_x.log)"
echo
echo "Terminé. Redémarrer pour lancer la borne :  sudo reboot"
echo "Pour reprendre la main : Ctrl+Alt+F2 (autre console), ou se connecter en ssh."
echo "Journaux : ~/.borne_x.log (affichage), ~/.borne_jeu.log (jeu)."
