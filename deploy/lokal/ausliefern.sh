#!/usr/bin/env bash
#
# Liefert den Stand von main auf DIESER Maschine aus.
#
# Der Unterschied zu deploy/ausliefern.sh: Dort wird über SSH auf ein
# geteiltes Hosting übertragen, dessen Wurzelverzeichnis ein echtes
# Verzeichnis der Anbieterverwaltung ist und sich nicht gegen einen Symlink
# tauschen lässt. Hier gehört uns der Server — also der klassische Weg:
# jeder Stand in ein eigenes Verzeichnis, und umgeschaltet wird durch
# Umhängen eines Symlinks. Das ist ein Systemaufruf und damit wirklich
# unteilbar; es gibt keinen Augenblick, in dem die Seite halb ist.
#
# Läuft ohne Argumente und ohne Netz-Zugangsdaten. Ist auf main nichts Neues,
# endet der Lauf nach dem git fetch.
#
set -euo pipefail

BASIS="${BASIS:-/srv/bierexpert}"
REPO="${REPO:-$BASIS/repo}"
STAENDE="$BASIS/releases"
ZEIGER="$BASIS/aktuell"
HERKUNFT="${HERKUNFT:-https://github.com/rotsch-repos/BierExpert.git}"
ZWEIG="${ZWEIG:-main}"
BEHALTEN="${BEHALTEN:-5}"

# Das Skript liegt im Repo, das es selbst aktualisiert. Bash liest ein
# Skript nicht auf einmal ein, sondern häppchenweise während der Ausführung
# — ein git reset --hard mitten im Lauf würde also die Datei unter dem
# laufenden Interpreter austauschen. Deshalb zuerst eine Kopie anlegen und
# aus ihr weiterlaufen. Ohne das ist der Fehler selten, unerklärlich und
# tritt genau dann auf, wenn sich dieses Skript ändert.
if [ "${BIEREXPERT_KOPIE:-}" != "ja" ]; then
  kopie="$(mktemp -t bierexpert-ausliefern.XXXXXX.sh)"
  trap 'rm -f "$kopie"' EXIT
  cat "$0" > "$kopie"
  chmod +x "$kopie"
  BIEREXPERT_KOPIE=ja exec "$kopie" "$@"
fi

echo "==> BierExpert ausliefern ($(date '+%F %T'))"

# Erster Lauf: Das Repo ist noch nicht da.
if [ ! -d "$REPO/.git" ]; then
  echo "==> Erster Lauf — Repo nach ${REPO} klonen"
  mkdir -p "$(dirname "$REPO")"
  git clone --branch "$ZWEIG" "$HERKUNFT" "$REPO"
fi

git -C "$REPO" fetch --quiet origin "$ZWEIG"
NEU=$(git -C "$REPO" rev-parse "origin/${ZWEIG}")
STAND="$STAENDE/$NEU"

# Der Vergleich geht gegen den Symlink und nicht gegen eine Merkdatei: Was
# tatsächlich ausgeliefert ist, weiss allein er. Eine Merkdatei könnte
# stimmen, während der Symlink woanders hinzeigt.
if [ -L "$ZEIGER" ] && [ "$(basename "$(readlink -f "$ZEIGER")")" = "$NEU" ]; then
  echo "==> Nichts Neues auf ${ZWEIG} (${NEU:0:12}) — fertig"
  exit 0
fi

echo "==> Neuer Stand: ${NEU:0:12}"
git -C "$REPO" checkout --quiet --force "$NEU"
# Übrig gebliebene Dateien aus einem abgebrochenen Lauf würden sonst in den
# Build wandern. node_modules ist ausgenommen, sonst wäre jedes npm ci ein
# vollständiges Neuladen.
git -C "$REPO" clean -qfdx --exclude=node_modules

cd "$REPO"

echo "==> Abhängigkeiten (npm ci)"
npm ci --no-audit --no-fund

echo "==> Typen prüfen"
npm run typecheck

# Die Browser-Tests laufen nur, wenn Playwright hier schon einen Browser
# hat. Sie automatisch nachzuladen wäre ein 150-MB-Download in einem Lauf,
# der alle fünf Minuten startet. Fehlt der Browser, sagt das Protokoll es —
# stillschweigend zu überspringen wäre die schlechtere Hälfte.
if [ -d "$HOME/.cache/ms-playwright" ] && [ -n "$(ls -A "$HOME/.cache/ms-playwright" 2>/dev/null)" ]; then
  echo "==> Browser-Tests"
  npm test
else
  echo "==> Browser-Tests übersprungen: kein Playwright-Browser vorhanden."
  echo "    Einmalig nachholen mit: cd ${REPO} && npx playwright install --with-deps chromium"
fi

echo "==> Bauen"
npm run build

echo "==> Stand prüfen, bevor er aktiv wird"
# Dieselbe Prüfliste wie beim Hostpoint-Deploy: Ein halber Stand darf nie
# aktiv werden. Geprüft wird gegen den Build, nicht gegen die laufende Seite.
test -s dist/index.html
test -d dist/assets
ls dist/assets/*.js >/dev/null 2>&1
test -s dist/api/etikett.php
test -s dist/api/erweitert.php
test -s dist/api/intern/pforte.php

echo "==> Ablegen unter ${STAND}"
mkdir -p "$STAND"
rsync -a --delete dist/ "$STAND/"

# Der Python-Helfer für die Bildregistrierung gehört mit in den Stand.
#
# Er liegt unter dienst/ im Wurzelverzeichnis und nicht unter public/, weil
# er nichts ist, was ein Webserver ausliefern soll — aufgerufen wird er von
# PHP als Prozess. Mitkopiert wird er trotzdem: So gehört zu jedem Stand
# genau der Helfer, der zu seinem PHP passt. Läge er nur im Repo, liefe nach
# einem Deploy neuer Code gegen einen alten Helfer.
if [ -f dienst/registrieren.py ]; then
  mkdir -p "$STAND/dienst"
  rsync -a dienst/ "$STAND/dienst/"
fi

echo "==> Umschalten"
# ln -sfn auf einen bestehenden Symlink ist NICHT unteilbar: Es entfernt
# erst und legt dann neu an. In dem Augenblick dazwischen zeigt der Zeiger
# ins Leere und die Seite ist weg. Deshalb daneben anlegen und mit mv -T
# darüberschieben — das ist ein rename() und damit unteilbar.
ln -sfn "$STAND" "$ZEIGER.neu"
mv -Tf "$ZEIGER.neu" "$ZEIGER"

# PHP merkt sich Bytecode je Dateipfad. Der vhost reicht dank
# $realpath_root den aufgelösten Pfad weiter — jeder Stand hat damit seinen
# eigenen Eintrag, und der neue wird beim ersten Aufruf frisch gelesen.
# Ein Neuladen von FPM ist deshalb nicht nötig; das spart die Sekunden, in
# denen laufende Auswertungen sonst abbrächen.

echo "==> Aufräumen (die letzten ${BEHALTEN} Stände bleiben)"
aktuell="$(basename "$(readlink -f "$ZEIGER")")"
cd "$STAENDE"
ls -1t | tail -n +$((BEHALTEN + 1)) | while read -r alt; do
  # Der aktive Stand wird nie entfernt, auch wenn er alt ist — etwa nach
  # einem Rückfall auf einen früheren Stand.
  [ "$alt" = "$aktuell" ] && continue
  rm -rf -- "$alt" && echo "    entfernt: $alt"
done

echo "==> Fertig: ${NEU:0:12} ist aktiv"
