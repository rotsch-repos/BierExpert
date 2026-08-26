# Bier Expert

Fotografier ein Bieretikett — und erfahre, was jedes einzelne Element darauf
bedeutet. Wappen, Tiere, Kronen, Jahreszahlen, Bänder: fast nichts davon ist
Dekoration. Danach hast du in der Bierrunde etwas zu erzählen.

TypeScript im Browser, PHP auf dem Server, ein Sprachmodell auf eigener
Hardware. Was einmal über ein Bier herausgefunden wurde, bleibt in einer
MariaDB stehen — die Anwendung wird mit jedem Scan schneller.

## Was die Auswertung liefert

Keine Erzählung über das Bier, sondern eine **Zerlegung des Etiketts**:

1. **Eckdaten** — Brauerei, Ort, Gründungsjahr, Stil, Stammwürze, Alkohol
2. **Die Elemente**, einzeln aufgeschlüsselt — zu jedem Wappen, Tier, Symbol,
   Band oder Siegel: wo es sitzt, was zu sehen ist, wofür es steht und worauf
   es zurückgeht. Links der Text, rechts das eigene Foto mit der Fundstelle
   markiert: das Modell liefert zu jedem Element einen Bildbereich, alles
   außerhalb wird abgedunkelt.
3. **Farbwahl und Schriftbild** — was die Gestaltung signalisiert
4. **Geschichtlicher Hintergrund** von Brauerei und Etikett
5. **Für die Runde** — drei bis fünf Sätze, die am Tisch tatsächlich überraschen

Dazu vier weitere Reiter mit der erweiterten Sicht auf das Bier:

| Reiter         | Inhalt                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| **Brauart**    | Verfahren, Zutaten mit ihrer jeweiligen Rolle, Gärführung                  |
| **Speisen**    | Der Grundsatz dahinter, konkrete Gerichte mit Begründung, und was nicht passt |
| **Verkostung** | Beste Trinktemperatur mit Begründung, Glas, Einschenken, Schritt für Schritt |
| **Verwandte**  | Ähnlich gebraute Biere — je mit Ähnlichkeit *und* Unterschied              |

Ein Feld „Zuordnung" zeigt an, wie sicher sich das Modell ist; gedeutete statt
gewusste Elemente werden offen als solche benannt.

## Wie es funktioniert

1. Bild hineingeben — auf vier Wegen:
   - Klicken und Datei auswählen
   - Drag & Drop auf die Ablagefläche
   - **`Strg+V`** direkt auf der Seite
   - Schaltfläche **Aus Zwischenablage**
   Auf dem Handy öffnet **Foto aufnehmen** direkt die Kamera.
2. Der Browser skaliert auf max. 1568 px Kantenlänge herunter und schickt das
   Bild an die eigene API: `POST /api/etikett.php`.
3. Das PHP-Backend fragt Ollama auf dem eigenen Rechner. Die Antwort kommt als
   strukturiertes JSON zurück — Ollama übersetzt das mitgeschickte Schema in
   eine Grammatik, die die Ausgabe erzwingt.
4. Der Browser prüft die Antwort noch einmal gegen das Zod-Schema und rendert.

Zwei Aufrufe nacheinander: `etikett.php` für die Zerlegung, danach
`erweitert.php` für die vier Reiter. Scheitert der zweite, steht die Zerlegung
trotzdem — die Reiter bleiben dann eben leer.

Nacheinander und nicht nebeneinander, obwohl parallel auf den ersten Blick
schneller klingt. Am anderen Ende läuft ohnehin nur eine Auswertung zur Zeit
(gemessen: zwei parallele Aufrufe brauchen exakt doppelt so lang wie einer),
nebeneinander gestartet warten sie also bloß aufeinander. Nacheinander spart
sogar einen ganzen Modellaufruf: Beim zweiten Aufruf weiß der Server schon,
welches Bier auf dem Foto ist — er erkennt es an der Prüfsumme des Bildes im
Scan-Protokoll wieder und muss nicht ein zweites Mal ablesen.

### Warum ein Server dazwischen

Vorher rief der Browser die Anthropic-API direkt auf, mit dem Schlüssel im
Seitenquelltext. Das ging, solange die Seite auf einem Rechner lief. Öffentlich
ausgeliefert hätte jeder Besucher den Schlüssel auslesen können.

Der Server löst drei Dinge auf einmal: Der Zugang zum Modell bleibt beim
Server, das Modell läuft auf eigener Hardware statt gegen Rechnung, und
dazwischen passt ein Zwischenspeicher.

### Zwei Stufen statt einer

Ein Etikett ändert sich über Jahre nicht. Was das Modell einmal darüber
herausgefunden hat, gilt beim nächsten Scan auch — und zwar für jeden, nicht
nur für den, der es zuerst fotografiert hat. Deshalb läuft jeder Scan in zwei
Stufen:

1. **Ablesen** — ein kleines Bildmodell liest Brauerei und Namen vom Etikett.
   Sekunden statt Minuten.
2. **Nachschlagen** in der Datenbank:
   - **Treffer** → die gespeicherte Zerlegung, dazu ein zweiter kleiner Aufruf,
     der die bekannten Elemente in *diesem* Foto wiederfindet.
   - **Fehlschlag** → das grosse Modell zerlegt das ganze Etikett; das Ergebnis
     wird abgelegt.

Der Bildbereich eines Elements wird bewusst **nicht** gespeichert: Dieselbe
Flasche schräg fotografiert hat andere Koordinaten, ein gespeicherter Rahmen
sässe beim nächsten Foto neben dem, worauf er zeigen soll. Die Bedeutung eines
Wappens gilt bierweit, seine Bildposition nicht.

Entscheidend ist dabei ein Detail: Abgelegt wird unter dem Schlüssel, den die
**erste Stufe** abliest — nicht unter dem, was das grosse Modell daraus macht.
Die beiden gehen systematisch auseinander. Auf dem Etikett steht
„TANNEN ZÄPFLE"; das grosse Modell schreibt „Tannenzäpfle Pils" und ergänzt den
Stil aus seinem Wissen. Unter dieser Fassung abgelegt wäre der Eintrag beim
nächsten Foto unauffindbar.

### Wer welche Stufe beantwortet

Die beiden Stufen dürfen an verschiedenen Modellen hängen, und im
Eigenbetrieb tun sie das auch:

| Stufe | Anbieter | Warum dort |
|---|---|---|
| Ablesen | eigenes `qwen3-vl:8b` | läuft bei **jedem** Foto, muss umsonst und schnell sein |
| Zerlegen | Anthropic | läuft **einmal je Bier**, entscheidet dauerhaft, was jeder Leser sieht |

Eingestellt wird das über `llm.anbieter_schnell` und `llm.anbieter_tief`
(Rückfall auf `llm.anbieter`, wenn sie fehlen — bestehende Anlagen ändern ihr
Verhalten also nicht).

Der Gedanke dahinter ist eine Frage der Häufigkeit, nicht der Qualität. Ein
Modell, das ein Etikett gut zerlegt, ist teuer; eines, das „Rothaus" von
„Augustiner" unterscheidet, muss es nicht sein. Weil die erste Aufgabe
einmal je Bier anfällt und die zweite bei jedem einzelnen Scan, wächst die
Rechnung nicht mit der Nutzung, sondern mit der Zahl der noch unbekannten
Biere — und die wird mit jedem Fund kleiner. Am Ende steht ein Kompendium,
das nur noch selten von einem neuen Etikett überrascht wird.

Gemessen am 26.08. auf der Workstation (RTX 6000 Ada, sechs Fotos):

- **Bekanntes Bier:** 3,5–4,1 s für den ganzen Scan, **kein** Aufruf bei
  Anthropic. Beide Stufen laufen lokal.
- **Unbekanntes Bier:** genau ein Aufruf, danach steht es in der Datenbank.

### Die Aufteilung: Seite beim Hoster, Modell und Datenbank zu Hause

Der Betrieb, auf den es hinausläuft:

| Wo | Was |
|---|---|
| Hoster (bierexpert.de) | die Seite, und der Dirigent: `/api/etikett.php` |
| Workstation (Tunnel) | `qwen3-vl:8b`, die Bierdatenbank, die aufbewahrten Fotos |

Für jedes Foto fragt der Hoster zuerst zu Hause an — *kenne ich das Bier?* —
und bemüht die bezahlte API nur bei einem Fehlschlag:

```
Browser -> Hoster /api/etikett.php
              |
              |  POST /api/nachschlagen.php   (Dienstschlüssel)
              +--> Workstation: 8b liest ab -> Datenbank
              |      Treffer  -> Zerlegung + Fotos zurück   ENDE, nichts bezahlt
              |      Fehlschlag -> was gelesen wurde, zurück
              |
              +--> Anthropic zerlegt das Etikett            einmal je Bier
              |
              +--> POST /api/merken.php  -> Workstation legt es ab
```

Eingestellt über `dienst.adresse` und `dienst.schluessel`. Bleibt die
Adresse leer, macht die Anlage alles selbst — so läuft die Workstation, und
so läuft jede Installation, die es einfach halten will. Beide Wege enden in
derselben Antwort.

Warum nicht andersherum, also die Datenbank beim Hoster? Weil das Modell
ohnehin zu Hause steht: Die erste Stufe braucht Bild **und** Datenbank, und
eines von beiden über das Netz zu holen kostet bei **jedem** Scan eine
Rundreise. So bleibt beides beisammen, und über das Netz geht nur, was
am Ende auch angezeigt wird.

`nachschlagen.php` und `merken.php` stehen hinter einem gemeinsamen
Geheimnis (`Authorization: Bearer …`, verglichen mit `hash_equals`). Ohne
das könnte jeder, der die Adresse des Tunnels kennt, die Grafikkarte
beschäftigen und Einträge in die Bierdatenbank schreiben — hinter beidem
hängt Geld.

### Die aufbewahrten Scanfotos

Zu einem bekannten Bier kommen die Fotos mit, die andere davon gemacht
haben. Das kehrt eine frühere Entscheidung um: Die `scans`-Tabelle führte
ausdrücklich keine Bilddaten, weil der Zweck damals Buchführung war.

Was von der Entscheidung bleibt: **Die IP-Adresse wird weiterhin nicht
gespeichert.** Ein Foto einer Bierflasche sagt nichts über den, der es
aufgenommen hat, solange nicht danebensteht, woher es kam.

Aufbewahrt wird nur, wenn `bilder.verzeichnis` gesetzt ist — die Vorgabe
ist leer. Es sind fremde Fotos, und wer sie sammelt, soll das entscheiden
und nicht geschenkt bekommen.

Die Dateien liegen neben der Datenbank, nicht darin: Ein Etikettfoto wiegt
mehrere Megabyte und blähte als BLOB jede Abfrage auf, die es gar nicht
braucht. Der Dateiname ist die Prüfsumme des Bildes — damit liegt dasselbe
Foto nie zweimal auf der Platte, und der Name verrät nichts über seinen
Ursprung. Ausgeliefert werden sie von nginx unter `/bilder/`, nicht durch
PHP: Zwölf Bilder einer Galerie kosteten sonst zwölf Arbeiter aus dem Pool.

### Die Einzeichnungen je Element

Zu jedem Element eines Etiketts liegt ein fertiges Bild in der Datenbank:
das Referenzfoto des Biers mit **genau einem** Rahmen darauf.

Warum fertige Bilder und nicht Koordinaten, die der Browser überlegt: Ein
PNG ist selbsttragend. Es funktioniert in einer Nachricht, in einer Mail,
in einer Linkvorschau und ohne JavaScript — ein Rahmen, den erst der
Browser zeichnet, tut das nicht. Und es liegt am richtigen Ende der
Rechnung: gerendert **einmal je Bier**, ausgeliefert beliebig oft als
statische Datei, die ein CDN übernehmen kann, ohne diesen Server zu fragen.

Der Preis steht in Zahlen: Beim Testetikett wiegt das Foto 47 KB, die fünf
Einzeichnungen zusammen 210 KB — das Fünfeinhalbfache. Bei einem echten
Foto von 1,5 MB und sieben Elementen sind es rund 10 MB je Bier. Das ist
der bewusste Tausch: Platz auf der Platte gegen Rechenarbeit beim Abruf.

Gezeichnet wird mit **ffmpeg** (`drawbox`) und nicht mit GD — auf der
Workstation gibt es weder GD noch Imagick noch ImageMagick. Die Bildmasse
liefert `getimagesize()`, das ohne GD auskommt. Der Prozessstart von ~50 ms
je Bild trifft den einen Scan, der ein Bier neu aufnimmt, und nie wieder.

Im Frontend ersetzen diese Bilder **nicht** die Markierung auf dem eigenen
Foto: Wer gerade eine Flasche fotografiert hat, sieht seinen eigenen Rahmen
auf seinem eigenen Bild, live gezeichnet. Die gespeicherte Einzeichnung
springt nur ein, wenn die Verortung ein Element auf diesem Foto **nicht**
gefunden hat — dann steht darunter „Frühere Aufnahme", damit niemand eine
fremde Flasche für seine eigene hält.

### Kein Nachdenken beim Ablesen

Für die schnelle Stufe wird das Nachdenken des Modells ausdrücklich
abgeschaltet (`think: false`). Das ist keine Feinabstimmung, sondern behebt
einen Ausfall.

Mit eingeschaltetem Denken erzeugte `qwen3-vl:8b` auf schwierigen Fotos bis
zu 6900 Token, **ohne ein einziges davon als Antwort auszugeben**: Es
zerredete sich in „Wait, … Wait, …" bis zur Token-Grenze und lieferte nach
rund 65 Sekunden einen leeren Inhalt. Über sechs Fotos zu je fünf Läufen:

| | Antworten | Median | Schlüssel stabil |
|---|---|---|---|
| Denken an | 21/30 | 2 200 ms | 5 von 6 Fotos |
| Denken aus | **30/30** | **390 ms** | **6 von 6** |

Es ist auf jeder Achse besser, und das liegt in der Aufgabe: Abgeschrieben
werden soll, was auf dem Etikett steht. Dabei gibt es nichts zu überlegen —
jeder Gedankengang ist nur eine Gelegenheit, sich von dem zu entfernen, was
dasteht.

Für die tiefe Stufe bleibt das Denken an: Ein unbekanntes Etikett zu deuten
ist genau die Aufgabe, bei der es beiträgt.

### Der Fortschritts-Strom

`/api/etikett.php` kann seine Antwort zeilenweise schicken (NDJSON, ein
JSON-Objekt je Zeile), statt am Ende alles auf einmal. Verlangt wird das
über den Accept-Kopf `application/x-ndjson`; ohne ihn antwortet der
Endpunkt unverändert wie bisher. Das ist kein Zaudern: Auf Hostpoint wird
die Anfrage ohnehin nach einer halben Minute gekappt, dort hilft ein Strom
nichts und ein Bruch schadete.

Der Anlass ist eine fremde Zeitgrenze. Cloudflare bricht eine Verbindung
ab, wenn 100 Sekunden lang **kein Byte** fliesst — gezählt bis zum ersten
Byte, danach zwischen den Bytes. Ein kalter Scan liegt darüber, und auf
dieser Maschine ist kalt der Normalfall, weil sich mehrere Modelle die
Karte teilen.

Die Zeilen:

| Zeile | Wann | Was drinsteht |
|---|---|---|
| `laden` | sofort | das erste Byte, mehr nicht |
| `erkennung` | vor dem Ablesen | — |
| `erkannt` | nach ~0,4 s | `brauerei`, `name`, `sicherheit` |
| `gefunden` | bei einem Treffer | zusätzlich `stil` aus der Datenbank |
| `verorten` | bei einem Treffer | wie viele Elemente gesucht werden |
| `auswertung` | bei einem Fehlschlag | welcher Anbieter das Etikett zerlegt |
| `puls` | alle 5 s | Lebenszeichen, solange ein Modell rechnet |
| `fertig` | am Ende | das vollständige `etikett` |
| `fehler` | statt `fertig` | `fehler` und `rat` |

Der Herzschlag entsteht in curls Fortschrittsfunktion
(`CURLOPT_XFERINFOFUNCTION`). Das ist der einzige Ort, an dem sich während
einer blockierenden Anfrage überhaupt etwas tun lässt: curl ruft sie im
Sekundentakt auf, auch wenn noch kein Byte vom Modell zurückkam — und
genau das ist hier der Regelfall, denn Ollama antwortet erst, wenn es
fertig gerechnet hat.

Ein Fehler nach dem ersten Byte kann keinen Statuscode mehr tragen: Der
steht dann längst auf 200. Er kommt deshalb als letzte Zeile, und der
Leser im Browser richtet sich nach dem Feld `fehler` statt nach
`response.ok`.

Gemessen im Browser gegen das echte Backend (unbekanntes Bier, Modell
absichtlich auf 12 s verlangsamt):

```
0,12 s  Der Braumeister nimmt die Flasche zur Hand …
0,48 s  Ein „DUNKLES DOPPELBOCK" von Kloster Brau
        Ein neues Etikett! Der Kessel wird angeheizt …
5,54 s  … Der Kessel wird angeheizt …
11,56 s … Die Sudpfanne kommt auf Temperatur …
12,88 s Befund steht
```

Der erkannte Name steht in einer **eigenen, bleibenden** Zeile über der
wechselnden. Mit nur einer Zeile ging er unter: Server schickt `erkannt`
und `auswertung` unmittelbar hintereinander, und der Name war nach
wenigen Millisekunden überschrieben — im Browser nachgemessen, bevor es
die zweite Zeile gab.

### Die Fundstellen auf dem Foto

Jedes Element trägt einen `bereich` in normalisierten Koordinaten (0 bis 1,
bezogen auf das ganze Bild). Weil das an die API geschickte Bild dasselbe
herunterskalierte Bild ist wie die Vorschau im DOM, lassen sich die Werte
direkt als Prozent auf das angezeigte Foto legen.

Die Koordinaten sind eine Schätzung des Modells und werden deshalb geprüft,
bevor sie gezeichnet werden (`kastenPruefen` in `src/main.ts`): Werte außerhalb
des Bildes werden hineingeklemmt, und ein Bereich, der danach zu klein ist,
praktisch das ganze Bild umfasst oder keine gültigen Zahlen enthält, führt zu
**keiner** Markierung — eine Markierung an der falschen Stelle wäre schlechter
als gar keine. Das Foto wird in dem Fall abgeblendet dargestellt.

### Einfügen aus der Zwischenablage

Kein Umweg über Speichern und Hochladen. `src/zwischenablage.ts` deckt beide
Wege ab, weil die Zwischenablage je nach Herkunft etwas anderes enthält:

- Die **Schaltfläche** fragt `navigator.clipboard.read()` ab. Braucht eine
  Nutzergeste, teils eine Freigabe, und funktioniert nur über HTTPS oder auf
  localhost — beides wird abgefangen und erklärt.
- **`Strg+V`** wertet das `paste`-Ereignis aus und braucht keine Freigabe.

Beide Wege suchen in dieser Reihenfolge: erst nach einer echten Bilddatei, dann
im mitkopierten HTML nach einem eingebetteten `data:`-Bild (so landet eine Kopie
aus einer Webseite doch noch als Bild), zuletzt nach einer Adresse. Eine
`data:`-Adresse wird eingelöst; bei einer `http(s)`-Adresse wird es versucht,
scheitert aber meist an der Ursprungsprüfung des fremden Servers — ohne Server
auf unserer Seite ist das nicht zu umgehen. Dann sagt die Meldung, dass man das
Bild selbst kopieren muss, nicht den Link darauf.

## Aufbau der Seite

Zwei Sichten, über das Hauptmenü in der Kopfzeile erreichbar:

| Menüpunkt         | Adresse    | Inhalt                              |
| ----------------- | ---------- | ----------------------------------- |
| **Etikett lesen** | `#lesen`   | Foto hineingeben und auswerten      |
| **Bierglossar**   | `#glossar` | Die Sorten und ihre Unterschiede    |

Beides liegt in einem Dokument — es gibt keinen Server, der eine zweite Adresse
ausliefern könnte. Der Hash hält die Sicht dennoch verlinkbar, lässt den
Zurück-Knopf funktionieren und setzt den Seitentitel passend.

Das Kopfbild (`public/klostermauer.svg`) zeigt den Blick aus einem Kreuzgang in
den Innenhof: dunkles Mauerwerk mit Rundbögen, dahinter Fernflügel, Glockenturm
und Kreuzgarten. Gezeichnet statt fotografiert, aus denselben Gründen wie beim
Glossar, und ausschließlich in Palettenfarben. Der Titel steht auf einer eigenen
Fläche statt auf einem Verlauf über dem Bild — ein Verlauf bleichte die Arkade
aus, statt den Text abzusetzen.

## Bierglossar

Ein eigener Abschnitt, unabhängig vom Foto: 19 Sorten in drei Gärungsfamilien
(untergärig, obergärig, spontan & sauer), jede mit Stammwürze, Alkohol, Bittere,
Charakter — und dem Feld **Unterschied**, das sie gegen ihre nächsten Nachbarn
abgrenzt. Filterbar nach Familie.

Die Daten stehen statisch in `src/glossar.ts`; ein API-Aufruf wäre hier falsch,
weil sich Stilgrundlagen nicht von Foto zu Foto ändern.

### Warum gezeichnete Gläser statt Fotos

Fotos echter Markenbiere liegen dem Projekt nicht bei, und fremde Markenfotos
einzubinden wäre rechtlich heikel. Stattdessen zeichnet `src/glas.ts` jede Sorte
im typischen Glas: Glasform, Bierfarbe aus dem EBC-Bereich und Schaumhöhe sind
ohnehin genau die Merkmale, an denen man eine Sorte im Glas erkennt. Sieben
Glasformen (Tulpe, Weizenglas, Stange, Seidel, Kelch, Nonic Pint, Schwenker)
stehen als Baupläne bereit; die Füllung wird per `clipPath` auf den Umriss
beschnitten, damit sie der Glasform folgt. Das bekannte Beispielbier steht
namentlich in der Karte.

Sollen echte Produktfotos hinein, brauchst du die Rechte daran — dann genügt es,
`glasZeichnen` durch ein `<img>` zu ersetzen.

## Sprachwahl

**TypeScript.** Die Vorgabe „reiner Frontend-Code, keine Datenbank" schließt
alles Serverseitige aus, es bleibt die Browser-Plattform. TypeScript statt
JavaScript, weil die Modellantwort eine feste Struktur hat: das Zod-Schema in
`src/schema.ts` beschreibt sie einmal, und daraus fällt sowohl die
Laufzeit-Validierung als auch der statische Typ `Etikett` ab. Ein vergessenes
Feld beim Rendern fällt im `tsc`-Lauf auf, nicht erst im Browser.

## Designsystem — verbindlich

[`DESIGN.md`](./DESIGN.md) ist die **Quelle der Wahrheit**. Jeder Wert daraus
steht in [`src/tokens.css`](./src/tokens.css) als CSS-Custom-Property; das
Komponenten-CSS greift ausschließlich darauf zu.

**Regel:** Keine literale Farbe, kein literaler Radius, kein literaler Abstand
in `src/style.css`. Wird ein Wert gebraucht, den es nicht gibt, gehört er zuerst
nach `DESIGN.md` und `tokens.css`.

Prüfen lässt sich das mit:

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b' src/style.css   # muss leer bleiben
```

Kurzfassung des Systems: cremefarbenes Papier als Untergrund mit 3 % Rauschen,
tonale Ebenen und 1-px-Konturen statt Schlagschatten, EB Garamond für
Überschriften und Hanken Grotesk für Text, 8-px-Rhythmus mit 64 px zwischen
Hauptabschnitten, 4 px Radius für Tasten und 8 px für Karten, dünnstrichige
Icons ohne Füllung.

## Das Logo

`public/logo.svg` ist ein **Platzhalter**. Die Logodatei kam nur inline in der
Unterhaltung an, nicht als Datei — die Nachzeichnung dient nur dazu, das Layout
beurteilen zu können.

Zum Ersetzen: die Datei überschreiben (SVG behält alle Bezüge), oder ein
`logo.png` in `public/` legen und die beiden Verweise in `index.html`
(`<link rel="icon">` und `<img src>`) anpassen.

## Das Backend

Drei Endpunkte, alle unter `public/api/` — Vite kopiert den Ordner unverändert
nach `dist/`, damit geht er mit jedem Deploy mit:

| Endpunkt              | Methode | Was                                                      |
| --------------------- | ------- | -------------------------------------------------------- |
| `/api/etikett.php`    | POST    | Foto hinein, Zerlegung heraus — mit Zwischenspeicher      |
| `/api/erweitert.php`  | POST    | Foto hinein, die vier Reiter heraus                       |
| `/api/gesundheit.php` | GET     | Stehen PHP, Datenbank und Modell?                         |

Anfrage und Antwort sind schlichtes JSON:

```jsonc
// POST /api/etikett.php
{ "bild": "<base64, ohne data:-Vorspann>", "typ": "image/jpeg" }

// 200
{ "etikett": { … }, "quelle": "speicher", "dauer_ms": 340 }

// Fehler, mit passendem Status
{ "fehler": "Das Sprachmodell ist nicht erreichbar.",
  "rat": "Läuft der Rechner, läuft Ollama, steht der Tunnel?" }
```

Der Bausteinordner `public/api/intern/` ist doppelt gesperrt: per `.htaccess`
und dadurch, dass jede Datei darin beim direkten Aufruf abbricht. Eine Sperre,
die von der Serverkonfiguration abhängt, ist keine, auf die man sich allein
verlassen sollte — reicht der Server eine `.php` einmal als Text aus, weil beim
Umstellen der PHP-Version das Modul kurz fehlt, stünde der Quelltext im
Browser.

**`/api/gesundheit.php` ist der erste Griff bei jeder Störung.** Wenn ein Scan
scheitert, gibt es drei Orte, an denen es klemmen kann, und von aussen sehen
alle drei gleich aus. Der Endpunkt beantwortet in einem Aufruf, welcher es ist —
ohne Wirtsnamen und Zugangsdaten preiszugeben.

### Zugangsdaten

Sie liegen in `~/.bierexpert/konfiguration.php` auf dem Server, ausserhalb jedes
Wurzelverzeichnisses. Zwei Gründe: Was im Wurzelverzeichnis liegt, ist im
Zweifel abrufbar — und die Auslieferung räumt es bei jedem Lauf mit
`rsync --delete` leer.

Geschrieben wird die Datei von `deploy/konfiguration.sh` bei jedem Deploy, aus
den Werten in GitHub. Welche das sind, steht in [`.env.example`](./.env.example).
Fehlt das Datenbankpasswort, läuft die Anwendung ohne Zwischenspeicher weiter:
langsamer, aber vollständig. Ein Zwischenspeicher, dessen Ausfall die Anwendung
schliesst, hätte die Abhängigkeit falsch herum.

## Lokal starten

Voraussetzung: Node.js 20 oder neuer (entwickelt mit Node 22).

```bash
npm install
npm run dev     # http://localhost:5173
```

Der Dev-Server liefert nur das Frontend aus; PHP führt er nicht aus. Für die
Endpunkte gibt es zwei Wege:

```bash
# Gegen den ausgelieferten Server entwickeln
echo 'VITE_API_BASIS=https://bierexpert.de/api' > .env.local
# Dafür muss die eigene Adresse dort unter "herkuenfte" eingetragen sein.

# Oder alles lokal, mit eigenem PHP
npm run build
BIEREXPERT_KONFIG=$PWD/.konfiguration.php php -S localhost:8000 -t dist
```

## Pipeline und Auslieferung

| Workflow                  | Wann                              | Was                                                        |
| ------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `.github/workflows/ci.yml`| Jeder Push, jeder Pull Request    | Typprüfung, Build, 24 Playwright-Tests auf Desktop und Mobil |
| `deploy.yml`              | Push auf `main`, oder von Hand    | Ruft die CI auf, schreibt die Konfiguration, liefert per SSH aus |
| `migrationen.yml`         | Nur von Hand                      | Spielt die Datenbank-Migrationen ein                        |
| `zuruecksetzen.yml`       | Nur von Hand                      | Setzt auf einen früheren Stand zurück                       |
| `hostschluessel.yml`      | Nur von Hand                      | Holt den Fingerabdruck des Servers für `SSH_KNOWN_HOSTS`    |
| `diagnose.yml`            | Nur von Hand                      | Misst von einem Runner aus, was von aussen erreichbar ist   |

Das Deploy ruft die CI auf, statt ihre Schritte zu kopieren — zwei Kopien
driften auseinander, eine geprüfte Quelle tut das nicht. Schlägt eine Prüfung
fehl, wird nicht ausgeliefert.

Einrichtung, Ablauf und Rückfall stehen in [`deploy/README.md`](./deploy/README.md).

## Tests

```bash
npm test              # alle Tests
npm run test:ui       # mit Oberfläche zum Nachvollziehen
```

Die Tests fahren gegen den Produktionsbuild, nicht gegen den Dev-Server:
geprüft werden soll, was ausgeliefert wird. Die Aufrufe an `/api/*.php` werden
aus Testdaten in `tests/fixtures/` beantwortet und Google Fonts abgefangen —
kein Test hängt am Netz. Geprüft wird also, was der Browser aus einer Antwort
macht, nicht was das Backend mit Ollama und der Datenbank treibt.

Liegt auf der Maschine schon ein Chromium bereit, das Playwright nicht neu
laden soll:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/pfad/zu/chromium npm test
```

## Skripte

| Befehl              | Wirkung                                       |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Dev-Server mit Live-Reload auf Port 5173       |
| `npm run build`     | Type-Check und Produktions-Build nach `dist/`  |
| `npm run preview`   | Serviert den Build auf Port 4173               |
| `npm run typecheck` | Typprüfung für App und Tests, ohne Build       |
| `npm test`          | Playwright-Tests gegen den Build                |
| `npm run test:ui`   | Dieselben Tests mit Oberfläche                  |

## Aufbau

| Datei              | Aufgabe                                                       |
| ------------------ | ------------------------------------------------------------- |
| `DESIGN.md`        | Das Designsystem — verbindliche Quelle der Wahrheit           |
| `src/tokens.css`   | Alle Token aus DESIGN.md als CSS-Custom-Properties            |
| `src/style.css`    | Komponenten, ausschließlich auf Token aufgebaut               |
| `index.html`       | Struktur der Seite                                            |
| `src/main.ts`      | Verdrahtung: Upload, Kamera, Zustände, Rendern des Befunds     |
| `src/bild.ts`      | Bild einlesen, herunterskalieren, als Base64 aufbereiten       |
| `src/etikett.ts`   | Die Aufrufe an die eigene API samt Fehlerübersetzung            |
| `src/schema.ts`    | Zod-Schema — Laufzeitprüfung und Typ in einem                  |
| `src/glossar.ts`   | Die Sortendaten des Bierglossars                               |
| `src/glas.ts`      | Zeichnet ein Bierglas als SVG: Form, Farbe, Schaumkrone        |
| `public/logo.svg`  | Logo (derzeit Platzhalter, siehe oben)                         |
| `public/.htaccess` | Apache-Regeln: Cache, Komprimierung, keine Verzeichnislisten    |
| `public/api/`      | Das PHP-Backend — Endpunkte oben, Bausteine in `intern/`        |
| `db/migrationen/`  | Das Datenbankschema, eine Datei je Schritt                      |
| `deploy/`          | Auslieferung, Konfiguration, Migrationen, Rückfall              |
| `tests/`           | Playwright-Tests und ihre Testdaten                            |

## Offene Punkte

1. **Das Logo ist ein Platzhalter.** `public/logo.svg` ist nachgezeichnet, nicht
   die Datei aus dem Entwurf.
2. **Das Zertifikat für die Adresse ohne `www`** stand zuletzt bei Hostpoint
   noch auf „Pending". Solange es fehlt, bleibt die Schaltfläche
   **Aus Zwischenablage** ohne Funktion — `navigator.clipboard` verlangt einen
   sicheren Kontext. `Strg+V` funktioniert auch ohne.
3. **Die Migrationen sind noch nie gelaufen.** `migrationen.yml` muss einmal von
   Hand gestartet werden, sonst antwortet `/api/gesundheit.php` mit fehlenden
   Tabellen und jeder Scan geht ans Modell.
4. **Der Zwischenspeicher trifft nur bei gleicher Lesart.** Der Schlüssel ist
   Brauerei und Name, kleingeschrieben, ohne Satzzeichen und ohne Wörter wie
   „GmbH" oder „Brauerei". Liest die erste Stufe beim nächsten Foto etwas
   anderes ab, entsteht ein zweiter Eintrag statt eines Treffers. Das ist die
   sichere Richtung — ein falscher Treffer holte die Geschichte eines anderen
   Bieres, ohne dass irgendwo etwas nach Fehler aussähe. Ob es in der Praxis
   oft genug trifft, zeigt die Tabelle `scans`: Sie hält fest, wie oft aus dem
   Speicher geantwortet wurde und was die erste Stufe jeweils gelesen hat.

## Grenzen

- Deutungen können irren. Heraldik ist mehrdeutig, und das Modell erkennt
  Etiketten gut, aber nicht unfehlbar. Im Zweifel bei der Brauerei nachfragen.
- Ein Scan mit unbekanntem Bier dauert so lange, wie das grosse Modell auf der
  eigenen Hardware braucht — beim allerersten Aufruf zusätzlich die Zeit, das
  Modell in den Speicher zu laden. Der Browser wartet bis zu 5½ Minuten, dann
  bricht er mit einer Meldung ab statt endlos zu drehen.
- Steht vor Ollama ein nginx, muss dort `client_max_body_size` gross genug
  sein: Ein Foto als base64 bringt schnell mehrere Megabyte mit. Der Endpunkt
  übersetzt ein HTTP 413 von dort in genau diesen Hinweis.
