#!/usr/bin/env bash
#
# Richtet diese Workstation als Server für bierexpert.de ein.
#
# Idempotent: Jeder Schritt prüft erst, ob er schon getan ist. Ein zweiter
# Lauf verändert nichts und ist die einfachste Art nachzusehen, ob noch
# alles steht.
#
# Wird als roger aufgerufen, nicht als root. Die Schritte, die Rechte
# brauchen, rufen sudo einzeln auf — so ist an jeder Stelle sichtbar, was
# mit erhöhten Rechten läuft, statt dass das ganze Skript sie hat.
#
# Aufruf:
#   ./einrichten.sh                 alle Schritte
#   ./einrichten.sh datenbank php   nur diese Schritte
#   ./einrichten.sh --zeigen        nur auflisten, was zu tun wäre
#
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASIS="${BASIS:-/srv/bierexpert}"
KONFIG_VERZ="$HOME/.bierexpert"
KONFIG="$KONFIG_VERZ/konfiguration.php"
DB_NAME="${DB_NAME:-bierexpert}"
DB_USER="${DB_USER:-bierexpert}"
PORT="${PORT:-8300}"

PAKETE=(php-fpm php-mysql php-curl php-mbstring mariadb-server mariadb-client rsync git)

ZEIGEN=nein
SCHRITTE=(pakete verzeichnisse datenbank konfiguration php nginx systemd)

if [ "${1:-}" = "--zeigen" ]; then ZEIGEN=ja; shift; fi
[ $# -gt 0 ] && SCHRITTE=("$@")

sagen() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
tun()   { printf '    %s\n' "$*"; }
steht() { printf '    steht bereits: %s\n' "$*"; }

# Sammelt, was ein Lauf mit --zeigen ausgeben würde.
ausfuehren() {
  if [ "$ZEIGEN" = "ja" ]; then printf '    [würde laufen] %s\n' "$*"; return 0; fi
  "$@"
}

php_version() {
  # Es kann mehr als eine PHP-Version installiert sein. Gemeint ist die
  # jüngste — unter der fährt FPM.
  #
  # Das "|| true" ist nötig, nicht kosmetisch: Vor der Installation gibt es
  # /etc/php noch nicht, ls endet mit 2, und wegen "set -o pipefail" nähme
  # das den ganzen Lauf mit. Eine fehlende Version ist hier aber eine
  # Auskunft und keine Störung — die leere Antwort wird oben behandelt.
  { ls -1 /etc/php 2>/dev/null || true; } | sort -V | tail -1
}

# --------------------------------------------------------------------------
schritt_pakete() {
  sagen "Pakete"
  local fehlend=()
  for paket in "${PAKETE[@]}"; do
    dpkg-query -W -f='${Status}' "$paket" 2>/dev/null | grep -q '^install ok installed$' \
      || fehlend+=("$paket")
  done

  if [ ${#fehlend[@]} -eq 0 ]; then
    steht "alle Pakete vorhanden"
    return
  fi

  tun "fehlen: ${fehlend[*]}"
  # DEBIAN_FRONTEND: Ohne das hielte eine Rückfrage von dpkg den Lauf an —
  # und zwar an einer Stelle, an der niemand ein Terminal hat, um sie zu
  # beantworten.
  ausfuehren sudo apt-get update
  ausfuehren sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${fehlend[@]}"
}

# --------------------------------------------------------------------------
schritt_verzeichnisse() {
  sagen "Verzeichnisse unter ${BASIS}"

  # Warum nicht ins Heimatverzeichnis: /home/roger ist drwxr-x---, dort kommt
  # der nginx-Arbeitsprozess (www-data) nicht an die statischen Dateien
  # heran. Unter /srv liegt, was diese Maschine ausliefert — genau dafür ist
  # das Verzeichnis im Dateisystemstandard vorgesehen.
  if [ -d "$BASIS/releases" ] && [ -O "$BASIS" ]; then
    steht "$BASIS"
  else
    ausfuehren sudo mkdir -p "$BASIS/releases"
    ausfuehren sudo chown -R "$USER:$USER" "$BASIS"
    # Lesbar für alle: www-data muss die statischen Dateien ausliefern.
    ausfuehren sudo chmod 755 "$BASIS"
  fi

  # Die aufbewahrten Scanfotos liegen NEBEN den Ständen, nicht in einem.
  # Läge das Verzeichnis unter releases/<sha>, verschwände die halbe
  # Galerie beim nächsten Aufräumen der alten Stände.
  if [ -d "$BASIS/bilder" ]; then
    steht "$BASIS/bilder"
  else
    ausfuehren mkdir -p "$BASIS/bilder"
    ausfuehren chmod 755 "$BASIS/bilder"
  fi

  # Ein eigenes Protokollverzeichnis, das roger gehört. Ohne das kann der
  # FPM-Arbeiter — er läuft als roger — seine Fehlerdatei in /var/log nicht
  # anlegen, PHP fällt still auf stderr zurück, und die Meldungen tauchen im
  # nginx-Protokoll auf statt dort, wo man sie sucht.
  #
  # nginx schreibt hier ebenfalls hinein. Sein Hauptprozess läuft als root
  # und legt seine Dateien selbst an; drwxrwxr-x mit Gruppe adm reicht beiden.
  if [ -d /var/log/bierexpert ]; then
    steht "/var/log/bierexpert"
  else
    ausfuehren sudo install -d -o "$USER" -g adm -m 2775 /var/log/bierexpert
  fi

  # Ohne Rotation wachsen Zugriffs- und Langsam-Protokoll unbegrenzt.
  local dreh=/etc/logrotate.d/bierexpert
  if [ -f "$dreh" ] && sudo cmp -s "$HIER/logrotate.conf" "$dreh"; then
    steht "$dreh"
  else
    ausfuehren sudo install -m 644 -o root -g root "$HIER/logrotate.conf" "$dreh"
  fi
}

# --------------------------------------------------------------------------
schritt_datenbank() {
  sagen "Datenbank ${DB_NAME}"

  if [ "$ZEIGEN" = "ja" ]; then
    tun "[würde laufen] Datenbank und Benutzer anlegen"
    return
  fi

  sudo systemctl is-active --quiet mariadb || sudo systemctl enable --now mariadb

  # Das Passwort ist der eine Wert, der nicht neu erfunden werden darf:
  # Steht schon eine Konfiguration da, gilt ihres — sonst zeigte die
  # Anwendung nach einem zweiten Lauf auf einen Benutzer mit anderem
  # Passwort und meldete "Datenbank nicht verbunden".
  local passwort=''
  if [ -r "$KONFIG" ]; then
    passwort=$(php -r '$k = require $argv[1]; echo $k["db"]["passwort"] ?? "";' "$KONFIG" 2>/dev/null || true)
  fi
  if [ -z "$passwort" ]; then
    passwort=$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 28)
    tun "neues Passwort erzeugt"
  else
    tun "Passwort aus vorhandener Konfiguration übernommen"
  fi
  DB_PASSWORT="$passwort"

  # Über die Standardeingabe, nicht als Argument: Argumente stehen in der
  # Prozessliste und wären für jeden auf der Maschine sichtbar.
  # ALTER USER hinterher, damit ein bestehender Benutzer auf dasselbe
  # Passwort gebracht wird — CREATE USER IF NOT EXISTS täte das nicht.
  sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORT}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORT}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
  tun "Datenbank und Benutzer stehen"
}

# --------------------------------------------------------------------------
schritt_konfiguration() {
  sagen "Konfiguration ${KONFIG}"

  if [ "$ZEIGEN" = "ja" ]; then
    tun "[würde laufen] Konfiguration schreiben (Rechte 600)"
    return
  fi

  # Wurde in diesem Lauf kein Passwort gesetzt (weil der Schritt "datenbank"
  # übersprungen wurde), gilt das aus der bestehenden Datei.
  if [ -z "${DB_PASSWORT:-}" ] && [ -r "$KONFIG" ]; then
    DB_PASSWORT=$(php -r '$k = require $argv[1]; echo $k["db"]["passwort"] ?? "";' "$KONFIG")
  fi
  : "${DB_PASSWORT:?Kein Datenbankpasswort — erst den Schritt datenbank laufen lassen}"

  # Ein Wert wie O'Brien oder ein Passwort mit Backslash würde die erzeugte
  # PHP-Datei sonst zerreissen — und der Fehler sähe aus wie ein
  # Programmfehler. Dieselbe Absicherung wie in deploy/konfiguration.sh.
  php_text() {
    local wert="${1-}"
    wert="${wert//\\/\\\\}"
    wert="${wert//\'/\\\'}"
    printf "'%s'" "$wert"
  }

  mkdir -p "$KONFIG_VERZ"
  # umask, bevor die Datei entsteht: Sie darf nie, auch nicht für einen
  # Augenblick, für andere lesbar sein.
  (
    umask 077
    cat > "$KONFIG" <<KONF
<?php

// Erzeugt von deploy/lokal/einrichten.sh auf dieser Workstation.
//
// Der Unterschied zur Hostpoint-Fassung: Ollama läuft auf derselben
// Maschine. Deshalb localhost statt Tunnel — und deshalb kein Schlüssel:
// Wer auf 127.0.0.1:11434 zugreifen kann, sitzt ohnehin schon hier.

return [
    'db' => [
        'host' => 'localhost',
        'name' => $(php_text "$DB_NAME"),
        'benutzer' => $(php_text "$DB_USER"),
        'passwort' => $(php_text "$DB_PASSWORT"),
    ],
    'llm' => [
        // Die Mischung, und der Grund dafür in einem Satz: Das Ablesen
        // fällt bei JEDEM Scan an, das Zerlegen genau einmal je Bier.
        //
        // Ablesen — welches Bier ist das? — beim eigenen kleinen Modell.
        // Es läuft bei jedem Foto, auch bei den längst bekannten Bieren,
        // und kostet hier nichts ausser Strom. Gemessen am 26.08. mit
        // qwen3-vl:8b: 1,5-5 s je Foto, warm.
        'anbieter_schnell' => 'ollama',
        // Zerlegen eines noch UNBEKANNTEN Etiketts bei Anthropic. Das
        // eigene 30b hat diese Aufgabe nicht sauber hinbekommen (es hat
        // Wappen und Zahlen erfunden, wo es nichts lesen konnte), und es
        // ist genau die Aufgabe, bei der ein Fehler dauerhaft in der
        // Datenbank landet und von dort jedem Leser vorgesetzt wird.
        //
        // Bezahlt wird damit nicht je Scan, sondern je neuem Bier — und
        // das ist die ganze Rechnung hinter dem Zwischenspeicher: Das
        // Kompendium wächst, die unbekannten Etiketten werden seltener,
        // die Kosten gehen gegen null, ohne dass die Anwendung langsamer
        // wird.
        'anbieter_tief' => 'anthropic',
        // Bleibt leer: Der Schlüssel reist je Anfrage aus dem Browser mit
        // (im Frontend unter "Eigener Anthropic-Schlüssel"). Wer stattdessen
        // will, dass der Betreiber für alle zahlt, trägt ihn hier ein —
        // dann aber bitte im Bewusstsein, dass jedes unbekannte Etikett
        // eines beliebigen Besuchers auf diese Rechnung geht.
        'anthropic_schluessel' => '',
        'anthropic_modell' => 'claude-opus-5',
        'anthropic_modell_schnell' => 'claude-opus-5',
        'anthropic_aufwand' => 'low',
        'endpunkt' => 'http://localhost:11434',
        'schluessel' => '',
        // Bleibt eingetragen, wird aber im Regelfall nicht mehr aufgerufen:
        // Wer 'anbieter_tief' auf 'ollama' zurückstellt, bekommt damit
        // wieder den reinen Eigenbetrieb, ohne sonst etwas zu ändern.
        'modell' => 'qwen3-vl:30b',
        'modell_schnell' => 'qwen3-vl:8b',
        // Grosszügig: Auf dieser Maschine ist ein kaltes Modell der
        // Normalfall — die GPU ist umkämpft, und Aufwärmen kostet 60–90 s,
        // bevor überhaupt gerechnet wird.
        'zeitgrenze' => 600,
        'zeitgrenze_schnell' => 180,
    ],
    // Diese Anlage IST der Nachschlage-Dienst, sie fragt also niemanden
    // sonst. Der Schlüssel ist trotzdem nötig: Ohne ihn weist
    // nachschlagen.php jede Anfrage ab — auch die vom Hoster.
    'dienst' => [
        'adresse' => '',
        'schluessel' => $(php_text "${DIENST_SCHLUESSEL:-}"),
    ],
    // Die aufbewahrten Scanfotos. Ausserhalb des Symlinks auf den aktuellen
    // Stand, sonst verschwänden sie bei jedem Deploy.
    'bilder' => [
        'verzeichnis' => '/srv/bierexpert/bilder',
        'basis_url' => $(php_text "${BILDER_BASIS_URL:-}"),
        // Aus: Für die Anzeige genügen die Koordinaten im JSON, die der
        // Browser zeichnet. Einschalten, wenn die Bilder zum Teilen
        // gebraucht werden — dann aber sieben Kopien je Bier einplanen.
        'einzeichnungen' => false,
    ],
    'herkuenfte' => [],
    'speicher' => true,
];
KONF
  )
  chmod 600 "$KONFIG"

  # Eine Konfiguration mit Syntaxfehler fiele sonst erst beim ersten Scan
  # auf, und zwar als "Server ist noch nicht eingerichtet" — eine Meldung,
  # die in die Irre führt.
  php -l "$KONFIG" >/dev/null \
    || { echo "FEHLER: Die geschriebene Konfiguration ist kein gültiges PHP." >&2; exit 1; }
  tun "geschrieben und von PHP angenommen"
}

# --------------------------------------------------------------------------
schritt_php() {
  local v; v="$(php_version)"
  sagen "PHP-FPM-Pool (PHP ${v:-?})"

  if [ -z "$v" ]; then
    # Beim Probelauf vor der Installation gibt es /etc/php noch nicht. Das
    # ist dann keine Störung, sondern die Reihenfolge.
    if [ "$ZEIGEN" = "ja" ]; then
      tun "[würde laufen] Pool nach /etc/php/<version>/fpm/pool.d/bierexpert.conf"
      return
    fi
    echo "FEHLER: Kein /etc/php — erst den Schritt pakete laufen lassen." >&2
    exit 1
  fi

  local ziel="/etc/php/${v}/fpm/pool.d/bierexpert.conf"
  if [ -f "$ziel" ] && sudo cmp -s "$HIER/php-fpm-pool.conf" "$ziel"; then
    steht "$ziel"
  else
    ausfuehren sudo install -m 644 -o root -g root "$HIER/php-fpm-pool.conf" "$ziel"
    ausfuehren sudo systemctl enable --quiet "php${v}-fpm"
    # Prüfen, bevor neu geladen wird: Ein Fehler in der Pool-Datei nähme
    # sonst auch den laufenden Dienst mit.
    ausfuehren sudo "php-fpm${v}" -t
    ausfuehren sudo systemctl restart "php${v}-fpm"
    tun "Pool installiert und FPM neu gestartet"
  fi
}

# --------------------------------------------------------------------------
schritt_nginx() {
  sagen "nginx-vhost auf 127.0.0.1:${PORT}"

  local quelle="$HIER/nginx-bierexpert.conf"
  local ziel=/etc/nginx/sites-available/bierexpert

  if [ -f "$ziel" ] && sudo cmp -s "$quelle" "$ziel"; then
    steht "$ziel"
  else
    ausfuehren sudo install -m 644 -o root -g root "$quelle" "$ziel"
    tun "vhost installiert"
  fi

  if [ -L /etc/nginx/sites-enabled/bierexpert ]; then
    steht "verlinkt in sites-enabled"
  else
    ausfuehren sudo ln -sfn "$ziel" /etc/nginx/sites-enabled/bierexpert
  fi

  # Erst prüfen, dann laden: nginx nimmt eine kaputte Konfiguration beim
  # Neuladen nicht an, aber die Meldung will man sehen, bevor man rät.
  ausfuehren sudo nginx -t
  ausfuehren sudo systemctl reload nginx
  tun "nginx neu geladen"
}

# --------------------------------------------------------------------------
schritt_systemd() {
  sagen "Auslieferung alle fünf Minuten"

  local geaendert=nein
  for datei in bierexpert-ausliefern.service bierexpert-ausliefern.timer; do
    if [ -f "/etc/systemd/system/$datei" ] && sudo cmp -s "$HIER/$datei" "/etc/systemd/system/$datei"; then
      steht "$datei"
    else
      ausfuehren sudo install -m 644 -o root -g root "$HIER/$datei" "/etc/systemd/system/$datei"
      geaendert=ja
    fi
  done

  [ "$geaendert" = "ja" ] && ausfuehren sudo systemctl daemon-reload

  # Nur der Timer wird eingeschaltet. Der Dienst selbst ist ein oneshot und
  # wird vom Timer gestartet — ihn zusätzlich zu aktivieren liesse ihn bei
  # jedem Hochfahren zusätzlich laufen.
  ausfuehren sudo systemctl enable --now bierexpert-ausliefern.timer
  tun "Timer aktiv"
}

# --------------------------------------------------------------------------
for schritt in "${SCHRITTE[@]}"; do
  if ! declare -f "schritt_${schritt}" >/dev/null; then
    echo "Unbekannter Schritt: ${schritt}" >&2
    echo "Bekannt: pakete verzeichnisse datenbank konfiguration php nginx systemd" >&2
    exit 1
  fi
  "schritt_${schritt}"
done

sagen "Fertig"
echo "    Nächster Blick:  curl -s localhost:${PORT}/api/gesundheit.php | python3 -m json.tool"
