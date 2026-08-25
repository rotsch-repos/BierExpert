# Betrieb auf der eigenen Workstation

Was hier liegt, macht aus `roger-HP-Z6-G5-A` den Server für bierexpert.de.
Der Auftrag und seine Begründung stehen in [AUFTRAG.md](AUFTRAG.md); diese
Datei beschreibt, was tatsächlich eingerichtet ist und wie man es bedient.

## Warum überhaupt

Eine Etikettauswertung ist eine lange, blockierende Anfrage: erst das kleine
Modell zum Ablesen, dann das grosse zur Zerlegung. Warm sind das 15–25
Sekunden, kalt deutlich mehr — die GPU dieser Maschine ist umkämpft, und ein
verdrängtes Modell braucht 60–90 Sekunden allein zum Aufwärmen.

Auf dem alten Weg (Browser → Cloudflare → Hostpoint-PHP → Tunnel → Ollama)
kappte Hostpoint PHP-Anfragen nach rund 27 Sekunden mit einem 502. Weder
`set_time_limit(0)` im Code noch die Zeitgrenze in der Konfiguration kamen
dagegen an: Die Grenze sass ausserhalb von PHP und war auf geteiltem Hosting
nicht zu erreichen.

Hier gehört uns jede Ebene. Die Grenzen stehen an drei Stellen, und alle drei
sind bewusst weit:

| Ebene | Einstellung | Wo |
|---|---|---|
| FPM-Pool | `request_terminate_timeout = 0` | `php-fpm-pool.conf` |
| nginx | `fastcgi_read_timeout 600s` | `nginx-bierexpert.conf` |
| Anwendung | `zeitgrenze` 600 / `zeitgrenze_schnell` 180 | `~/.bierexpert/konfiguration.php` |

## Der Aufbau

```
Browser → Cloudflare → cloudflared (Tunnel) → nginx :8300 → PHP-FPM (als roger)
                                                   ↓              ↓
                                          /srv/bierexpert/    localhost:11434
                                              aktuell/          (Ollama)
                                                                  ↓
                                                          MariaDB (localhost)
```

`nginx` lauscht nur auf `127.0.0.1:8300`. Öffentlich macht die Seite allein
der Tunnel — ein Lauschen auf allen Adressen wäre eine zweite, ungewollte
Tür ins Netz.

### Verzeichnisse

```
/srv/bierexpert/
├── repo/              Klon von main; hier wird gebaut
├── releases/<sha>/    ein Verzeichnis je ausgelieferter Stand
└── aktuell -> releases/<sha>     der Symlink, auf den nginx zeigt
```

Nicht im Heimatverzeichnis, weil `/home/roger` `drwxr-x---` ist — dort käme
der nginx-Arbeitsprozess (`www-data`) nicht an die statischen Dateien heran.

### Wer läuft als wem

* nginx-Arbeiter: `www-data` — liest die statischen Dateien unter `/srv`.
* PHP-FPM-Pool `bierexpert`: **`roger`** — weil die Anwendung ihre
  Konfiguration im Heimatverzeichnis des ausführenden Benutzers sucht. Als
  `www-data` landete die Suche bei `/var/www/.bierexpert/`.
* Der Socket dazwischen gehört `www-data` mit Modus `0660`: nginx darf
  hineinsprechen, sonst niemand.

## Einrichten

```sh
./deploy/lokal/einrichten.sh --zeigen     # erst ansehen, was passieren würde
./deploy/lokal/einrichten.sh              # alle Schritte
./deploy/lokal/einrichten.sh php nginx    # nur einzelne
```

Jeder Schritt ist idempotent und prüft zuerst, ob er schon getan ist. Ein
zweiter Lauf verändert nichts und ist die einfachste Art nachzusehen, ob noch
alles steht. Die `sudo`-Aufrufe stehen einzeln in den Schritten, nicht um das
ganze Skript herum.

Schritte: `pakete`, `verzeichnisse`, `datenbank`, `konfiguration`, `php`,
`nginx`, `systemd`.

Nach einer Änderung an einer der Vorlagen (`nginx-bierexpert.conf`,
`php-fpm-pool.conf`, den beiden systemd-Dateien) muss `einrichten.sh` erneut
laufen — die Auslieferung fasst Systemdateien nicht an.

## Migrationen

```sh
./deploy/lokal/migrationen.sh              # einspielen
PROBELAUF=ja ./deploy/lokal/migrationen.sh # nur zeigen, was offen ist
```

Dasselbe Muster wie `deploy/migrationen.sh`, nur ohne SSH. Die Zugangsdaten
kommen aus `~/.bierexpert/konfiguration.php` — dem einen Ort, an dem sie
stehen. Angewandtes steht in `schema_migrationen`; ein zweiter Lauf
überspringt es.

## Ausliefern

```sh
./deploy/lokal/ausliefern.sh          # von Hand
systemctl start bierexpert-ausliefern # dasselbe über systemd
journalctl -u bierexpert-ausliefern -n 50
systemctl list-timers bierexpert-ausliefern
```

Der Timer sieht alle fünf Minuten nach. Ist auf `main` nichts Neues, endet
der Lauf nach dem `git fetch`. Sonst: `npm ci`, Typprüfung, Browser-Tests
(sofern ein Playwright-Browser vorhanden ist), Build, Ablage unter
`releases/<sha>`, dann die Umschaltung.

Umgeschaltet wird mit `ln -sfn` daneben und `mv -T` darüber, nicht mit
`ln -sfn` direkt: Letzteres entfernt erst und legt dann neu an, und in dem
Augenblick dazwischen zeigt der Zeiger ins Leere. `mv -T` ist ein `rename()`
und damit unteilbar.

**Rückfall auf einen früheren Stand** — kein Build, kein Netz, ein Befehl:

```sh
ls -1t /srv/bierexpert/releases           # welche Stände liegen da
ln -sfn /srv/bierexpert/releases/<sha> /srv/bierexpert/aktuell.neu
mv -Tf /srv/bierexpert/aktuell.neu /srv/bierexpert/aktuell
```

Der nächste Timer-Lauf holt allerdings wieder den Stand von `main`. Für einen
Rückfall, der halten soll, gehört der Timer angehalten:
`sudo systemctl stop bierexpert-ausliefern.timer`.

## Nachsehen, ob es steht

```sh
curl -s localhost:8300/api/gesundheit.php | python3 -m json.tool
```

Sagt in einer Antwort, ob PHP, Datenbank und Modell stehen. `bereit: true`
heisst: Eine Auswertung käme durch.

Protokolle:

```sh
tail -f /var/log/bierexpert/nginx-fehler.log
tail -f /var/log/bierexpert/fpm-fehler.log
tail -f /var/log/bierexpert/fpm-langsam.log   # Anfragen über 30 s
```

Alles unter `/var/log/bierexpert/`, und das Verzeichnis gehört `roger`. Das
ist kein Ordnungssinn: Der FPM-Arbeiter läuft als `roger` und kann in
`/var/log` selbst keine Datei anlegen. Ohne eigenes Verzeichnis fällt PHP
still auf stderr zurück, und seine Meldungen tauchen im nginx-Protokoll auf
statt dort, wo man sie sucht.

Das Langsam-Protokoll bricht nichts ab — es schreibt nur mit, wo eine
Anfrage stand. Damit sieht man kalte Modelle, statt sie zu erraten.

## Was hier nicht angefasst wird

* Der vhost `ki-api` und die Route `ki.bierexpert.de` — der bleibt als
  externer Zugang bestehen.
* Die MX-Einträge: Sie zeigen auf Hostpoint, davon lebt die Mailadresse.
