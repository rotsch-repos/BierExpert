-- Ein fertig eingezeichnetes Bild je Element.
--
-- Der Gedanke: Wer ein bekanntes Bier abruft, soll die Einzeichnungen als
-- fertige Bilder bekommen und nicht als Koordinaten, die erst jemand über
-- das Foto legen muss. Ein fertiges PNG ist selbsttragend — es funktioniert
-- in einer Nachricht, in einer Mail, in einer Linkvorschau und ohne
-- JavaScript. Ein Rahmen, den erst der Browser zeichnet, tut das nicht.
--
-- Und es liegt am richtigen Ende der Rechnung: Gerendert wird EINMAL, wenn
-- ein Bier neu in die Datenbank kommt. Abgerufen wird es beliebig oft, und
-- zwar als statische Datei, die ein CDN ausliefern kann, ohne dass dieser
-- Server überhaupt gefragt wird.
--
-- Warum die Spalte hier steht und nicht bei den Scans: Das Bild gehört zum
-- ELEMENT eines Biers, nicht zu einer einzelnen Aufnahme. Es zeigt das
-- Referenzfoto dieses Biers mit genau einem Rahmen darauf — dem um dieses
-- Element. Wer später ein eigenes Foto derselben Flasche hochlädt, bekommt
-- die Rahmen für SEIN Foto weiterhin live eingezeichnet; die gespeicherten
-- Bilder sind das Nachschlagewerk, nicht die Antwort auf sein Foto.
--
-- Deshalb steht hier auch weiterhin KEINE Koordinate: Sie gälte nur für das
-- eine Foto, aus dem das Bild gerendert wurde, und wäre für jedes andere
-- falsch. Was das Bild zeigt, steckt im Bild.

ALTER TABLE etikett_elemente
  ADD COLUMN bild_datei VARCHAR(190) NULL
    COMMENT 'Dateiname des Referenzfotos mit dem Rahmen um dieses Element';
