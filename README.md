# Bier Expert

Eine einfache statische Website rund um Bier – Wissen, Sorten und Genuss.

## Inhalt

| Datei        | Beschreibung                                          |
| ------------ | ----------------------------------------------------- |
| `index.html` | Startseite mit Willkommenstext und Themenübersicht     |

## Lokal ansehen

Die Seite ist reines HTML/CSS – kein Build-Schritt, keine Abhängigkeiten.

Direkt im Browser öffnen:

```bash
xdg-open index.html   # Linux
open index.html       # macOS
start index.html      # Windows
```

Oder über einen lokalen Webserver (empfohlen, sobald mehrere Seiten dazukommen):

```bash
python3 -m http.server 8000
# danach http://localhost:8000 aufrufen
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
