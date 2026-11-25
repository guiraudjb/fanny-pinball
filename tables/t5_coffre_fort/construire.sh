#!/usr/bin/env bash
# Construit cette table : sortie/<Nom>.vpx
exec "$(dirname "$(readlink -f "$0")")/../moteur/construire.sh" "$(dirname "$(readlink -f "$0")")"
