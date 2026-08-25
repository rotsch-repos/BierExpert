#!/usr/bin/env bash
#
# Spielt Datenbank-Migrationen in die lokale MariaDB ein.
#
# Dasselbe Muster wie deploy/migrationen.sh — nur ohne SSH, weil die
# Datenbank auf derselben Maschine steht. Angewandte Migrationen werden in
# schema_migrationen vermerkt; ein zweiter Lauf überspringt, was schon drin
# ist. Der Aufruf ist damit gefahrlos wiederholbar.
#
# Die Zugangsdaten kommen aus ~/.bierexpert/konfiguration.php — dem einen
# Ort, an dem sie stehen. Sie hier ein zweites Mal einzutragen hiesse, zwei
# Wahrheiten zu pflegen, von denen eine irgendwann falsch ist.
#
set -euo pipefail

KONFIG="${BIEREXPERT_KONFIG:-$HOME/.bierexpert/konfiguration.php}"
VERZEICHNIS="${VERZEICHNIS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/db/migrationen}"
PROBELAUF="${PROBELAUF:-nein}"

command -v mysql >/dev/null \
  || { echo "FEHLER: Kein mysql-Client vorhanden (Paket mariadb-client)." >&2; exit 1; }

[ -r "$KONFIG" ] \
  || { echo "FEHLER: Konfiguration ${KONFIG} nicht lesbar." >&2
       echo "        Sie entsteht in deploy/lokal/einrichten.sh." >&2
       exit 1; }

# Die Werte über PHP aus der Konfiguration holen und nicht mit grep: Die
# Datei ist PHP, kein Textformat, und ein Passwort mit einem Anführungs-
# zeichen darin würde jede Textzerlegung in die Irre führen.
werte() {
  php -r '
    $k = require $argv[1];
    foreach (["host","name","benutzer","passwort"] as $feld) {
      echo $k["db"][$feld] ?? "", "\n";
    }
  ' "$KONFIG"
}

{ read -r DB_HOST; read -r DB_NAME; read -r DB_USER; read -r DB_PASSWORT; } < <(werte)

: "${DB_NAME:?In der Konfiguration fehlt db.name}"
: "${DB_USER:?In der Konfiguration fehlt db.benutzer}"

# Das Passwort geht NICHT als Argument mit: Argumente stehen in der
# Prozessliste und wären für jeden auf der Maschine sichtbar. Stattdessen
# eine Optionsdatei, die nur der eigene Benutzer lesen darf und die in jedem
# Fall wieder verschwindet.
CNF="$(umask 077 && mktemp -t bierexpert-migration.XXXXXX.cnf)"
trap 'rm -f "$CNF"' EXIT

# Werte MÜSSEN in Anführungszeichen: '#' beginnt sonst auch mitten in der
# Zeile einen Kommentar, Backslash leitet Escape-Folgen ein, und Leerzeichen
# am Rand fallen weg.
cnf_wert() {
  local wert="${1-}"
  wert="${wert//\\/\\\\}"
  wert="${wert//\"/\\\"}"
  printf '"%s"' "$wert"
}

cat > "$CNF" <<CNFDATEI
[client]
host=$(cnf_wert "${DB_HOST:-localhost}")
user=$(cnf_wert "$DB_USER")
password=$(cnf_wert "$DB_PASSWORT")
CNFDATEI

MYSQL=(mysql "--defaults-extra-file=$CNF" --batch --skip-column-names "$DB_NAME")

echo "==> Verbindung zu ${DB_NAME} prüfen"
"${MYSQL[@]}" -e 'SELECT 1' >/dev/null \
  || { echo "FEHLER: Keine Verbindung zur Datenbank ${DB_NAME}." >&2; exit 1; }

echo "==> Migrationstabelle sicherstellen"
"${MYSQL[@]}" -e "
  CREATE TABLE IF NOT EXISTS schema_migrationen (
    marke        VARCHAR(255) NOT NULL PRIMARY KEY,
    angewandt_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"

echo "==> Bereits angewandt:"
ANGEWANDT=$("${MYSQL[@]}" -e 'SELECT marke FROM schema_migrationen ORDER BY marke')
if [ -z "$ANGEWANDT" ]; then echo "    (noch keine)"; else echo "$ANGEWANDT" | sed 's/^/    /'; fi

offen=0
for datei in "$VERZEICHNIS"/*.sql; do
  [ -e "$datei" ] || { echo "==> Keine Migrationen in ${VERZEICHNIS}"; break; }
  marke=$(basename "$datei" .sql)

  printf '%s\n' "$ANGEWANDT" | grep -qxF "$marke" && continue

  offen=$((offen + 1))
  if [ "$PROBELAUF" = "ja" ]; then
    echo "==> Würde einspielen: ${marke}"
    continue
  fi

  echo "==> Spiele ein: ${marke}"
  # Bricht die Migration ab, wird sie nicht als angewandt vermerkt und der
  # nächste Lauf versucht sie erneut.
  "${MYSQL[@]}" < "$datei"
  "${MYSQL[@]}" -e "INSERT INTO schema_migrationen (marke) VALUES ('${marke}')"
  echo "    eingespielt"
done

if [ "$offen" -eq 0 ]; then
  echo "==> Nichts einzuspielen, alles auf Stand"
elif [ "$PROBELAUF" = "ja" ]; then
  echo "==> Probelauf: ${offen} offen, nichts verändert"
else
  echo "==> Fertig: ${offen} eingespielt"
fi
