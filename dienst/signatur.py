#!/usr/bin/env python3
"""
Die Farbsignatur eines Etiketts — ein billiges Vorsieb für die Suche.

Wozu, wenn es doch registrieren.py gibt: Der Merkmalsvergleich dort ist das
verlässliche Urteil, aber er kostet rund 30 ms JE BIER. Bei zehn Bieren ist
das egal, bei dreihundert ist es eine Wartezeit. Diese Signatur kostet
einmal ein paar Millisekunden, liegt danach als Zahlenreihe in der
Datenbank und lässt sich in Mikrosekunden gegen alle vergleichen. Sie
entscheidet nichts — sie engt auf eine Handvoll Kandidaten ein, die dann
teuer und richtig geprüft werden.

Gegen den Einwand, der in registrieren.py steht — Farben kippen bei anderem
Licht, und der Hintergrund geht voll in die Rechnung ein — ist sie eigens
gebaut:

* **Farbton und Sättigung, nicht Helligkeit.** Anderes Licht verschiebt vor
  allem die Helligkeit; ein grünes Etikett bleibt grün, ob im Sonnenlicht
  oder in der Küche. Der V-Kanal fliegt deshalb ganz aus der Rechnung.
* **Nach Sättigung gewichtet.** Eine Tischplatte, eine weisse Wand, ein
  grauer Schatten sind farbarm und zählen fast nichts. Die kräftigen Farben
  des Etiketts bestimmen die Signatur.
* **Sie ist nur die erste von drei Stufen.** Ein Vorsieb darf irren, solange
  es grosszügig irrt: Es muss das richtige Bier unter den Kandidaten
  halten, nicht als einziges benennen.

Aufruf:  signatur.py <bild>
Ausgabe: {"ok": true, "signatur": [48 Zahlen], "farben": ["#1e6b3a", …], "ms": 7}
         {"ok": false, "grund": "…"}
"""
import json
import sys
import time

try:
    import cv2
    import numpy as np
except ImportError:
    # Wie im Schwesterskript: kein Ausfall, sondern ein sauberes Nein. Der
    # Aufrufer sucht dann eben ohne Vorsieb weiter.
    print(json.dumps({"ok": False, "grund": "opencv fehlt"}))
    sys.exit(0)

# 12 Farbtöne mal 4 Sättigungsstufen. Feiner aufzulösen klingt genauer, ist
# es aber nicht: Je schmaler die Fächer, desto eher fällt derselbe Farbton
# bei leicht anderem Weissabgleich in den Nachbarfach — und dann ähneln sich
# zwei Aufnahmen derselben Flasche plötzlich weniger als zwei fremde.
TOENE = 12
STUFEN = 4

# Die lange Kante, auf die vor der Rechnung verkleinert wird. Mehr Pixel
# ändern das Ergebnis nicht nennenswert und kosten nur Zeit.
KANTE = 240


def signatur(bild):
    """Das nach Sättigung gewichtete Farbton-Histogramm, auf Summe 1 gebracht."""
    hsv = cv2.cvtColor(bild, cv2.COLOR_BGR2HSV)
    h = hsv[:, :, 0].astype(np.float32) * (360.0 / 180.0)  # OpenCV zählt 0..179
    s = hsv[:, :, 1].astype(np.float32) / 255.0
    v = hsv[:, :, 2].astype(np.float32) / 255.0

    # Sehr dunkle Stellen haben keinen verlässlichen Farbton mehr: Im
    # Schwarzen rauscht H, und das Rauschen landete sonst als Farbe im
    # Histogramm.
    brauchbar = v > 0.12

    ton = np.clip((h / 360.0 * TOENE).astype(np.int32), 0, TOENE - 1)
    stufe = np.clip((s * STUFEN).astype(np.int32), 0, STUFEN - 1)
    fach = ton * STUFEN + stufe

    # Das Gewicht ist die Sättigung selbst: Farbarmes zählt wenig, Kräftiges
    # viel. Genau so fällt der Hintergrund aus der Rechnung, ohne dass man
    # ihn suchen müsste.
    gewicht = np.where(brauchbar, s, 0.0)

    hist = np.bincount(fach.ravel(), weights=gewicht.ravel(), minlength=TOENE * STUFEN)
    summe = hist.sum()

    if summe <= 0:
        # Ein Bild ganz ohne Farbe. Nichts, woran sich etwas erkennen liesse.
        return None

    return (hist / summe).astype(np.float32)


def leitfarben(bild, wie_viele=3):
    """Die kräftigsten Farben als Hexwerte — für die Rückfrage an den Leser."""
    klein = cv2.resize(bild, (64, 64), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(klein, cv2.COLOR_BGR2HSV)
    kraeftig = klein[(hsv[:, :, 1] > 60) & (hsv[:, :, 2] > 40)]

    if len(kraeftig) < wie_viele:
        return []

    daten = np.float32(kraeftig.reshape(-1, 3))
    kriterium = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    _, marken, mitten = cv2.kmeans(
        daten, wie_viele, None, kriterium, 3, cv2.KMEANS_PP_CENTERS
    )

    # Nach Häufigkeit, damit die wichtigste Farbe vorn steht.
    haeufig = np.bincount(marken.ravel(), minlength=wie_viele)
    reihe = np.argsort(-haeufig)

    return ["#%02x%02x%02x" % (int(m[2]), int(m[1]), int(m[0])) for m in mitten[reihe]]


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "grund": "falscher Aufruf"}))
        return

    begonnen = time.perf_counter()
    bild = cv2.imread(sys.argv[1], cv2.IMREAD_COLOR)

    if bild is None:
        print(json.dumps({"ok": False, "grund": "Bild unlesbar"}))
        return

    hoehe, breite = bild.shape[:2]
    faktor = KANTE / max(hoehe, breite)
    if faktor < 1:
        bild = cv2.resize(bild, (int(breite * faktor), int(hoehe * faktor)),
                          interpolation=cv2.INTER_AREA)

    werte = signatur(bild)

    if werte is None:
        print(json.dumps({"ok": False, "grund": "keine verwertbare Farbe"}))
        return

    print(json.dumps({
        "ok": True,
        # Drei Nachkommastellen genügen und halten die Zeile in der Datenbank
        # kurz: Der Vergleich entscheidet ohnehin nichts allein.
        "signatur": [round(float(x), 4) for x in werte],
        "farben": leitfarben(bild),
        "ms": int((time.perf_counter() - begonnen) * 1000),
    }))


if __name__ == "__main__":
    main()
