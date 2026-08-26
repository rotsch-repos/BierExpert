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

# Fehlt die Adresse des Modells, wird die Konfiguration trotzdem
# geschrieben. Der frühere Ausstieg an dieser Stelle war teurer, als er
# aussah: Ohne Datei meldet /api/gesundheit.php nur "Server noch nicht
# eingerichtet" und verschweigt, dass allein die Adresse fehlt — dabei hat
# der Endpunkt für genau diesen Fall ein eigenes Feld. Und der
# Datenbankteil, der ja stimmen kann, ging gleich mit verloren.
#
# Als Warnung und nicht als Abbruch: Ohne Modell steht die Seite trotzdem,
# und ein rotes Deploy hälfe niemandem. Im Lauf ist die Warnung sichtbar,
# statt in einer Zeile Protokoll unterzugehen.
ANBIETER="${LLM_ANBIETER:-ollama}"
# Je Stufe, mit LLM_ANBIETER als Rückfall für beide. Wer nichts Weiteres
# hinterlegt, bekommt also unverändert das bisherige Verhalten.
ANBIETER_SCHNELL="${LLM_ANBIETER_SCHNELL:-$ANBIETER}"
ANBIETER_TIEF="${LLM_ANBIETER_TIEF:-$ANBIETER}"

# Geprüft wird, was die beiden Stufen ZUSAMMEN brauchen. Bei der Mischung
# ist das beides: der eigene Endpunkt fürs Ablesen UND der Schlüssel fürs
# Zerlegen. Nur eines davon zu prüfen liesse genau die halbe Anlage
# unbemerkt fehlen.
if [ "$ANBIETER_SCHNELL" = "anthropic" ] || [ "$ANBIETER_TIEF" = "anthropic" ]; then
  if [ -z "${ANTHROPIC_SCHLUESSEL:-}" ]; then
    echo "::warning title=Kein Anthropic-Schlüssel hinterlegt::Eine Stufe steht auf anthropic, aber das Secret ANTHROPIC_SCHLUESSEL fehlt. Das ist nur dann in Ordnung, wenn die Besucher ihren eigenen Schlüssel im Browser hinterlegen — sonst kann die Anwendung unbekannte Etiketten nicht auswerten."
  fi
fi
if [ "$ANBIETER_SCHNELL" = "ollama" ] || [ "$ANBIETER_TIEF" = "ollama" ]; then
  if [ -z "${LLM_ENDPUNKT:-}" ]; then
    echo "::warning title=Kein Sprachmodell hinterlegt::LLM_ENDPUNKT ist nicht hinterlegt — die Anwendung kann keine Etiketten auswerten. Zu hinterlegen unter Settings → Secrets and variables → Actions."
  fi
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
        'anbieter' => $(php_text "${ANBIETER}"),
        'anbieter_schnell' => $(php_text "${ANBIETER_SCHNELL}"),
        'anbieter_tief' => $(php_text "${ANBIETER_TIEF}"),
        'anthropic_schluessel' => $(php_text "${ANTHROPIC_SCHLUESSEL:-}"),
        'anthropic_modell' => $(php_text "${ANTHROPIC_MODELL:-claude-opus-5}"),
        'anthropic_modell_schnell' => $(php_text "${ANTHROPIC_MODELL_SCHNELL:-claude-opus-5}"),
        'anthropic_aufwand' => $(php_text "${ANTHROPIC_AUFWAND:-low}"),
        'endpunkt' => $(php_text "${LLM_ENDPUNKT:-}"),
        'schluessel' => $(php_text "${LLM_SCHLUESSEL:-}"),
        'modell' => $(php_text "${LLM_MODELL:-qwen3-vl:30b}"),
        'modell_schnell' => $(php_text "${LLM_MODELL_SCHNELL:-qwen3-vl:8b}"),
        'zeitgrenze' => ${LLM_ZEITGRENZE:-300},
        'zeitgrenze_schnell' => ${LLM_ZEITGRENZE_SCHNELL:-90},
    ],
    'dienst' => [
        'adresse' => $(php_text "${DIENST_ADRESSE:-}"),
        'schluessel' => $(php_text "${DIENST_SCHLUESSEL:-}"),
    ],
    // Beim Hoster werden keine Fotos aufbewahrt: Sie liegen dort, wo die
    // Datenbank steht, und das ist die Workstation.
    'bilder' => ['verzeichnis' => '', 'basis_url' => ''],
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
