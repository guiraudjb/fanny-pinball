#!/usr/bin/env bash
# Essai d'une table vierge sur la Batocera (ou toute machine avec VPinballX_GL et un écran) :
#   moteur/essai.sh <dossier de la table> <essai> [secondes]
#     essai : test | balayage | rampe | lanceur | logique | lampes | vue
#   Le journal du script (lignes ESSAI, BLOQUE, PERDUE, RAMPE, LANCEUR, LOGIQUE, erreurs) s'affiche ;
#   « vue » (et chaque essai) enregistre une capture d'écran dans <dossier>/sortie/essai_<essai>.png.
# Refuse de lancer si une autre table tourne déjà sur la machine (on ne coupe jamais la partie de quelqu'un).
set -uo pipefail
#   Par défaut, les essais tournent dans le Visual Pinball de Pilote2 (ESSAI_SUR=pilote2) ; ESSAI_SUR=batocera les
#   lance sur la Batocera. Lancé depuis une autre machine (studio sur depot), le script se relance par ssh sur Pilote2.
HOTE="${BATOCERA:-root@192.168.1.143}"
TABLE="$(readlink -f "${1:?dossier de la table}")"; ESSAI="${2:?essai}"; DUREE="${3:-120}"
VPX=$(ls "$TABLE"/sortie/*.vpx | head -1); NOM=$(basename "$VPX")
PILOTE2="${PILOTE2:-192.168.1.207}"
case "$ESSAI" in
  balayage) FIN='BALAYAGE fin' ;; rampe) FIN='RAMPE fin' ;; lanceur) FIN='LANCEUR fin' ;; logique) FIN='LOGIQUE fin' ;;
  test) FIN='ESSAI fin' ;; *) FIN='zzzz' ; DUREE=12 ;;
esac
P="-c1 $ESSAI"; [ "$ESSAI" = vue ] && P=""
if [ "${ESSAI_SUR:-pilote2}" = pilote2 ]; then
  if ! hostname -I | grep -qw "$PILOTE2"; then        # pas sur Pilote2 : on s'y relance (même dépôt, monté en NFS)
    exec ssh -o BatchMode=yes "$PILOTE2" "cd '$(pwd)' && ESSAI_SUR=pilote2 '$(readlink -f "$0")' '$TABLE' '$ESSAI' '$DUREE'"
  fi
  # Visual Pinball de Pilote2, écran de gauche (:0, 1920 × 1080 en +0+0) ; on n'arrête que l'instance lancée ici
  VPB="${VPINBALL:-$HOME/aitools/vpinball/gl/VPinballX_GL}"
  DIST="/tmp/tables_vierges"; mkdir -p "$DIST"; cp "$VPX" "$DIST/$NOM"
  LOG="$DIST/essai.log"; : > "$LOG"
  (cd "$(dirname "$VPB")" && DISPLAY=:0 exec "$VPB" $P -Play "$DIST/$NOM" > "$LOG" 2>&1) &
  PID=$!
  for i in $(seq 1 "$DUREE"); do grep -q "$FIN" "$LOG" && break; kill -0 $PID 2>/dev/null || break; sleep 1; done
  [ "$ESSAI" = vue ] && sleep 8
  ffmpeg -loglevel error -y -f x11grab -video_size 1920x1080 -i :0.0+0,0 -frames:v 1 "$TABLE/sortie/essai_$ESSAI.png"
  pkill -9 -P $PID 2>/dev/null; kill -9 $PID 2>/dev/null; pkill -9 -f "VPinballX_GL $P -Play $DIST/$NOM" 2>/dev/null
  grep -E 'ESSAI|BLOQUE|PERDUE|RAMPE|LANCEUR|LOGIQUE|BALAYAGE fin|rror|Script' "$LOG" | grep -v -E 'BASS|Scripts/|Plugin |MessageBoxA|ProgressDialog' | sed 's/.*Script.Print //'
  exit 0
fi
DIST="/userdata/system/tables_vierges"
# [V] : le motif ne se reconnaît pas lui-même dans la ligne de commande du shell distant (pgrep/pkill -f)
autre=$(ssh -o BatchMode=yes "$HOTE" "pgrep -af '[V]PinballX_GL' | grep -v tables_vierges")
[ -n "$autre" ] && { echo "OCCUPÉ, rien lancé : $autre"; exit 2; }
ssh -o BatchMode=yes "$HOTE" "mkdir -p $DIST"
scp -q "$VPX" "$HOTE:$DIST/$NOM"
# arrêt dans un ssh à part : la ligne de commande du lancement contient elle-même « VPinballX_GL … tables_vierges »
arreter() { ssh -o BatchMode=yes "$HOTE" "pkill -9 -f '^./VPinballX_GL.*tables_vierges'"; }
arreter; sleep 1
ssh -o BatchMode=yes "$HOTE" "cd /usr/bin/vpinball; DISPLAY=:0.0 nohup ./VPinballX_GL -PrefPath /userdata/system/configs/vpinball/ -Ini /userdata/system/configs/vpinball/VPinballX.ini $P -Play '$DIST/$NOM' > /tmp/vierge.log 2>&1 &
for i in \$(seq 1 $DUREE); do grep -q '$FIN' /tmp/vierge.log && break; sleep 1; done
DISPLAY=:0 xdotool search --name 'Visual Pinball Player' windowactivate 2>/dev/null; sleep 1
DISPLAY=:0 ffmpeg -loglevel error -y -f x11grab -i :0.0 -frames:v 1 /tmp/vierge.png"
arreter
ssh -o BatchMode=yes "$HOTE" "grep -E 'ESSAI|BLOQUE|PERDUE|RAMPE|LANCEUR|LOGIQUE|BALAYAGE fin|rror|Script' /tmp/vierge.log | grep -v -E 'BASS|Scripts/' | sed 's/.*Script.Print //'"
scp -q "$HOTE:/tmp/vierge.png" "$TABLE/sortie/essai_$ESSAI.png"
