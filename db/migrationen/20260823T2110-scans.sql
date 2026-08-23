-- Ein Protokoll der Auswertungen.
--
-- Nicht zur Buchhaltung, sondern um beantworten zu können, ob der
-- Zwischenspeicher überhaupt etwas bringt: Wie oft wurde ein Bier
-- wiedererkannt, wie oft musste das große Modell anlaufen, und wie lange
-- hat beides gedauert. Ohne diese Zahlen ist jede spätere Aussage über
-- die Wirkung geraten.
--
-- Bewusst ohne Bilddaten und ohne IP-Adresse: Für diesen Zweck braucht es
-- weder das eine noch das andere, und was nicht gespeichert wird, kann
-- auch nicht abhandenkommen.

CREATE TABLE scans (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Prüfsumme des aufbereiteten Bildes. Erlaubt, dasselbe Foto
  -- wiederzuerkennen, ohne es aufzubewahren.
  bild_pruefsumme CHAR(64) NOT NULL,

  bier_id        INT UNSIGNED,

  -- Kam die Antwort aus der Datenbank oder vom Modell?
  aus_speicher   TINYINT(1) NOT NULL DEFAULT 0,

  -- Was die schnelle Vorstufe vom Etikett gelesen hat. Weicht es von dem
  -- ab, was am Ende herauskam, ist das der Hinweis auf einen Fehlgriff
  -- beim Nachschlagen.
  gelesen_brauerei VARCHAR(190),
  gelesen_name     VARCHAR(190),

  -- Wie sicher sich das Modell bei der Zuordnung war: hoch, mittel oder
  -- niedrig. Gehört hierher und nicht zum Bier — sie sagt etwas über
  -- DIESE Aufnahme aus, nicht über das Bier. Dasselbe Bier scharf
  -- fotografiert ergibt "hoch", verwackelt "niedrig".
  sicherheit       VARCHAR(20),

  -- Was auf DIESEM Foto nicht lesbar war und deshalb gedeutet statt
  -- gewusst wurde. Ebenfalls aufnahmebezogen: Bei einem zweiten Foto
  -- derselben Flasche ist womöglich genau das lesbar, was hier fehlte.
  hinweis          TEXT,

  dauer_ms       INT UNSIGNED,
  modell         VARCHAR(120),
  fehler         VARCHAR(255),

  erstellt_am    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT scan_zeigt_auf_bier
    FOREIGN KEY (bier_id) REFERENCES biere (id) ON DELETE SET NULL,

  KEY nach_pruefsumme (bild_pruefsumme),
  KEY nach_zeit (erstellt_am)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
