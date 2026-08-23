# Bier Expert

Eine einfache statische Website rund um Bier – Wissen, Sorten und Genuss.

## Inhalt

| Datei          | Beschreibung                                       |
| -------------- | -------------------------------------------------- |
| `index.html`   | Startseite mit Willkommenstext und Themenübersicht |
| `package.json` | npm-Skripte und Dev-Abhängigkeiten (Vite)          |

## Lokal ansehen

Voraussetzung: Node.js 20 oder neuer (getestet mit Node 22).

```bash
npm install     # einmalig, installiert die Dev-Abhängigkeiten
npm run dev     # startet den Dev-Server auf http://localhost:5173
```

`npm run dev` startet Vite mit Live-Reload: Änderungen an `index.html` sind
sofort im Browser sichtbar, ohne manuelles Neuladen.

## Build

```bash
npm run build     # erzeugt die auslieferbaren Dateien in dist/
npm run preview   # serviert den Build lokal auf http://localhost:4173
```

`dist/` ist das Verzeichnis, das auf einen Webserver oder GitHub Pages
hochgeladen wird. Es wird bei jedem Build neu erzeugt und ist deshalb
nicht eingecheckt.

Ohne Node geht es zur Not auch ohne Build – `index.html` ist reines
HTML/CSS und lässt sich direkt im Browser öffnen:

```bash
xdg-open index.html   # Linux
open index.html       # macOS
start index.html      # Windows
```

## Geplante Themen

- Biersorten und ihre Merkmale
- Zutaten: Malz, Hopfen, Hefe und Wasser
- Der Brauprozess einfach erklärt
- Verkostung und Bewertung
- Bier und Speisen kombinieren

## Entwicklung

- Änderungen werden auf Feature-Branches entwickelt und per Pull Request zusammengeführt.
- Das Styling liegt aktuell als `<style>`-Block in `index.html`, damit die Seite
  ohne weitere Dateien funktioniert. Sobald weitere Seiten dazukommen, lohnt sich
  eine ausgelagerte `styles.css`.
