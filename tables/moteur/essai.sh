#!/usr/bin/env bash
# Essai d'une table vierge sur la Batocera (ou toute machine avec VPinballX_GL et un écran) :
#   moteur/essai.sh <dossier de la table> <essai> [secondes]
#     essai : test | balayage | rampe | lanceur | logique | lampes | vue
#   Le journal du script (lignes ESSAI, BLOQUE, PERDUE, RAMPE, LANCEUR, LOGIQUE, erreurs) s'affiche ;
#   « vue » (et chaque essai) enregistre une capture d'écran dans <dossier>/sortie/essai_<essai>.png.
# Refuse de lancer si une autre table tourne déjà sur la machine (on ne coupe jamais la partie de quelqu'un).
set -uo pipefail
HOTE="${BATOCERA:-root@192.168.1.143}"
TABLE="$(readlink -f "${1:?dossier de la table}")"; ESSAI="${2:?essai}"; DUREE="${3:-120}"
VPX=$(ls "$TABLE"/sortie/*.vpx | head -1); NOM=$(basename "$VPX")
DIST="/userdata/system/tables_vierges"
# [V] : le motif ne se reconnaît pas lui-même dans la ligne de commande du shell distant (pgrep/pkill -f)
autre=$(ssh -o BatchMode=yes "$HOTE" "pgrep -af '[V]PinballX_GL' | grep -v tables_vierges")
[ -n "$autre" ] && { echo "OCCUPÉ, rien lancé : $autre"; exit 2; }
ssh -o BatchMode=yes "$HOTE" "mkdir -p $DIST"
scp -q "$VPX" "$HOTE:$DIST/$NOM"
case "$ESSAI" in
  balayage) FIN='BALAYAGE fin' ;; rampe) FIN='RAMPE fin' ;; lanceur) FIN='LANCEUR fin' ;; logique) FIN='LOGIQUE fin' ;;
  test) FIN='ESSAI fin' ;; *) FIN='zzzz' ; DUREE=12 ;;
esac
P="-c1 $ESSAI"; [ "$ESSAI" = vue ] && P=""
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
