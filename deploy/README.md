# Auslieferung

Automatisches Deploy nach jedem Push auf `main`, nachdem Typprüfung, Build und
alle Tests durchgelaufen sind. Schlägt eine Prüfung fehl, wird nichts
ausgeliefert.

## Wie es abläuft

Es wird nie direkt in das Wurzelverzeichnis der Domain geschrieben. Der Grund:
Auf einem geteilten Hosting ist dieses Verzeichnis von der Verwaltung des
Anbieters angelegt und lässt sich nicht gegen einen Symlink tauschen — der
sonst übliche Trick, einen Stand in einem Zug aktiv zu schalten, fällt also aus.

Stattdessen zwei Schritte:

1. **Übertragen** — der Build geht über das Netz in einen eigenen Ordner unter
   `$DEPLOY_BASIS/releases/<marke>`. Das dauert, ist aber unsichtbar: die
   laufende Seite ist davon nicht berührt.
2. **Übernehmen** — erst wenn der Stand vollständig oben *und* geprüft ist,
   kopiert ein serverseitiges `rsync` ihn ins Wurzelverzeichnis. Das läuft
   lokal auf dem Server und dauert Millisekunden.

Das Zeitfenster, in dem die Seite unvollständig sein könnte, ist damit so kurz
wie ein lokales Kopieren statt so lang wie eine Übertragung über das Netz.

Geprüft wird vor dem Übernehmen, ob `index.html` existiert und nicht leer ist,
ob `assets/` da ist und mindestens eine Skriptdatei enthält. Fällt eine dieser
Prüfungen durch, bleibt die laufende Seite unangetastet und der unvollständige
Stand wird weggeräumt — sonst wäre er der neueste Eintrag im Ablageordner und
damit genau das, was ein Rückfall zuerst auswählen würde.

Die letzten fünf Stände bleiben liegen. Ein Rückfall ist deshalb ein
serverseitiges Kopieren: keine Übertragung, kein Build, und er funktioniert
auch dann noch, wenn der Build gerade nicht durchläuft.

## Einmalige Einrichtung

### 1. Auf dem Server: nichts zu tun

Die Verzeichnisse legt das Deploy selbst an (`mkdir -p`), das Wurzelverzeichnis
eingeschlossen. Es genügt, dass der SSH-Zugang steht.

Zu beachten ist nur, **wo** der Ablageordner liegt: außerhalb des
Wurzelverzeichnisses. Läge er darin, würde ihn das Aufräumen beim nächsten
Deploy mitlöschen, und er wäre obendrein öffentlich abrufbar. Das Skript prüft
das und bricht ab, wenn es der Fall ist.

### 2. Repository-Variablen

`Settings → Secrets and variables → Actions → Variables → New repository variable`

| Name              | Wert                                 |
| ----------------- | ------------------------------------ |
| `DEPLOY_HOST`     | `atozadec.myhostpoint.ch`            |
| `DEPLOY_USER`     | `atozadec`                           |
| `DEPLOY_DOCROOT`  | `/home/atozadec/www/bierexpert.de`   |
| `DEPLOY_BASIS`    | `/home/atozadec/deploy/bierexpert`   |
| `DEPLOY_URL`      | `https://bierexpert.de`              |
| `DB_HOST`         | `atozadec.mysql.db.internal`         |
| `DB_NAME`         | `atozadec_bierexpert`                |
| `DB_USER`         | `atozadec_expert`                    |

Optional: `DEPLOY_PORT` (Vorgabe 22), `DEPLOY_BEHALTEN` (Vorgabe 5),
`LLM_MODELL` (Vorgabe `qwen3-vl:30b`), `LLM_MODELL_SCHNELL` (Vorgabe
`qwen3-vl:8b`).

Diese Werte sind bewusst Variablen und keine Secrets: Sie sind nicht geheim,
und in den Protokollen sichtbare Pfade helfen bei der Fehlersuche. Geheim ist
nur der Schlüssel.

### 3. Secrets

`Settings → Secrets and variables → Actions → Secrets → New repository secret`

| Name               | Inhalt                                                    |
| ------------------ | --------------------------------------------------------- |
| `SSH_PRIVATE_KEY`  | Der **private** Schlüssel, vollständig mit Kopf- und Fußzeile |
| `SSH_KNOWN_HOSTS`  | Der Fingerabdruck des Servers                              |
| `DB_PASSWORT`      | Das Passwort des Datenbankbenutzers                         |
| `LLM_ENDPUNKT`     | Adresse des Ollama-Dienstes, **ohne** `/api` am Ende         |
| `LLM_SCHLUESSEL`   | Nur, wenn ein nginx davor einen Schlüssel verlangt           |

`LLM_ENDPUNKT` ist als Secret angelegt und nicht als Variable: Die Adresse
zeigt auf den Rechner zu Hause, an dem das Modell hängt. Sie ist kein
Passwort, aber sie gehört auch nicht in ein öffentliches Protokoll.

Fehlt `LLM_ENDPUNKT`, überspringt das Deploy das Schreiben der Konfiguration
mit einem Hinweis im Protokoll — die Seite wird trotzdem ausgeliefert. Fehlt
`DB_PASSWORT`, läuft die Anwendung ohne Zwischenspeicher: jeder Scan geht ans
Modell. Beides sind Zustände, keine Fehler, und werden als solche gemeldet.

Den privaten Schlüssel ausgeben:

```bash
cat ~/.ssh/turnierwerk_deploy
```

Alles einfügen, von `-----BEGIN ...` bis `-----END ...`, samt Leerzeile am Ende.

Den Fingerabdruck holen:

```bash
ssh-keyscan -H atozadec.myhostpoint.ch
```

Die vollständige Ausgabe einfügen.

> **Warum nicht einfach `StrictHostKeyChecking=no`?** Das würde jeden Server
> akzeptieren, der sich unter dieser Adresse meldet. Genau dort könnte sich
> jemand dazwischenschalten und bekäme den Deploy-Schlüssel. Der hinterlegte
> Fingerabdruck schließt das aus.

> **Zum Schlüssel:** `turnierwerk_deploy` ist bereits für ein anderes Projekt
> im Einsatz. Das funktioniert, heißt aber: Wer ihn kompromittiert, hat Zugriff
> auf beide. Ein eigener Schlüssel je Projekt lässt sich einzeln zurückziehen —
> `ssh-keygen -t ed25519 -f ~/.ssh/bierexpert_deploy` und den öffentlichen Teil
> in `~/.ssh/authorized_keys` auf dem Server ergänzen.

### 4. Umgebung (empfohlen)

`Settings → Environments → New environment → produktion`

Dort lässt sich eine Freigabe verlangen, bevor ausgeliefert wird, und die
Secrets lassen sich an die Umgebung binden statt an das ganze Repository.

## Erster Lauf

Zuerst ohne Wirkung prüfen:

`Actions → Deploy → Run workflow → Probelauf ankreuzen → Run`

Der Lauf überträgt den Stand und zeigt, was sich im Wurzelverzeichnis ändern
würde, ohne etwas anzufassen. Sieht die Liste richtig aus, denselben Workflow
ohne Häkchen starten.

## Zurücksetzen

`Actions → Zurücksetzen → Run workflow`

Ohne Angabe geht es auf den letzten Stand vor dem aktuellen zurück. Mit einer
Marke (etwa `12-a1b2c3d`) gezielt auf einen bestimmten. Die verfügbaren Marken
stehen am Anfang der Protokollausgabe.

Von Hand geht es genauso:

```bash
DEPLOY_HOST=atozadec.myhostpoint.ch \
DEPLOY_USER=atozadec \
DEPLOY_DOCROOT=/home/atozadec/www/bierexpert.de \
DEPLOY_BASIS=/home/atozadec/deploy/bierexpert \
./deploy/zuruecksetzen.sh
```

## Voraussetzungen auf dem Server

- SSH-Zugang mit Schlüssel
- `rsync` — wird vor dem Übertragen geprüft; fehlt es, bricht das Deploy ab,
  bevor irgendetwas angefasst wird
- Ein Wurzelverzeichnis, in dem **nichts von Hand liegt**. Das Übernehmen
  räumt mit `--delete` auf: Was nicht zum Build gehört, verschwindet.

## Datenbank

Angelegt auf Hostpoint:

| | |
| --- | --- |
| Host | `atozadec.mysql.db.internal` |
| Datenbank | `atozadec_bierexpert` |
| Benutzer | `atozadec_expert` |
| Version | MariaDB 10.11 |

### Der Host ist intern — das bestimmt die Architektur

`…​.db.internal` ist nur innerhalb des Hostpoint-Netzes auflösbar. Daraus folgt
zweierlei, und beides ist keine Vorliebe, sondern eine Gegebenheit:

- **Migrationen laufen nicht im Runner.** Ein GitHub-Runner erreicht diesen
  Host nicht. `deploy/migrationen.sh` verbindet sich deshalb per SSH auf den
  Hostpoint-Server und ruft den dortigen `mysql`-Client auf.
- **Serverseitiger Code muss auf Hostpoint laufen.** Auch ein Dienst auf einem
  eigenen Server käme nicht an diese Datenbank, ohne einen Tunnel zu legen.
  Auf Hostpoint-Webhosting heißt das: PHP.

Nachprüfen lässt sich das mit:

```bash
ssh atozadec@atozadec.myhostpoint.ch \
  "getent hosts atozadec.mysql.db.internal && command -v mysql"
```

Vom eigenen Rechner aus schlägt dieselbe Auflösung fehl — das ist der Beleg.

### Migrationen

SQL-Dateien liegen in `db/migrationen/` und werden nach Dateinamen sortiert
eingespielt. Die Benennung `JJJJMMTTThhmm-was-es-tut.sql` sorgt dafür, dass
die Reihenfolge stimmt.

Angewandte Migrationen stehen in der Tabelle `schema_migrationen`; ein zweiter
Lauf überspringt, was schon drin ist. Der Aufruf ist dadurch gefahrlos
wiederholbar.

```bash
# Erst ansehen, was passieren würde
DEPLOY_HOST=atozadec.myhostpoint.ch DEPLOY_USER=atozadec \
DB_HOST=atozadec.mysql.db.internal DB_NAME=atozadec_bierexpert \
DB_USER=atozadec_expert DB_PASSWORT='…' \
PROBELAUF=ja ./deploy/migrationen.sh

# Dann einspielen: dieselbe Zeile ohne PROBELAUF
```

Das Passwort geht **nicht** als Kommandoargument mit. Argumente stehen in der
Prozessliste und wären für jeden auf dem Server sichtbar; stattdessen wird auf
dem Server eine Konfigurationsdatei mit `umask 077` geschrieben, die auch bei
einem Abbruch wieder entfernt wird.

Als GitHub-Secret gehört das Passwort unter `DB_PASSWORT`, die übrigen Werte
als Variablen `DB_HOST`, `DB_NAME`, `DB_USER`.

## Was noch nicht abgedeckt ist

Die Migrationen hängen bewusst **nicht** am Deploy, sondern laufen von Hand
(`migrationen.yml`). Ein Schemawechsel und ein Codewechsel sollen nicht
zusammen in einem Schritt stecken: Fällt eine Auslieferung zurück, fällt das
Schema nicht mit zurück, und eine Migration, die im selben Lauf wie das Deploy
scheitert, liesse einen halben Zustand stehen.

Der Preis dafür: Nach einer neuen Migration muss `migrationen.yml` einmal
gestartet werden, sonst antwortet `/api/gesundheit.php` mit fehlenden Tabellen
und jeder Scan geht ans Modell.

## Nach dem Deploy: steht alles?

```
https://bierexpert.de/api/gesundheit.php
```

Ein Aufruf, drei Antworten: PHP mit seinen Erweiterungen, die Datenbank samt
Tabellenständen, das Sprachmodell samt vorhandener Modelle. Das Deploy ruft ihn
selbst auf und schreibt das Ergebnis ins Protokoll — findet es etwas, wird das
als Warnung vermerkt und nicht als Fehlschlag: Die Auslieferung ist an dieser
Stelle durch, und was fehlt, lässt sich nachziehen, ohne neu auszuliefern.
