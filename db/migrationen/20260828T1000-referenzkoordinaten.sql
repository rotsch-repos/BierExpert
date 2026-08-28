-- Der Anker für die Bildregistrierung.
--
-- Bisher stand hier bewusst keine Koordinate: Sie gilt nur für das eine
-- Foto, aus dem sie stammt, und wäre für jedes andere falsch. Das bleibt
-- richtig — diese Spalten sind keine Ausnahme davon, sondern beruhen darauf.
--
-- Der Gedanke: Ein Etikett ändert sich über Jahre nicht. Zwei Fotos
-- derselben Flasche unterscheiden sich nur durch Winkel, Abstand und Licht —
-- also durch eine Abbildung, die sich aus den Bildern selbst bestimmen
-- lässt. Kennt man sie, lassen sich die Rahmen vom Referenzfoto auf das
-- neue durchreichen, statt sie ein zweites Mal von einem Modell suchen zu
-- lassen.
--
-- Gemessen am 28.08. auf dieser Maschine: 23-42 ms auf der CPU gegenüber
-- rund 2500 ms auf der GPU. Und mit einem Vertrauensmass obendrein, das
-- ein Modell nicht liefert — passt die Abbildung nicht, sagt die Zahl es.
--
-- Deshalb gehören BEIDE Angaben zusammen: der Rahmen und das Foto, auf das
-- er sich bezieht. Eine Koordinate ohne ihr Foto wäre wieder genau der
-- Fehler, den das Schema bisher vermieden hat.

ALTER TABLE biere
  ADD COLUMN referenz_bild VARCHAR(190) NULL
    COMMENT 'Dateiname des Fotos, auf das sich die Referenzrahmen beziehen';

ALTER TABLE etikett_elemente
  ADD COLUMN referenz_bereich JSON NULL
    COMMENT 'Rahmen dieses Elements AUF DEM REFERENZFOTO, Anteile 0..1';
