#!/usr/bin/env python3
"""Bildregistrierung: Rahmen vom Referenzfoto auf ein neues Foto abbilden.

Aufruf:
    registrieren.py <referenzfoto> <neues foto> <rahmen.json>

<rahmen.json> ist eine Liste von {"x":…,"y":…,"breite":…,"hoehe":…} in
Anteilen 0..1, bezogen auf das Referenzfoto. Auf der Standardausgabe kommt

    {"getroffen": true, "vertrauen": 0.95, "ms": 24, "bereiche": [ … ]}

zurück; "bereiche" hat dieselbe Länge und Reihenfolge wie die Eingabe.
Einträge, die auf dem neuen Foto ausserhalb des Bildes landen, sind null.

Warum das hier steht und nicht im Modell: Zwei Fotos derselben Flasche
unterscheiden sich nur durch Winkel, Abstand und Licht — also durch eine
Abbildung, die sich aus den Bildern selbst bestimmen lässt. Wer sie kennt,
muss die Elemente nicht ein zweites Mal suchen lassen. Gemessen: 23-42 ms
auf der CPU gegen rund 2500 ms auf der GPU.

Merkmale statt Farben: Ein Vergleich der Farbwerte Punkt für Punkt kippt
schon bei anderem Licht, weil sich dann ALLE Werte verschieben, und der
Hintergrund geht voll in die Rechnung ein. Markante Punkte sind gegen
beides unempfindlich.
"""
import json
import sys
import time

try:
    import cv2
    import numpy as np
except ImportError:
    # Ohne OpenCV kein Ausfall, sondern ein sauberes "nicht getroffen":
    # Der Aufrufer fällt dann auf das Modell zurück, wie er es auch bei
    # einer schlecht passenden Abbildung täte.
    print(json.dumps({"getroffen": False, "grund": "opencv fehlt"}))
    sys.exit(0)

# Ab wann die Abbildung als verlässlich gilt.
#
# Gemessen am 28.08. an vier Fassungen desselben Etiketts: gedreht 0,97,
# beschnitten 0,95 — und im gespiegelten Fall, in dem die Abbildung
# tatsächlich misslang, 0,48. Fremdes Etikett: gar keine Abbildung. Die
# Schwelle trennt die Fälle deutlich; ein Rahmen an falscher Stelle ist
# schlimmer als ein Rückfall aufs Modell.
SCHWELLE = 0.80

# Unter so wenigen bestätigten Zuordnungen ist der Anteil nicht aussagekräftig:
# 4 von 4 sind 100 % und trotzdem nichts wert.
MINDEST_TREFFER = 15


def merkmale(pfad):
    bild = cv2.imread(pfad, cv2.IMREAD_GRAYSCALE)
    if bild is None:
        return None, None, None
    sift = cv2.SIFT_create(nfeatures=3000)
    punkte, beschreibung = sift.detectAndCompute(bild, None)
    return bild, punkte, beschreibung


def abbildung(ref, neu):
    _, p1, b1 = ref
    _, p2, b2 = neu
    if b1 is None or b2 is None or len(b1) < 2 or len(b2) < 2:
        return None, 0.0, 0

    flann = cv2.FlannBasedMatcher({"algorithm": 1, "trees": 5}, {"checks": 50})
    paare = flann.knnMatch(b1, b2, k=2)

    # Lowes Verhältnistest: Eine Zuordnung zählt nur, wenn der beste
    # Kandidat deutlich besser ist als der zweitbeste. Ohne ihn entstehen
    # bei sich wiederholenden Mustern — und Schrift ist ein solches —
    # reihenweise zufällige Paare.
    # Je Paar prüfen, nicht einmal für alle: knnMatch liefert am Rand des
    # Suchraums gelegentlich nur einen Kandidaten, und ein Paar der Länge 1
    # liesse sich nicht entpacken.
    gut = [p[0] for p in paare if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]

    if len(gut) < MINDEST_TREFFER:
        return None, 0.0, len(gut)

    von = np.float32([p1[m.queryIdx].pt for m in gut]).reshape(-1, 1, 2)
    nach = np.float32([p2[m.trainIdx].pt for m in gut]).reshape(-1, 1, 2)

    # RANSAC: Die Mehrheit der Zuordnungen bestimmt die Abbildung, der Rest
    # wird verworfen. Ihr Anteil ist zugleich das Mass dafür, ob es
    # überhaupt dieselbe Flasche ist.
    H, maske = cv2.findHomography(von, nach, cv2.RANSAC, 5.0)
    if H is None or maske is None:
        return None, 0.0, len(gut)

    treffer = int(maske.sum())
    return H, treffer / len(gut), treffer


def rahmen_abbilden(H, rahmen, ref_masse, neu_masse):
    rb, rh = ref_masse
    nb, nh = neu_masse

    x, y = rahmen["x"] * rb, rahmen["y"] * rh
    w, h = rahmen["breite"] * rb, rahmen["hoehe"] * rh

    ecken = np.float32([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]).reshape(-1, 1, 2)
    ab = cv2.perspectiveTransform(ecken, H).reshape(-1, 2)

    x0, y0 = float(ab[:, 0].min()), float(ab[:, 1].min())
    x1, y1 = float(ab[:, 0].max()), float(ab[:, 1].max())

    # Ganz ausserhalb des neuen Fotos heisst: auf dieser Aufnahme nicht zu
    # sehen. Das ist keine Panne, sondern die Antwort — und genau die, die
    # ein Modell an dieser Stelle gern erfindet.
    if x1 <= 0 or y1 <= 0 or x0 >= nb or y0 >= nh:
        return None

    # BEIDE Enden ins Bild klemmen, bevor die Ausdehnung entsteht. Vorher
    # wurde nur der Ursprung geklemmt und die volle Breite behalten: Ein
    # Rahmen, der links hinausragte (x0=-0,2, x1=0,5), kam als
    # {x:0, breite:0,7} zurück statt {x:0, breite:0,5} — und keine Stelle
    # dahinter repariert das, die Markierung überdeckte weit mehr als das
    # Element. Der sichtbare Teil ist der Schnitt mit dem Bild, nichts sonst.
    x0, x1 = max(0.0, x0), min(float(nb), x1)
    y0, y1 = max(0.0, y0), min(float(nh), y1)

    if x1 <= x0 or y1 <= y0:
        return None

    return {
        "x": x0 / nb,
        "y": y0 / nh,
        "breite": (x1 - x0) / nb,
        "hoehe": (y1 - y0) / nh,
    }


def main():
    if len(sys.argv) != 4:
        print(json.dumps({"getroffen": False, "grund": "falscher Aufruf"}))
        return 0

    ref_pfad, neu_pfad, rahmen_pfad = sys.argv[1:4]
    t0 = time.time()

    try:
        with open(rahmen_pfad, encoding="utf-8") as f:
            rahmen = json.load(f)
    except (OSError, ValueError) as fehler:
        print(json.dumps({"getroffen": False, "grund": f"Rahmen unlesbar: {fehler}"}))
        return 0

    ref = merkmale(ref_pfad)
    neu = merkmale(neu_pfad)

    if ref[0] is None or neu[0] is None:
        print(json.dumps({"getroffen": False, "grund": "Bild unlesbar"}))
        return 0

    H, vertrauen, treffer = abbildung(ref, neu)
    ms = int((time.time() - t0) * 1000)

    if H is None or vertrauen < SCHWELLE:
        print(json.dumps({"getroffen": False, "vertrauen": round(vertrauen, 3),
                          "treffer": treffer, "ms": ms,
                          "grund": "Abbildung nicht verlässlich"}))
        return 0

    rh, rb = ref[0].shape[:2]
    nh, nb = neu[0].shape[:2]

    bereiche = [
        rahmen_abbilden(H, r, (rb, rh), (nb, nh)) if isinstance(r, dict) else None
        for r in rahmen
    ]

    print(json.dumps({"getroffen": True, "vertrauen": round(vertrauen, 3),
                      "treffer": treffer, "ms": ms, "bereiche": bereiche}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
