-- Die Fotos der Scans aufbewahren.
--
-- Das kehrt eine frühere Entscheidung um, und zwar bewusst. In der
-- scans-Tabelle stand: "Bewusst ohne Bilddaten und ohne IP-Adresse: Für
-- diesen Zweck braucht es weder das eine noch das andere, und was nicht
-- gespeichert wird, kann auch nicht abhandenkommen." Der Zweck war damals
-- Buchführung — wie oft traf der Zwischenspeicher, wie lange dauerte es.
--
-- Der Zweck ist jetzt ein anderer: Zu einem bekannten Bier sollen die Fotos
-- mitkommen, die andere davon gemacht haben. Dafür braucht es sie.
--
-- Die IP-Adresse bleibt draussen. Sie war für den alten Zweck unnötig und
-- ist es für den neuen erst recht — ein Foto einer Bierflasche sagt nichts
-- über den, der es aufgenommen hat, solange nicht danebensteht, woher es kam.
--
-- Gespeichert wird der DATEINAME, nicht das Bild selbst. Ein Etikettfoto
-- wiegt ein bis mehrere Megabyte; als BLOB in der Zeile bläht es jede
-- Abfrage auf, die es gar nicht braucht, und jeden Datenbankauszug mit.
-- Als Datei daneben liegt es dort, wo ein Webserver es ohne Umweg über PHP
-- ausliefern kann.
--
-- Der Name ist die Prüfsumme des aufbereiteten Bildes, die ohnehin schon in
-- der Zeile steht. Damit liegt dasselbe Foto nie zweimal auf der Platte,
-- auch wenn es zehnmal hochgeladen wurde.

ALTER TABLE scans
  ADD COLUMN bild_datei VARCHAR(190) NULL
    COMMENT 'Dateiname im Bilderverzeichnis, leer wenn nicht aufbewahrt'
    AFTER bild_pruefsumme;

-- Für die Galerie eines Biers: alle Scans dazu, die neuesten zuerst.
-- Ohne diesen Schlüssel liefe die Abfrage über die ganze Tabelle, und die
-- wächst mit jedem Scan — auch mit denen, die gar kein Bier trafen.
ALTER TABLE scans
  ADD KEY nach_bier_und_zeit (bier_id, erstellt_am);
