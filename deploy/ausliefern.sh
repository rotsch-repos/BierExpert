#!/usr/bin/env bash
#
# Liefert den gebauten Stand auf den Zielserver aus.
#
# Zwei Schritte, aus einem Grund: Auf einem geteilten Hosting ist das
# Wurzelverzeichnis der Domain ein echtes Verzeichnis, das die Verwaltung des
# Anbieters angelegt hat — es lässt sich nicht gegen einen Symlink tauschen.
# Also wird zuerst über das Netz in einen Ablageordner neben dem
# Wurzelverzeichnis übertragen und erst danach serverseitig hineinkopiert.
# Der zweite Schritt läuft lokal auf dem Server und dauert Millisekunden;
# das Zeitfenster, in dem die Seite unvollständig wäre, ist damit winzig
# statt so lang wie die Übertragung.
#
# Nebengewinn: Die alten Stände bleiben im Ablageordner liegen. Ein Rückfall
# ist deshalb ein serverseitiges Kopieren und braucht weder Build noch Netz.
#
# Läuft im Runner, nicht auf dem Server. Alles Serverseitige geht über ssh.
#
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST fehlt}"
: "${DEPLOY_USER:?DEPLOY_USER fehlt}"
: "${DEPLOY_DOCROOT:?DEPLOY_DOCROOT fehlt — das Wurzelverzeichnis der Domain}"
: "${DEPLOY_BASIS:?DEPLOY_BASIS fehlt — Ablageordner NEBEN dem Wurzelverzeichnis}"

QUELLE="${QUELLE:-dist/}"
PORT="${DEPLOY_PORT:-22}"
BEHALTEN="${DEPLOY_BEHALTEN:-5}"
MARKE="${MARKE:-$(date -u +%Y%m%dT%H%M%SZ)}"
PROBELAUF="${PROBELAUF:-nein}"

SSH="ssh -p ${PORT} -o BatchMode=yes"
ZIEL="${DEPLOY_USER}@${DEPLOY_HOST}"
STAND="${DEPLOY_BASIS}/releases/${MARKE}"

# Ein Ablageordner INNERHALB des Wurzelverzeichnisses würde beim Aufräumen
# mitgelöscht und wäre obendrein öffentlich abrufbar.
case "${DEPLOY_BASIS}/" in
  "${DEPLOY_DOCROOT}"/*)
    echo "FEHLER: DEPLOY_BASIS liegt innerhalb von DEPLOY_DOCROOT." >&2
    echo "        Der Ablageordner muss daneben liegen, nicht darin." >&2
    exit 1
    ;;
esac

echo "==> Ziel:   ${ZIEL}:${DEPLOY_DOCROOT}"
echo "==> Ablage: ${STAND}"
[ "$PROBELAUF" = "ja" ] && echo "==> PROBELAUF — es wird nichts verändert"

echo "==> Erreichbarkeit und Werkzeuge auf dem Server prüfen"
# Lieber hier scheitern als mitten im Ausliefern: der zweite Schritt kopiert
# serverseitig mit rsync, und ohne das bliebe ein übertragener Stand liegen,
# ohne je aktiv zu werden.
$SSH "$ZIEL" "command -v rsync >/dev/null" \
  || { echo "FEHLER: Auf dem Server ist kein rsync vorhanden." >&2
       echo "        Ohne rsync kann der Stand nicht übernommen werden." >&2
       exit 1; }

echo "==> Übertragen"
$SSH "$ZIEL" "mkdir -p '${STAND}'"
rsync -az --delete -e "$SSH" "${QUELLE}" "${ZIEL}:${STAND}/"

echo "==> Stand prüfen, bevor er aktiv wird"
# Ein leerer oder halber Stand darf nie ins Wurzelverzeichnis. Geprüft wird
# gegen den übertragenen Ordner, nicht gegen die laufende Seite.
$SSH "$ZIEL" "
  set -e
  test -s '${STAND}/index.html'
  test -d '${STAND}/assets'
  # Die index.html verweist auf gehashte Dateien — mindestens eine muss da sein.
  ls '${STAND}/assets/'*.js >/dev/null 2>&1
  # Ohne die Endpunkte steht zwar die Seite, aber jede Auswertung schlägt
  # fehl. Ein solcher Stand darf nicht aktiv werden.
  test -s '${STAND}/api/etikett.php'
  test -s '${STAND}/api/erweitert.php'
  test -s '${STAND}/api/intern/pforte.php'
" || {
  echo "FEHLER: Der übertragene Stand ist unvollständig. Nicht übernommen." >&2
  # Den Torso wegräumen. Bliebe er liegen, wäre er der neueste Eintrag im
  # Ablageordner — und damit das, was ein Rückfall als Erstes auswählt.
  $SSH "$ZIEL" "rm -rf -- '${STAND}'" || true
  echo "        Der unvollständige Stand wurde entfernt." >&2
  exit 1
}

if [ "$PROBELAUF" = "ja" ]; then
  echo "==> Das würde sich im Wurzelverzeichnis ändern:"
  $SSH "$ZIEL" "mkdir -p '${DEPLOY_DOCROOT}' && rsync -an --delete --exclude='.well-known/' --itemize-changes '${STAND}/' '${DEPLOY_DOCROOT}/'"
  echo "==> Probelauf beendet — nichts verändert."
  exit 0
fi

echo "==> Übernehmen"
# Serverseitiges rsync: lokal und damit in Millisekunden durch.
# --delete räumt weg, was nicht mehr zum Build gehört. Das ist gewollt, aber
# es heißt auch: In diesem Verzeichnis darf nichts von Hand liegen, das
# überleben soll.
#
# Eine Ausnahme braucht es: .well-known/ gehört nicht zum Build, sondern dem
# Anbieter. Dort legt Hostpoint den Nachweis ab, mit dem die
# Zertifizierungsstelle prüft, dass uns die Domain gehört. Der Nachweis liegt
# nur die wenigen Minuten, bis er abgeholt wird — fällt ein Deploy in dieses
# Fenster, ist er weg, die Prüfung scheitert, und das Zertifikat bleibt in
# der Aktivierung stehen. Ausgenommene Pfade rührt --delete nicht an.
$SSH "$ZIEL" "mkdir -p '${DEPLOY_DOCROOT}' && rsync -a --delete --exclude='.well-known/' '${STAND}/' '${DEPLOY_DOCROOT}/'"

echo "==> Aufräumen (die letzten ${BEHALTEN} Stände bleiben)"
$SSH "$ZIEL" "
  cd '${DEPLOY_BASIS}/releases' 2>/dev/null || exit 0
  ls -1t | tail -n +\$(( ${BEHALTEN} + 1 )) | while read -r alt; do
    rm -rf -- \"\$alt\" && echo \"    entfernt: \$alt\"
  done
"

echo "==> Fertig: ${MARKE} ist ausgeliefert"
