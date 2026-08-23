#!/usr/bin/env bash
#
# Spielt Datenbank-Migrationen ein.
#
# Läuft über SSH auf dem Server, nicht im Runner: Der Datenbank-Host ist nur
# innerhalb des Hostpoint-Netzes auflösbar, von außen kommt niemand daran.
#
# Angewandte Migrationen werden in einer Tabelle vermerkt; ein zweiter Lauf
# überspringt, was schon drin ist. Damit ist der Aufruf gefahrlos wiederholbar
# und kann fest im Deploy hängen.
#
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST fehlt}"
: "${DEPLOY_USER:?DEPLOY_USER fehlt}"
: "${DB_NAME:?DB_NAME fehlt}"
: "${DB_USER:?DB_USER fehlt}"
: "${DB_PASSWORT:?DB_PASSWORT fehlt}"

DB_HOST="${DB_HOST:-localhost}"
PORT="${DEPLOY_PORT:-22}"
VERZEICHNIS="${VERZEICHNIS:-db/migrationen}"
PROBELAUF="${PROBELAUF:-nein}"

SSH="ssh -p ${PORT} -o BatchMode=yes"
ZIEL="${DEPLOY_USER}@${DEPLOY_HOST}"

echo "==> mysql-Client auf dem Server prüfen"
$SSH "$ZIEL" "command -v mysql >/dev/null" \
  || { echo "FEHLER: Auf dem Server ist kein mysql-Client vorhanden." >&2
       echo "        Ohne ihn lassen sich Migrationen nicht einspielen." >&2
       exit 1; }

# Das Passwort geht NICHT als Argument mit: Argumente stehen in der
# Prozessliste und wären für jeden auf dem Server sichtbar. Stattdessen eine
# temporäre Datei, die nur der eigene Benutzer lesen darf, und die in jedem
# Fall wieder verschwindet.
FERN_CNF=".bierexpert-migration-$$.cnf"

$SSH "$ZIEL" "umask 077 && cat > '${FERN_CNF}'" <<CNF
[client]
host=${DB_HOST}
user=${DB_USER}
password=${DB_PASSWORT}
CNF

# trap sorgt dafür, dass die Datei auch bei Abbruch weggeräumt wird.
aufraeumen() { $SSH "$ZIEL" "rm -f '${FERN_CNF}'" >/dev/null 2>&1 || true; }
trap aufraeumen EXIT

MYSQL="mysql --defaults-extra-file='${FERN_CNF}' --batch --skip-column-names '${DB_NAME}'"

echo "==> Verbindung prüfen"
$SSH "$ZIEL" "$MYSQL -e 'SELECT 1' >/dev/null" \
  || { echo "FEHLER: Keine Verbindung zur Datenbank ${DB_NAME}." >&2; exit 1; }

echo "==> Migrationstabelle sicherstellen"
$SSH "$ZIEL" "$MYSQL -e \"
  CREATE TABLE IF NOT EXISTS schema_migrationen (
    marke        VARCHAR(255) NOT NULL PRIMARY KEY,
    angewandt_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
\""

echo "==> Bereits angewandt:"
ANGEWANDT=$($SSH "$ZIEL" "$MYSQL -e 'SELECT marke FROM schema_migrationen ORDER BY marke'")
if [ -z "$ANGEWANDT" ]; then echo "    (noch keine)"; else echo "$ANGEWANDT" | sed 's/^/    /'; fi

offen=0
for datei in "$VERZEICHNIS"/*.sql; do
  [ -e "$datei" ] || { echo "==> Keine Migrationen in ${VERZEICHNIS}"; break; }
  marke=$(basename "$datei" .sql)

  if printf '%s\n' "$ANGEWANDT" | grep -qxF "$marke"; then
    continue
  fi

  offen=$((offen + 1))
  if [ "$PROBELAUF" = "ja" ]; then
    echo "==> Würde einspielen: ${marke}"
    continue
  fi

  echo "==> Spiele ein: ${marke}"
  # Die Migration und ihr Eintrag gehen in einem Aufruf durch. Bricht die
  # Migration ab, wird sie nicht als angewandt vermerkt und der nächste Lauf
  # versucht sie erneut.
  $SSH "$ZIEL" "$MYSQL" < "$datei"
  $SSH "$ZIEL" "$MYSQL -e \"INSERT INTO schema_migrationen (marke) VALUES ('${marke}')\""
  echo "    eingespielt"
done

if [ "$offen" -eq 0 ]; then
  echo "==> Nichts einzuspielen, alles auf Stand"
elif [ "$PROBELAUF" = "ja" ]; then
  echo "==> Probelauf: ${offen} offen, nichts verändert"
else
  echo "==> Fertig: ${offen} eingespielt"
fi
