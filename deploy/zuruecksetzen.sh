#!/usr/bin/env bash
#
# Setzt das Wurzelverzeichnis auf einen früheren Stand zurück.
#
# Kein Build, keine Übertragung — es wird serverseitig aus dem Ablageordner
# zurückkopiert. Ein Rückfall dauert deshalb Sekunden und funktioniert auch
# dann, wenn der Build gerade nicht durchläuft.
#
# Ohne ZIELSTAND wird der neueste Stand genommen, der nicht der aktive ist.
#
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST fehlt}"
: "${DEPLOY_USER:?DEPLOY_USER fehlt}"
: "${DEPLOY_DOCROOT:?DEPLOY_DOCROOT fehlt}"
: "${DEPLOY_BASIS:?DEPLOY_BASIS fehlt}"

PORT="${DEPLOY_PORT:-22}"
SSH="ssh -p ${PORT} -o BatchMode=yes"
ZIEL="${DEPLOY_USER}@${DEPLOY_HOST}"

echo "==> Vorhandene Stände:"
$SSH "$ZIEL" "ls -1t '${DEPLOY_BASIS}/releases' 2>/dev/null" || {
  echo "Keine Stände im Ablageordner — Rückfall nicht möglich." >&2
  exit 1
}

$SSH "$ZIEL" "
  set -e
  cd '${DEPLOY_BASIS}/releases'
  ziel='${ZIELSTAND:-}'
  if [ -z \"\$ziel\" ]; then
    # Welcher Stand liegt gerade im Wurzelverzeichnis? Vergleich über die
    # index.html, weil es keinen Verweis gibt, den man auslesen könnte.
    aktiv=''
    if [ -f '${DEPLOY_DOCROOT}/index.html' ]; then
      summe=\$(md5sum '${DEPLOY_DOCROOT}/index.html' | cut -d' ' -f1)
      for s in \$(ls -1t); do
        [ -f \"\$s/index.html\" ] || continue
        if [ \"\$(md5sum \"\$s/index.html\" | cut -d' ' -f1)\" = \"\$summe\" ]; then
          aktiv=\$s; break
        fi
      done
    fi
    ziel=\$(ls -1t | grep -v \"^\${aktiv}\$\" | head -n 1)
  fi
  [ -n \"\$ziel\" ] || { echo 'Kein früherer Stand vorhanden.' >&2; exit 1; }
  [ -s \"\$ziel/index.html\" ] || { echo \"Stand \$ziel ist unvollständig.\" >&2; exit 1; }
  echo \"==> Zurück auf \$ziel\"
  rsync -a --delete \"\$ziel/\" '${DEPLOY_DOCROOT}/'
"
echo '==> Zurückgesetzt'
