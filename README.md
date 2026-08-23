# Bier Expert

Lade das Foto einer Bierflasche hoch und erhalte die Entstehungsgeschichte des
Bieres — dargeboten als Chronik im Klosterstil.

Reiner Frontend-Code, keine Datenbank, kein Server.

## Wie es funktioniert

1. Du legst ein Bild einer Bierflasche, Dose oder eines Etiketts ab
   (Klicken, Drag & Drop oder Einfügen mit `Strg+V`).
2. Der Browser skaliert es auf max. 1568 px Kantenlänge herunter und schickt es
   direkt an die Anthropic Messages API (Modell `claude-opus-5`, Vision).
3. Die Antwort kommt als strukturiertes JSON zurück — per `output_config.format`
   gegen ein Zod-Schema erzwungen — und wird als Chronik gerendert:
   Eckdaten-Tafel, Entstehungsgeschichte mit illuminierter Initiale,
   Kloster- und Brauhaustradition, Merkwürdigkeiten.

## Sprachwahl

**TypeScript.** Die Vorgabe „reiner Frontend-Code, keine Datenbank" schließt
alles Serverseitige aus, es bleibt also die Browser-Plattform. TypeScript statt
JavaScript, weil die Antwort des Sprachmodells eine feste Struktur hat: das
Zod-Schema in `src/schema.ts` beschreibt sie einmal, und daraus fällt sowohl die
Laufzeit-Validierung als auch der statische Typ `Chronik` ab. Ein vergessenes
Feld beim Rendern fällt damit schon im `tsc`-Lauf auf, nicht erst im Browser.

## Der API-Schlüssel — bitte lesen

Ohne Server gibt es keinen Ort, an dem ein Schlüssel sicher liegen könnte. Diese
Seite fragt ihn deshalb im Browser ab und legt ihn im `localStorage` ab; der
Aufruf geht direkt vom Browser an Anthropic (`dangerouslyAllowBrowser`).

**Das ist für den lokalen, persönlichen Gebrauch gedacht.** Wer diese Seite
öffentlich hostet und einen Schlüssel einträgt, gibt ihn preis — jeder Besucher
kann ihn aus dem Browser auslesen und auf fremde Rechnung nutzen. Soll die Seite
ins Netz, braucht es einen kleinen Proxy, der den Schlüssel serverseitig hält.

Der Schlüssel steht **nirgends im Repository** und gehört auch nicht hinein.
Einen bekommst du unter [console.anthropic.com](https://console.anthropic.com/settings/keys).

## Lokal starten

Voraussetzung: Node.js 20 oder neuer (entwickelt mit Node 22).

```bash
npm install
npm run dev     # http://localhost:5173
```

Dann in der Seite die **Schlüsselkammer** aufklappen, Schlüssel eintragen,
verwahren — und ein Bild hochladen.

## Skripte

| Befehl              | Wirkung                                            |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Dev-Server mit Live-Reload auf Port 5173            |
| `npm run build`     | Type-Check und Produktions-Build nach `dist/`       |
| `npm run preview`   | Serviert den Build auf Port 4173                    |
| `npm run typecheck` | Nur der Type-Check, ohne Build                      |

## Aufbau

| Datei             | Aufgabe                                                        |
| ----------------- | -------------------------------------------------------------- |
| `index.html`      | Struktur der Seite                                             |
| `src/style.css`   | Klosterstil: Pergament, Eisengallustinte, Rubrizierung, Gold    |
| `src/main.ts`     | Verdrahtung: Upload, Zustände, Rendern der Chronik              |
| `src/bild.ts`     | Bild einlesen, herunterskalieren, als Base64 aufbereiten        |
| `src/chronik.ts`  | Der Anthropic-Aufruf samt Fehlerübersetzung                     |
| `src/schema.ts`   | Zod-Schema der Chronik — Laufzeitprüfung und Typ in einem       |

## Zum Design

Der Klosterstil ist kein Dekor über einem generischen Layout, sondern trägt die
Struktur: Der Kopf steht unter einem echten gotischen Spitzbogen aus zwei
Kreisbögen, die Ablagefläche wiederholt ihn gestrichelt. Die Kapitel sind
rubriziert nummeriert wie in einer Handschrift, die Entstehungsgeschichte
beginnt mit einer illuminierten Initiale in Fraktur auf Blattgoldgrund.

Schriften: *UnifrakturMaguntia* für den Titel, *Cinzel* (römische Kapitalis) für
Überschriften und Tasten, *EB Garamond* für den Fließtext — mit Serifen-Fallbacks,
falls Google Fonts nicht erreichbar ist.

## Grenzen

- Die Chronik kann irren. Das Modell erkennt Etiketten gut, aber nicht
  unfehlbar; das Feld „Zuordnung" zeigt an, wie sicher es sich ist, und die
  Anmerkung des Chronisten benennt offene Unsicherheiten. Prüfe Angaben am Etikett.
- Beim Build meldet Vite, dass `node:fs` und `node:path` „externalized for
  browser compatibility" wurden. Das betrifft den Credential-Chain-Code des
  Anthropic-SDK, den diese Seite nicht nutzt — der Schlüssel wird explizit
  übergeben. Die Warnung ist folgenlos.
