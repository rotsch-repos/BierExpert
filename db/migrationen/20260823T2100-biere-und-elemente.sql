-- Der Zwischenspeicher der erkannten Biere.
--
-- Der Gedanke dahinter: Ein Etikett ändert sich über Jahre nicht. Was das
-- Modell einmal darüber herausgefunden hat, gilt auch beim nächsten Scan —
-- und zwar für jeden, nicht nur für den, der es zuerst fotografiert hat.
-- Damit wird die Anwendung mit jedem Scan schneller und billiger.
--
-- Wichtig ist die Trennung: Hier steht nur, was am BIER hängt. Wo ein
-- Element auf einem bestimmten Foto liegt, gehört nicht hierher — dieselbe
-- Flasche aus anderem Winkel fotografiert hat andere Koordinaten. Die
-- Bedeutung eines Wappens ist bierweit gültig, seine Bildposition nicht.

CREATE TABLE biere (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Suchschlüssel: Brauerei und Name, kleingeschrieben und auf
  -- Buchstaben/Ziffern reduziert. So findet "Rothaus-Bräu / Tannenzäpfle"
  -- auch dann, wenn das Modell beim nächsten Mal "Rothaus Brauerei" liest.
  schluessel       VARCHAR(190) NOT NULL,

  brauerei         VARCHAR(190) NOT NULL,
  name             VARCHAR(190) NOT NULL,
  ort              VARCHAR(190),
  land             VARCHAR(120),
  -- Diese vier bewusst großzügig: Das Modell hängt Herkunftsvermerke an die
  -- Werte an, statt nackte Zahlen zu liefern — "5,1 % vol (aus Kenntnis
  -- ergänzt, auf dem Foto nicht lesbar)" sind schon 59 Zeichen. Ein knapp
  -- bemessenes Feld schneidet genau die Einschränkung ab, die den Wert
  -- ehrlich macht.
  gegruendet       VARCHAR(190),
  stil             VARCHAR(190),
  stammwuerze      VARCHAR(190),
  alkohol          VARCHAR(190),

  farbwahl         TEXT,
  schriftbild      TEXT,
  hintergrund      MEDIUMTEXT,
  gespraechsstoff  JSON,

  -- Brauart, Speisen, Verkostung und verwandte Biere zusammen. Als JSON,
  -- weil ihre Gestalt schon im Zod-Schema festgelegt ist; sie hier ein
  -- zweites Mal in Tabellen zu gießen brächte nichts, was wir abfragen
  -- wollen, kostet aber vier weitere Tabellen und deren Pflege.
  erweitert        JSON,

  -- Womit erzeugt. Wechselt das Modell, lässt sich gezielt neu auswerten,
  -- statt alles zu verwerfen.
  modell           VARCHAR(120),

  erstellt_am      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  aktualisiert_am  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                     ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY schluessel_einmalig (schluessel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Die Bildelemente eines Etiketts — ohne Koordinaten, siehe oben.
CREATE TABLE etikett_elemente (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bier_id       INT UNSIGNED NOT NULL,

  -- Die Reihenfolge, in der das Modell sie genannt hat: die auffälligsten
  -- zuerst. Ohne das käme die Liste bei jeder Anzeige anders heraus.
  reihenfolge   SMALLINT UNSIGNED NOT NULL,

  bezeichnung   VARCHAR(190) NOT NULL,
  position      VARCHAR(190),
  beschreibung  TEXT,
  bedeutung     TEXT,

  CONSTRAINT elemente_gehoeren_zu_bier
    FOREIGN KEY (bier_id) REFERENCES biere (id) ON DELETE CASCADE,

  KEY nach_bier (bier_id, reihenfolge)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
