# Auftrag: Bierdatenbank und Modell auf die Workstation, Seite bleibt beim Hoster

Für die Claude-Code-Session, die auf der Workstation läuft (roger-HP-Z6-G5-A).
Ursprünglich geschrieben von der Remote-Session vom 24./25.08.2026, am
26.08.2026 grundlegend überarbeitet: **Das Ziel hat sich geändert.**

## Was sich geändert hat (26.08.2026)

Die erste Fassung dieses Auftrags wollte die **ganze Seite** auf die
Workstation holen — mitsamt DNS-Umschaltung von `bierexpert.de` auf den
Tunnel. Das ist vom Tisch. Roger hat entschieden:

> Das KI-Modell mit der Bierdatenbank läuft auf der lokalen Workstation und
> wird via Cloudflare durchgereicht. Es wird lediglich geprüft, ob ein Bier
> in der lokalen DB ist; wenn ja, wird JSON + Bilder aus der DB geschickt
> und im Frontend angezeigt. Die ganze Homepage bleibt auf Hostpoint.

**Phase B in der alten Fassung ist damit hinfällig.** Sie steht unten in
neuer Gestalt: nicht DNS umbiegen, sondern einen Dienst durchreichen.

## Zielbild

| Wo | Was |
|---|---|
| Hostpoint (bierexpert.de) | die ganze Seite, und der Dirigent: `/api/etikett.php` |
| Workstation (Cloudflare-Tunnel) | `qwen3-vl:8b`, MariaDB, die aufbewahrten Scanfotos |
| Anthropic | zerlegt ein Etikett — **einmal je Bier**, danach nie wieder |

```
Browser -> Hostpoint /api/etikett.php
              |
              |  POST /api/nachschlagen.php   (Dienstschlüssel)
              +--> Workstation: 8b liest ab -> MariaDB
              |      Treffer    -> Zerlegung + Fotos zurück   ENDE, nichts bezahlt
              |      Fehlschlag -> was gelesen wurde, zurück
              |
              +--> Anthropic zerlegt das Etikett             einmal je Bier
              |
              +--> POST /api/merken.php  -> Workstation legt es ab
```

Die Rechnung wächst damit nicht mit der Zahl der Scans, sondern mit der Zahl
der noch unbekannten Biere — und die geht mit jedem Fund zurück.

**Die direkte Anthropic-Route bleibt bis zum Schluss bestehen.** Sie ist der
Rückfall, wenn die Workstation nicht erreichbar ist, und die Spielwiese, auf
der weiter jemand herumprobieren können soll. Abgeschaltet wird sie erst
ganz am Ende, und nicht ohne Ansage.

## Feste Fakten (nicht neu ausmessen)

Gemessen am 25./26.08.2026 auf dieser Maschine:

- **Denken beim Ablesen ist abgeschaltet** (`think: false`) und muss es
  bleiben. Mit Denken erzeugte `qwen3-vl:8b` bis zu 6889 Token ohne eine
  einzige Zeile Antwort und lieferte nach ~65 s einen leeren Inhalt
  (`done_reason: length`). Über sechs Fotos zu je fünf Läufen: mit Denken
  21/30 Antworten bei 2200 ms Median, ohne Denken 30/30 bei 390 ms.
- **Ollama 0.32 legt die Antwort bei abgeschaltetem Denken in `thinking`
  statt in `content`.** Der Code sieht dort nach. Fällt der Fehler weg,
  verhält sich der Zweig von selbst still.
- **Der Schlüssel muss stabil sein, nicht richtig.** Das 8b liest Rothaus
  konsequent als „TANNEN ZÄPPL" — fünfmal identisch. Als Nachschlage-
  schlüssel einwandfrei; angezeigt wird ohnehin, was die Tiefenanalyse sagt.
- **Zeiten:** Trefferscan Ende zu Ende 2,5–4,1 s (Ablesen + Verorten, beides
  lokal, null Credits). Kaltes 8b: 7,4 s, davon 3,9 s Laden.
- **Grafikspeicher.** Die Ada (49 GB) trägt Johann (40 GB bei num_ctx
  131072) und das 8b (6,5 GB) nebeneinander. Die Quadro RTX 5000 (15 GB,
  **nicht** 24) trägt Whisper (3,9 GB) und openclaws Compaction-Modell
  (9,1 GB) — dort ist für das 8b **kein** Platz, und
  `OLLAMA_MAX_LOADED_MODELS=1` in `ollama-small.service` liesse beide
  einander verdrängen. Das 8b bleibt auf der Ada.
- **Nie mit `ollama run` vorwärmen** — das lädt mit 262144 Kontext (45 GB)
  und verdrängt alles. Vorwärmen nur über `/api/chat` mit den App-Optionen.
- Frontend bricht nach 5,5 Minuten ab (bewusst, `src/etikett.ts`).
- App-Konfiguration: `~/.bierexpert/konfiguration.php`, alternativ über
  `BIEREXPERT_KONFIG`. Migrationen: `db/migrationen/*.sql`, Buchführung in
  `schema_migrationen`, lokal über `deploy/lokal/migrationen.sh`.
- PHP-Erweiterungen: pdo_mysql, curl, mbstring (prüft `/api/gesundheit.php`).

## Arbeitsweise

Auf einem Branch arbeiten, deutsche Commits, die das Warum erklären,
Prüfungen gegen Doubles bzw. gegen die echte lokale Umgebung, kleine
nachvollziehbare Schritte. Systemdateien als Vorlagen unter `deploy/lokal/`,
installiert durch das idempotente `einrichten.sh`. **Sudo-Schritte mit Roger
zusammen.**

## Phase A — lokal lauffähig (erledigt, mit zwei Lücken)

Erledigt: Pakete, MariaDB, Migrationen, Konfiguration (600), nginx-vhost auf
`127.0.0.1:8300`, FPM-Pool. `/api/gesundheit.php` meldet `bereit: true`.

Offen:

1. **Der Auslieferungs-Timer ist nirgends installiert** — weder auf System-
   noch auf Benutzerebene. Die Vorlagen (`bierexpert-ausliefern.service`
   und `.timer`) liegen bereit. Braucht sudo.
2. **Doppelte systemd-Unit für die FastAPI.** Die Benutzer-Unit läuft und
   hält Port 8001; die System-Unit `/etc/systemd/system/bierexpert-api.service`
   kommt deshalb nie hoch und kreist seit >885 Neustarts. Braucht sudo:
   `sudo systemctl disable --now bierexpert-api.service`.
3. **Das Bilderverzeichnis** `/srv/bierexpert/bilder` legt `einrichten.sh`
   jetzt an; auf dieser Maschine ist es noch nicht angelegt.

## Phase B — den Dienst durchreichen (NEU, ersetzt die DNS-Umschaltung)

Die Seite bleibt, wo sie ist. Durchgereicht wird nur der Nachschlage-Dienst.

1. **Tunnel-Route** auf den lokalen vhost (`http://localhost:8300`) unter
   einem eigenen Namen. Herausfinden, ob der Tunnel `bierexpert`
   (ID `889801db-11b4-4a3c-9324-3328b90a17e2`) über das Dashboard oder eine
   lokale `config.yml` verwaltet wird — in `~/.cloudflared/` lagen keine
   Routen, spricht fürs Dashboard.
   **`bierexpert.de` und `www` bleiben unverändert auf Hostpoint.**
2. **Gemeinsames Geheimnis erzeugen** und auf beiden Seiten eintragen:
   - Workstation: `dienst.schluessel` in `~/.bierexpert/konfiguration.php`
   - Hostpoint: Secret `DIENST_SCHLUESSEL`, dazu Variable `DIENST_ADRESSE`
     (die Tunnel-Adresse plus `/api`)
   Ohne das weist `nachschlagen.php` jede Anfrage ab — mit Absicht: Wer die
   Adresse kennt, könnte sonst die Grafikkarte beschäftigen und Einträge in
   die Bierdatenbank schreiben.
3. **`bilder.basis_url`** auf der Workstation setzen (die Tunnel-Adresse
   plus `/bilder`), sonst kommt die Galerie ohne Adressen zurück.
4. **Abnahme:** Ein Scan von extern (Handy-Netz) durch, zweimal dasselbe
   Foto. Erwartet: beim zweiten Mal `quelle: speicher`, kein Anthropic-
   Aufruf, Galerie gefüllt. Ausdrücklich auch **kalt** prüfen.

Nicht mehr Teil dieser Phase: DNS-Einträge, Stilllegen der Hostpoint-
Workflows. Beides bleibt, wie es ist.

## Phase C — Fortschritts-Strom (erledigt) und die Animation (offen)

**Erledigt am 26.08.:** `/api/etikett.php` streamt NDJSON, wenn der Aufrufer
`Accept: application/x-ndjson` schickt. Zeilen: `laden`, `erkennung`,
`erkannt` (mit Brauerei und Name!), `gefunden` (mit Stil), `verorten`,
`auswertung`, `puls` alle 5 s, `fertig`/`fehler`. Der Herzschlag entsteht in
curls Fortschrittsfunktion — die einzige Stelle, an der sich während einer
blockierenden Anfrage etwas tun lässt. Cloudflares 524 ist damit entschärft.

Das Frontend liest den Strom und zeigt eine Braumeister-Zeile; der erkannte
Name steht nach ~0,5 s in einer eigenen, **bleibenden** Zeile darüber. (Mit
nur einer Zeile ging er unter — Server schickt `erkannt` und `auswertung`
unmittelbar hintereinander.)

**Offen:** die grosse Brauerei-Animation anstelle der schlichten Textzeile.
Sie hängt an denselben Ereignissen; es ist reine Frontend-Arbeit.

**Ebenfalls offen:** die Websearch-Anreicherung (SearXNG lokal).

## Phase D — die Einzeichnungen je Element (NEU, Entscheidung offen)

Roger möchte, dass zu jedem Element „dasselbe Bild mit *einer* Einzeichnung"
verfügbar ist — etwa die Frau auf dem Etikett, einzeln markiert.

Die Bedeutung eines Elements gilt bierweit, seine **Bildposition nur für
dieses eine Foto**. Die Koordinaten gehören deshalb an den Scan, nicht ans
Bier — genau so, wie es die scans-Tabelle schon für `sicherheit` und
`hinweis` hält.

Zwei Wege, und der Unterschied ist erheblich:

- **Koordinaten je Scan speichern** (empfohlen). Vier Zahlen je Element.
  Das Frontend zeigt dasselbe Foto mit je einem Rahmen — es zeichnet die
  Rahmen heute schon (`kastenPruefen`). Kosten: ein paar Bytes.
- **Gerenderte Bilder je Element speichern.** Bei 7 Elementen sieben fast
  identische Kopien desselben Fotos, ~7 MB statt 1 MB je Scan. Lohnt sich
  nur, wenn die Bilder das Frontend verlassen sollen — zum Teilen, für eine
  Vorschau in WhatsApp, für einen PDF-Steckbrief. Dann besser **auf Abruf**
  erzeugen (GD ist in PHP vorhanden) als auf Vorrat.

Vorschlag: Koordinaten speichern, Rendern erst dann, wenn ein Teilen-Knopf
tatsächlich gebaut wird.

## Phase E — der Datenumzug (NEU)

Die Bierdatenbank auf der Workstation enthält **genau ein Bier**. Was bei
Hostpoint liegt, ist nicht übernommen. Vor der Abnahme von Phase B klären:
Wird übernommen, oder fängt das Kompendium hier neu an? Die Schlüssel sind
in beiden Datenbanken nach derselben Regel gebildet, ein Übertrag ist also
möglich.

## Nicht anfassen

- Die `ki.bierexpert.de`-Route und den nginx-Wächter davor.
- `ollama.service` (Johann) und `ollama-small.service` (Whisper/Compaction) —
  beide sind bewusst auf ihre Karte gepinnt und dokumentiert.
- Mail/MX-Einträge (zeigen auf Hostpoint, davon lebt die Mailadresse).
- Die DNS-Einträge von `bierexpert.de` und `www`.
- Die direkte Anthropic-Route, bis Roger sie ausdrücklich abschaltet.
