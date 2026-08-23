# Bier Expert

Fotografier ein Bieretikett — und erfahre, was jedes einzelne Element darauf
bedeutet. Wappen, Tiere, Kronen, Jahreszahlen, Bänder: fast nichts davon ist
Dekoration. Danach hast du in der Bierrunde etwas zu erzählen.

Reiner Frontend-Code, keine Datenbank, kein Server.

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
   Bild an die Anthropic Messages API (`claude-opus-5`, Vision).
3. Die Antwort kommt als strukturiertes JSON zurück — per `output_config.format`
   gegen ein Zod-Schema erzwungen — und wird gerendert.

Der Aufruf läuft **gestreamt** (`messages.stream()` statt `messages.parse()`).
Das ist keine Stilfrage: Bei `max_tokens: 32000` lehnt das SDK einen
nicht-gestreamten Aufruf ab, weil die daraus errechnete Zeitgrenze über den
erlaubten zehn Minuten läge. `finalMessage()` läuft durch denselben Parser und
liefert `parsed_output` genauso.

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

## Der API-Schlüssel — bitte lesen

Ohne Server gibt es keinen Ort, an dem ein Schlüssel sicher liegen könnte. Die
Seite fragt ihn im Browser ab und legt ihn im `localStorage` ab; der Aufruf geht
direkt an Anthropic (`dangerouslyAllowBrowser`).

**Das ist für den lokalen, persönlichen Gebrauch gedacht.** Wer diese Seite
öffentlich hostet und einen Schlüssel einträgt, gibt ihn preis — jeder Besucher
kann ihn auslesen und auf fremde Rechnung nutzen. Soll die Seite ins Netz,
braucht es einen kleinen Proxy, der den Schlüssel serverseitig hält.

Der Schlüssel steht **nirgends im Repository** und gehört auch nicht hinein.
Einen bekommst du unter [console.anthropic.com](https://console.anthropic.com/settings/keys).

## Lokal starten

Voraussetzung: Node.js 20 oder neuer (entwickelt mit Node 22).

```bash
npm install
npm run dev     # http://localhost:5173
```

Dann die **Schlüsselkammer** aufklappen, Schlüssel eintragen, verwahren — und
ein Etikett fotografieren.

## Pipeline und Auslieferung

| Workflow                  | Wann                              | Was                                                        |
| ------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `.github/workflows/ci.yml`| Jeder Push, jeder Pull Request    | Typprüfung, Build, 24 Playwright-Tests auf Desktop und Mobil |
| `deploy.yml`              | Push auf `main`, oder von Hand    | Ruft die CI auf und liefert danach per SSH aus              |
| `zuruecksetzen.yml`       | Nur von Hand                      | Setzt auf einen früheren Stand zurück                       |

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
geprüft werden soll, was ausgeliefert wird. Die Anthropic-Aufrufe werden aus
Testdaten in `tests/fixtures/` beantwortet und Google Fonts abgefangen — kein
Test hängt am Netz.

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
| `src/etikett.ts`   | Der Anthropic-Aufruf samt Fehlerübersetzung                    |
| `src/schema.ts`    | Zod-Schema — Laufzeitprüfung und Typ in einem                  |
| `src/glossar.ts`   | Die Sortendaten des Bierglossars                               |
| `src/glas.ts`      | Zeichnet ein Bierglas als SVG: Form, Farbe, Schaumkrone        |
| `public/logo.svg`  | Logo (derzeit Platzhalter, siehe oben)                         |
| `public/.htaccess` | Apache-Regeln: Cache, HTTPS-Umleitung, Komprimierung           |
| `deploy/`          | Auslieferung und Rückfall, samt Anleitung                      |
| `tests/`           | Playwright-Tests und ihre Testdaten                            |

## Offene Punkte

Zwei Dinge, die die Seite in ihrer heutigen Form noch nicht kann und die
zusammengehören, weil beide serverseitigen Code brauchen:

1. **Der API-Schlüssel liegt im Browser.** Solange die Seite nur lokal läuft,
   ist das vertretbar. Öffentlich ausgeliefert ist es das nicht — jeder
   Besucher kann ihn auslesen. Die Auswertung muss auf den Server wandern.
2. **Das Sprachmodell soll lokal laufen**, nicht über die Anthropic-API. Der
   Aufruf in `src/etikett.ts` nutzt derzeit das Anthropic-SDK und muss auf den
   eigenen Endpunkt umgestellt werden. Zu klären ist dabei, was der lokale
   Dienst bei zwei Punkten anbietet, an denen die heutige Lösung hängt:
   Bildverstehen und erzwungene JSON-Struktur nach einem Schema.
3. **Die MySQL-Datenbank ist angelegt, aber nicht angebunden.** Wozu sie dienen
   soll — Auswertungen aufheben, ein eigenes Glossar pflegen, Nutzerkonten —
   entscheidet, wie das Schema aussieht.

Auf dem Hostwebspace steht dafür PHP zur Verfügung; ein dauerhaft laufender
Node-Prozess ist auf geteiltem Hosting üblicherweise nicht vorgesehen.

## Grenzen

- Deutungen können irren. Heraldik ist mehrdeutig, und das Modell erkennt
  Etiketten gut, aber nicht unfehlbar. Im Zweifel bei der Brauerei nachfragen.
- Beim Build meldet Vite, dass `node:fs` und `node:path` „externalized for
  browser compatibility" wurden. Das betrifft den Credential-Chain-Code des
  Anthropic-SDK, den diese Seite nicht nutzt — der Schlüssel wird explizit
  übergeben. Die Warnung ist folgenlos.
