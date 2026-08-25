# Auftrag: Umzug der Website von Hostpoint auf diese Workstation

Für die Claude-Code-Session, die auf der Workstation läuft (roger-HP-Z6-G5-A).
Geschrieben von der Remote-Session vom 24./25.08.2026, die das Umfeld saniert
hat. Dieser Auftrag enthält alle Befunde aus zwei Tagen Fehlersuche — bitte
erst vollständig lesen, dann Phase für Phase arbeiten. Bei jeder Phase gilt:
erst lokal beweisen, dann weiter.

## Warum der Umzug

Die Auswertung eines Etiketts ist eine lange, blockierende Anfrage
(8b-Vorlauf, dann 30b — warm 15–25 s, kalt deutlich mehr). Auf dem bisherigen
Weg Browser → Cloudflare → Hostpoint-PHP → Tunnel → Ollama stehen zwei Grenzen:

- **Hostpoint kappt PHP-Anfragen hart** — gemessen am 25.08.: 502 nach ~27
  Sekunden. Das eigene `set_time_limit(0)` und die 300-s-Zeitgrenze im Code
  waren nie wirksam. Nicht konfigurierbar, Shared Hosting.
- **Cloudflare 100 Sekunden (Fehler 524)**: zählt die Zeit **bis zum ersten
  Byte** der Antwort, danach nur noch Stille zwischen Bytes. Auf eigenem
  Server also durch früh gesendete Bytes entschärfbar — auf Hostpoint nicht.

Dazu kommt: Die GPU dieser Maschine ist umkämpft (Johann, lokale
Coding-Sessions laden eigene Modelle). `keep_alive: -1` steht zwar im Code,
schützt aber nur vor Leerlauf-Entladung, nicht vor Verdrängung — **kalte
Modelle sind hier der Normalfall.** Ein Scan muss auch dann überleben, wenn
er erst 60–90 s aufwärmen muss. Fazit: Die lange Anfrage darf nirgendwo
durchlaufen, wo jemand anderes die Geduld begrenzt.

## Zielbild

Alles auf dieser Workstation: der **vorhandene nginx** (der schon vor Ollama
sitzt) bekommt einen vhost für die Website (statisch + PHP-FPM für /api),
daneben eine lokale **MariaDB**; PHP ruft Ollama direkt über
`http://localhost:11434` (kein Tunnel-Hop, kein Schlüssel nötig). Öffentlich
erreichbar bleibt die Seite über den bestehenden Cloudflare-Tunnel
`bierexpert` (ID `889801db-11b4-4a3c-9324-3328b90a17e2`) — die
Published-App-Routen für `bierexpert.de` und `www.bierexpert.de` existieren
dort bereits und sind derzeit brach (DNS zeigt per A-Record auf Hostpoint).

## Feste Fakten (nicht neu ausmessen)

- App-Konfiguration wird aus `~/.bierexpert/konfiguration.php` gelesen
  (Struktur: siehe `deploy/konfiguration.sh`; alternativer Pfad über die
  Umgebungsvariable `BIEREXPERT_KONFIG`). Lokal: `llm.endpunkt =
  http://localhost:11434`, `schluessel` leer, `speicher = true`.
- Modelle `qwen3-vl:30b` und `qwen3-vl:8b`. Die App setzt `num_ctx`
  16384/8192 und `keep_alive: -1`. **Nie mit `ollama run` vorwärmen** — das
  lädt das 30b mit 262144 Kontext (45 GB!) und verdrängt das 8b. Vorwärmen
  nur über `/api/chat` mit exakt den App-Optionen.
- Schema: `db/migrationen/*.sql`, Buchführung in `schema_migrationen`
  (Muster: `deploy/migrationen.sh` — läuft dort über SSH, lokal entsprechend
  ohne SSH nachbauen).
- Frontend bricht nach 5,5 Minuten ab (bewusst, `src/etikett.ts`).
- Bildgrössen: Server nimmt bis 8 MB dekodiert an → `client_max_body_size`
  und `post_max_size` mindestens 16M.
- PHP-Erweiterungen: pdo_mysql, curl, mbstring (prüft `/api/gesundheit.php`).
- Rückweg-DNS (falls je gebraucht): `bierexpert.de`/`www` als A
  `217.26.53.94` + AAAA `2a00:d70:0:b:2002:0:d91a:355e`, Proxied.

## Arbeitsweise

Wie im Repo üblich: auf einem Branch arbeiten, deutsche Commits, die das
Warum erklären, Prüfungen gegen Doubles bzw. gegen die echte lokale Umgebung,
kleine nachvollziehbare Schritte. Systemdateien (vhost, Pool, Units) als
Vorlagen unter `deploy/lokal/` ins Repo, dazu ein idempotentes
`einrichten.sh`, das sie installiert — sudo-Schritte mit Roger zusammen.

## Phase A — lokal lauffähig, noch unsichtbar

1. Pakete: php-fpm (8.x), php-mysql, php-curl, php-mbstring, mariadb-server.
2. Datenbank `bierexpert` + lokaler Benutzer, Migrationen einspielen,
   Konfigurationsdatei schreiben (Rechte 600).
3. nginx-vhost auf `127.0.0.1:8300` (nur localhost — öffentlich macht ihn
   allein der Tunnel): root auf den aktiven Stand, PHP über FPM-Socket,
   `fastcgi_read_timeout 600`, im FPM-Pool `request_terminate_timeout 0`.
4. Lokales Deploy `deploy/lokal/ausliefern.sh`: git fetch, bei neuem Stand
   auf main → npm ci, Prüfungen, Build, Stand nach `releases/<sha>`,
   **Symlink-Umschaltung** (lokal gibt es die Shared-Hosting-Einschränkung
   nicht mehr — der klassische Trick ist wieder erlaubt), letzte 5 Stände
   behalten. Dazu systemd-Service + Timer (alle 5 Minuten).
5. Abnahme Phase A: `curl localhost:8300/api/gesundheit.php` →
   `bereit: true`, `datenbank.verbunden: true`; ein kompletter Scan per curl
   gegen localhost läuft durch — ausdrücklich auch **kalt** (>27 s beweist,
   dass der alte Killer weg ist).

## Phase B — Umschalten (zusammen mit Roger)

1. Tunnel-Routen `bierexpert.de` und `www.bierexpert.de` auf
   `http://localhost:8300` zeigen lassen (herausfinden, ob der Tunnel über
   Dashboard oder lokale config.yml verwaltet wird — entsprechend dort).
2. DNS im Cloudflare-Dashboard: A/AAAA von Apex und `www` entfernen, durch
   die Tunnel-CNAMEs ersetzen (`<TUNNEL-ID>.cfargotunnel.com`, Proxied).
   Greift in Minuten; Rückweg = Einträge zurücktauschen (oben dokumentiert).
   Hostpoint bleibt vollständig stehen — das ist der Sicherheitsnetz.
3. Abnahme Phase B: Scan von extern (Handy-Netz!) durch, auch kalt; danach
   die Hostpoint-Workflows stilllegen (Variable `DEPLOY_URL` leeren und die
   Workflows Deploy/Migrationen/Zurücksetzen deaktivieren — nicht löschen).

## Phase C — Fortschritts-Strom und Braumeister-Zeile

Jetzt, wo der Server uns gehört: `etikett.php` streamt NDJSON — sofort
Header und erstes Byte, dann Ereigniszeilen je Etappe:
`{"stufe":"laden"}`, `{"stufe":"erkennung"}`,
`{"stufe":"erkannt","brauerei":…,"name":…,"stil":…}` (echtes
Zwischenergebnis!), `{"stufe":"auswertung"}`, `{"stufe":"fertig","etikett":…}`.
Zwischen den Etappen alle paar Sekunden ein Heartbeat — damit ist
Cloudflares 524 dauerhaft entschärft, egal wie kalt die GPU ist. Frontend
liest den Strom (fetch-Reader) und zeigt vorerst eine schlichte Textzeile in
Braumetaphern („Der Kessel wird angeheizt…", „Interessant — ein Pale Ale!").
Die grosse Brauerei-Animation ist Rogers nächster Wunsch und kommt als
eigene Stufe danach; die Websearch-Anreicherung (SearXNG lokal) ebenfalls.

## Nicht anfassen

- Die `ki.bierexpert.de`-Route und den nginx-Wächter davor (bleibt als
  externer Zugang bestehen).
- Mail/MX-Einträge (zeigen auf Hostpoint, davon lebt die Mailadresse).
- Die Hostpoint-Seite selbst, bis Phase B abgenommen ist.
