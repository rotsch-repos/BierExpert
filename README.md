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

Ein Feld „Zuordnung" zeigt an, wie sicher sich das Modell ist; gedeutete statt
gewusste Elemente werden offen als solche benannt.

## Wie es funktioniert

1. Bild ablegen (Klick, Drag & Drop, `Strg+V`) oder auf dem Handy per
   **Foto aufnehmen** direkt die Kamera öffnen.
2. Der Browser skaliert auf max. 1568 px Kantenlänge herunter und schickt das
   Bild an die Anthropic Messages API (`claude-opus-5`, Vision).
3. Die Antwort kommt als strukturiertes JSON zurück — per `output_config.format`
   gegen ein Zod-Schema erzwungen — und wird gerendert.

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

## Skripte

| Befehl              | Wirkung                                       |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Dev-Server mit Live-Reload auf Port 5173       |
| `npm run build`     | Type-Check und Produktions-Build nach `dist/`  |
| `npm run preview`   | Serviert den Build auf Port 4173               |
| `npm run typecheck` | Nur der Type-Check, ohne Build                 |

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
| `public/logo.svg`  | Logo (derzeit Platzhalter, siehe oben)                         |

## Grenzen

- Deutungen können irren. Heraldik ist mehrdeutig, und das Modell erkennt
  Etiketten gut, aber nicht unfehlbar. Im Zweifel bei der Brauerei nachfragen.
- Beim Build meldet Vite, dass `node:fs` und `node:path` „externalized for
  browser compatibility" wurden. Das betrifft den Credential-Chain-Code des
  Anthropic-SDK, den diese Seite nicht nutzt — der Schlüssel wird explizit
  übergeben. Die Warnung ist folgenlos.
