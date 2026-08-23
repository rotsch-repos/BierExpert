#!/usr/bin/env bash
#
# Schreibt die Serverkonfiguration — Datenbankzugang und Adresse des
# Sprachmodells — in das Heimatverzeichnis auf dem Zielserver.
#
# Warum nicht ins Wurzelverzeichnis der Domain: Was dort liegt, ist im
# Zweifel abrufbar, und die Auslieferung räumt es ohnehin bei jedem Lauf
# leer. Deshalb ~/.bierexpert/konfiguration.php — daneben, dauerhaft,
# unerreichbar.
#
# Läuft im Runner. Die Werte kommen aus GitHub (Secrets und Variablen) und
# gehen über die Standardeingabe von ssh, nicht als Argumente: Argumente
# stehen in der Prozessliste des Servers.
#
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST fehlt}"
: "${DEPLOY_USER:?DEPLOY_USER fehlt}"

PORT="${DEPLOY_PORT:-22}"
SSH="ssh -p ${PORT} -o BatchMode=yes"
ZIEL="${DEPLOY_USER}@${DEPLOY_HOST}"
PFAD="${KONFIG_PFAD:-.bierexpert/konfiguration.php}"

# Ohne Modell hätte die Konfiguration keinen Zweck. Die Datenbank darf
# fehlen — dann läuft die Anwendung ohne Zwischenspeicher, langsamer, aber
# vollständig. Das ist ein Zustand, kein Fehler, und wird als solcher
# gemeldet statt den Lauf abzubrechen.
if [ -z "${LLM_ENDPUNKT:-}" ]; then
  echo "==> Übersprungen: LLM_ENDPUNKT ist nicht hinterlegt."
  echo "    Ohne die Adresse des Sprachmodells kann die Anwendung nichts auswerten."
  echo "    Zu hinterlegen unter Settings → Secrets and variables → Actions."
  exit 0
fi

if [ -z "${DB_PASSWORT:-}" ]; then
  echo "==> Hinweis: Kein Datenbankpasswort hinterlegt."
  echo "    Der Zwischenspeicher bleibt damit aus; jeder Scan geht ans Modell."
fi

# Ein Wert wie O'Brien oder ein Passwort mit Backslash würde die erzeugte
# PHP-Datei sonst zerreissen — und der Fehler sähe aus wie ein Programmfehler.
php_text() {
  local wert="${1-}"
  wert="${wert//\\/\\\\}"
  wert="${wert//\'/\\\'}"
  printf "'%s'" "$wert"
}

INHALT=$(cat <<KONF
<?php

// Erzeugt von deploy/konfiguration.sh. Änderungen hier werden beim nächsten
// Deploy überschrieben — die Werte gehören nach GitHub unter
// Settings → Secrets and variables → Actions.

return [
    'db' => [
        'host' => $(php_text "${DB_HOST:-}"),
        'name' => $(php_text "${DB_NAME:-}"),
        'benutzer' => $(php_text "${DB_USER:-}"),
        'passwort' => $(php_text "${DB_PASSWORT:-}"),
    ],
    'llm' => [
        'endpunkt' => $(php_text "${LLM_ENDPUNKT}"),
        'schluessel' => $(php_text "${LLM_SCHLUESSEL:-}"),
        'modell' => $(php_text "${LLM_MODELL:-qwen3-vl:32b}"),
        'modell_schnell' => $(php_text "${LLM_MODELL_SCHNELL:-qwen3-vl:8b}"),
        'zeitgrenze' => ${LLM_ZEITGRENZE:-300},
        'zeitgrenze_schnell' => ${LLM_ZEITGRENZE_SCHNELL:-90},
    ],
    'herkuenfte' => [],
    'speicher' => $([ -n "${DB_PASSWORT:-}" ] && echo true || echo false),
];
KONF
)

echo "==> Schreibe ${ZIEL}:~/${PFAD}"

# umask 077, bevor die Datei entsteht: Sie darf nie, auch nicht für einen
# Augenblick, für andere lesbar sein.
printf '%s\n' "$INHALT" | $SSH "$ZIEL" "
  umask 077
  mkdir -p \"\$(dirname '${PFAD}')\"
  cat > '${PFAD}'
  chmod 600 '${PFAD}'
"

# Eine Konfiguration mit Syntaxfehler fiele sonst erst beim ersten Scan auf,
# und zwar als "Server ist noch nicht eingerichtet" — eine Meldung, die in
# die Irre führt.
#
# Fehlt der php-Aufruf in der Shell des Servers, wird die Prüfung
# übersprungen statt den Lauf abzubrechen: Die Datei steht an dieser Stelle
# schon, und ein Abbruch danach hinterliesse eine geschriebene Konfiguration
# und ein rotes Deploy — ohne dass etwas kaputt wäre. Welches PHP der
# Webserver fährt, sagt ohnehin erst /api/gesundheit.php.
if $SSH "$ZIEL" "command -v php >/dev/null 2>&1"; then
  echo "==> Prüfen, ob PHP die Datei annimmt"
  $SSH "$ZIEL" "php -l '${PFAD}' >/dev/null" \
    || { echo "FEHLER: Die geschriebene Konfiguration ist kein gültiges PHP." >&2; exit 1; }
else
  echo "==> Übersprungen: In der Shell des Servers gibt es keinen php-Aufruf."
  echo "    Ob die Konfiguration greift, sagt /api/gesundheit.php."
fi

echo "==> Fertig"
