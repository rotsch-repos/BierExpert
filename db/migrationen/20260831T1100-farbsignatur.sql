-- Das billige Vorsieb für die Wiedererkennung.
--
-- Bis hierher hing das Wiederfinden eines Biers an einer einzigen Zahl, die
-- gar keine war: an dem Text, den das kleine Modell aus dem Foto ablas.
-- Daraus wurde der Schlüssel gebildet, und darüber wurde gesucht. Das ist
-- eine Schätzung, und sie kippte reproduzierbar — am 31.08. las dasselbe
-- Modell "Rothaus-Bräu" einmal als "Bolhaus Brau" und legte einen zweiten
-- Eintrag für dasselbe Bier an.
--
-- Die Antwort darauf ist nicht ein besserer Text, sondern mehr als ein
-- Signal. Drei Stufen von billig nach teuer:
--
--   1. diese Signatur  — Mikrosekunden, siebt auf eine Handvoll Kandidaten
--   2. der Produktname — läuft ohnehin, gewichtet, entscheidet nie allein
--   3. die Registrierung aus Phase F — rund 30 ms JE Bier, entscheidet
--
-- Ohne Stufe 1 müsste Stufe 3 gegen jedes Bier der Datenbank laufen. Bei
-- zehn Bieren ginge das; bei dreihundert wäre es eine Wartezeit von
-- Sekunden für etwas, das in Mikrosekunden vorzusortieren ist.
--
-- Was in der Signatur steht: ein nach Sättigung gewichtetes Histogramm aus
-- Farbton und Sättigung — ausdrücklich OHNE Helligkeit. Anderes Licht
-- verschiebt vor allem die Helligkeit; ein grünes Etikett bleibt grün, ob
-- in der Sonne oder in der Küche. Und weil die Sättigung das Gewicht ist,
-- fallen Tischplatte, Wand und Schatten fast heraus, ohne dass man sie
-- suchen müsste. Beides sind genau die zwei Einwände, die in
-- dienst/registrieren.py gegen einen naiven Farbvergleich stehen.
--
-- Gemessen am 31.08.: dasselbe Bier in anderer Fassung 0,98; Rothaus gegen
-- Augustiner 0,45; die zwei Augustiner untereinander 0,65 — richtigerweise
-- ähnlicher, denn sie teilen die Hausfarben. Dass das Sieb die beiden nicht
-- trennt, ist kein Mangel: Dafür ist Stufe 3 da.
--
-- NULL heisst "noch nicht berechnet" und ist kein Fehler: Biere aus der
-- Zeit davor haben keine, und die Suche fällt für sie auf den alten Weg
-- zurück. Sie füllt sich, sobald das Bier das nächste Mal fotografiert wird.

ALTER TABLE biere
  ADD COLUMN farbsignatur TEXT NULL
    COMMENT 'JSON-Zahlenreihe: Farbton-Sättigungs-Histogramm des Referenzfotos',
  ADD COLUMN leitfarben VARCHAR(190) NULL
    COMMENT 'JSON, die kräftigsten Farben als Hexwerte — für die Rückfrage an den Leser';
