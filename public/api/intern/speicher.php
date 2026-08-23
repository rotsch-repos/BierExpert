<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Zwischenspeicher: was einmal über ein Bier herausgefunden wurde,
 * gilt beim nächsten Mal auch.
 *
 * Ein Etikett ändert sich über Jahre nicht. Die Bedeutung eines Wappens
 * schon gar nicht. Was das Modell darüber gesagt hat, ist deshalb kein
 * Ergebnis dieses einen Aufrufs, sondern Wissen über das Bier — und gilt
 * für jeden, nicht nur für den, der es zuerst fotografiert hat.
 *
 * Nicht gespeichert wird, wo ein Element auf dem Bild liegt. Dieselbe
 * Flasche schräg fotografiert hat andere Koordinaten; gespeicherte Rahmen
 * sässen beim nächsten Foto neben dem, worauf sie zeigen sollen. Die
 * Bildbereiche werden bei jedem Treffer neu bestimmt, siehe schemaVerortung().
 *
 * Jede Funktion hier verträgt es, wenn keine Datenbank da ist. Fällt der
 * Zwischenspeicher aus, wird jeder Scan zum Fehlschlag-Fall — langsamer,
 * aber vollständig.
 */

/**
 * Sucht ein Bier anhand des Schlüssels.
 *
 * Zurück kommt das gespeicherte Wissen — ohne Bildbereiche und ohne die
 * beiden aufnahmebezogenen Felder "sicherheit" und "hinweis". Die trägt der
 * Aufrufer nach, weil sie zu DIESEM Foto gehören, nicht zum Bier.
 *
 * @return array{id:int, etikett:array, erweitert:?array}|null
 */
function bierLaden(string $schluessel): ?array
{
    if ($schluessel === '') {
        return null;
    }

    $db = datenbank();
    if ($db === null) {
        return null;
    }

    try {
        $abfrage = $db->prepare(
            'SELECT id, brauerei, name, ort, land, gegruendet, stil, stammwuerze, alkohol,
                    farbwahl, schriftbild, hintergrund, gespraechsstoff, erweitert
               FROM biere
              WHERE schluessel = ?',
        );
        $abfrage->execute([$schluessel]);
        $zeile = $abfrage->fetch();

        if ($zeile === false) {
            return null;
        }

        $id = (int) $zeile['id'];

        $elementeAbfrage = $db->prepare(
            'SELECT bezeichnung, position, beschreibung, bedeutung
               FROM etikett_elemente
              WHERE bier_id = ?
              ORDER BY reihenfolge',
        );
        $elementeAbfrage->execute([$id]);

        $elemente = [];
        foreach ($elementeAbfrage->fetchAll() as $element) {
            $elemente[] = [
                'bezeichnung' => (string) $element['bezeichnung'],
                'position' => (string) ($element['position'] ?? ''),
                'beschreibung' => (string) ($element['beschreibung'] ?? ''),
                'bedeutung' => (string) ($element['bedeutung'] ?? ''),
                // Wird von der Verortung überschrieben. Ein Rahmen dieser
                // Grösse wird vom Frontend verworfen — dort steht dann keine
                // falsche Markierung, sondern gar keine.
                'bereich' => ['x' => 0.0, 'y' => 0.0, 'breite' => 0.0, 'hoehe' => 0.0],
            ];
        }

        // Ohne Elemente ist der Eintrag ein Torso: Er entstand aus einem
        // Aufruf, der nur die erweiterte Sicht geholt hat. Für die
        // Etikettzerlegung ist das kein Treffer.
        return [
            'id' => $id,
            'etikett' => [
                'erkannt' => true,
                'name' => (string) $zeile['name'],
                'brauerei' => (string) $zeile['brauerei'],
                'ort' => (string) ($zeile['ort'] ?? 'unbekannt'),
                'land' => (string) ($zeile['land'] ?? 'unbekannt'),
                'gegruendet' => (string) ($zeile['gegruendet'] ?? 'unbekannt'),
                'stil' => (string) ($zeile['stil'] ?? 'unbekannt'),
                'stammwuerze' => (string) ($zeile['stammwuerze'] ?? 'unbekannt'),
                'alkohol' => (string) ($zeile['alkohol'] ?? 'unbekannt'),
                'elemente' => $elemente,
                'farbwahl' => (string) ($zeile['farbwahl'] ?? ''),
                'schriftbild' => (string) ($zeile['schriftbild'] ?? ''),
                'hintergrund' => (string) ($zeile['hintergrund'] ?? ''),
                'gespraechsstoff' => jsonSpalte($zeile['gespraechsstoff']) ?? [],
            ],
            'erweitert' => jsonSpalte($zeile['erweitert']),
        ];
    } catch (PDOException $fehler) {
        error_log('BierExpert: Nachschlagen fehlgeschlagen — ' . $fehler->getMessage());
        return null;
    }
}

/**
 * Legt die Etikettzerlegung ab und gibt die Kennung des Bieres zurück.
 *
 * Rührt die Spalte "erweitert" nicht an: Die beiden Aufrufe eines Scans
 * laufen nebeneinander, und wer zuletzt schreibt, darf nicht löschen, was
 * der andere gerade eingetragen hat.
 */
function bierSpeichern(string $schluessel, array $etikett, string $modell): ?int
{
    if ($schluessel === '') {
        return null;
    }

    $db = datenbank();
    if ($db === null) {
        return null;
    }

    $elemente = is_array($etikett['elemente'] ?? null) ? $etikett['elemente'] : [];

    try {
        $db->beginTransaction();

        $db->prepare(
            'INSERT INTO biere
                 (schluessel, brauerei, name, ort, land, gegruendet, stil, stammwuerze,
                  alkohol, farbwahl, schriftbild, hintergrund, gespraechsstoff, modell)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                 brauerei = VALUES(brauerei), name = VALUES(name), ort = VALUES(ort),
                 land = VALUES(land), gegruendet = VALUES(gegruendet), stil = VALUES(stil),
                 stammwuerze = VALUES(stammwuerze), alkohol = VALUES(alkohol),
                 farbwahl = VALUES(farbwahl), schriftbild = VALUES(schriftbild),
                 hintergrund = VALUES(hintergrund), gespraechsstoff = VALUES(gespraechsstoff),
                 modell = VALUES(modell)',
        )->execute([
            $schluessel,
            gekuerzt($etikett['brauerei'] ?? '', 190),
            gekuerzt($etikett['name'] ?? '', 190),
            gekuerzt($etikett['ort'] ?? '', 190),
            gekuerzt($etikett['land'] ?? '', 120),
            gekuerzt($etikett['gegruendet'] ?? '', 190),
            gekuerzt($etikett['stil'] ?? '', 190),
            gekuerzt($etikett['stammwuerze'] ?? '', 190),
            gekuerzt($etikett['alkohol'] ?? '', 190),
            (string) ($etikett['farbwahl'] ?? ''),
            (string) ($etikett['schriftbild'] ?? ''),
            (string) ($etikett['hintergrund'] ?? ''),
            alsJson($etikett['gespraechsstoff'] ?? []),
            gekuerzt($modell, 120),
        ]);

        // lastInsertId() liefert bei einem Treffer auf den Einmalig-Schlüssel
        // nicht verlässlich die Kennung der bestehenden Zeile. Nachschlagen
        // ist eindeutig.
        $kennung = $db->prepare('SELECT id FROM biere WHERE schluessel = ?');
        $kennung->execute([$schluessel]);
        $id = (int) $kennung->fetchColumn();

        // Die Elemente werden ersetzt, nicht ergänzt: Eine zweite Auswertung
        // desselben Etiketts benennt womöglich sieben statt neun Elemente.
        // Beides nebeneinander stehen zu lassen ergäbe eine Liste, in der
        // dasselbe Wappen zweimal vorkommt.
        $db->prepare('DELETE FROM etikett_elemente WHERE bier_id = ?')->execute([$id]);

        $einfuegen = $db->prepare(
            'INSERT INTO etikett_elemente
                 (bier_id, reihenfolge, bezeichnung, position, beschreibung, bedeutung)
             VALUES (?,?,?,?,?,?)',
        );

        foreach (array_values($elemente) as $nummer => $element) {
            if (!is_array($element)) {
                continue;
            }
            $einfuegen->execute([
                $id,
                $nummer,
                gekuerzt($element['bezeichnung'] ?? '', 190),
                gekuerzt($element['position'] ?? '', 190),
                (string) ($element['beschreibung'] ?? ''),
                (string) ($element['bedeutung'] ?? ''),
            ]);
        }

        $db->commit();
        return $id;
    } catch (PDOException $fehler) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('BierExpert: Speichern fehlgeschlagen — ' . $fehler->getMessage());
        return null;
    }
}

/**
 * Legt die erweiterte Sicht ab.
 *
 * Ein Aufruf für sich: Er läuft neben der Etikettzerlegung und muss auch
 * dann etwas ablegen können, wenn zu dem Bier noch keine Zeile besteht.
 * Deshalb ein INSERT mit ON DUPLICATE KEY UPDATE, das ausschliesslich die
 * Spalte "erweitert" anfasst — der eine Schritt kann sich mit dem anderen
 * nicht überschneiden, weil die Datenbank ihn als Ganzes ausführt.
 */
function erweitertSpeichern(string $schluessel, string $brauerei, string $name, array $erweitert, string $modell): void
{
    if ($schluessel === '') {
        return;
    }

    $db = datenbank();
    if ($db === null) {
        return;
    }

    try {
        $db->prepare(
            'INSERT INTO biere (schluessel, brauerei, name, erweitert, modell)
             VALUES (?,?,?,?,?)
             ON DUPLICATE KEY UPDATE erweitert = VALUES(erweitert)',
        )->execute([
            $schluessel,
            gekuerzt($brauerei, 190),
            gekuerzt($name, 190),
            alsJson($erweitert),
            gekuerzt($modell, 120),
        ]);
    } catch (PDOException $fehler) {
        error_log('BierExpert: Erweiterte Sicht nicht gespeichert — ' . $fehler->getMessage());
    }
}

/**
 * Schreibt einen Eintrag ins Scan-Protokoll.
 *
 * Fasst nichts an, was der Leser zu sehen bekommt. Scheitert es, bleibt es
 * im Log — eine Auswertung soll nicht daran scheitern, dass ihre Buchführung
 * klemmt.
 */
function scanProtokollieren(array $eintrag): void
{
    $db = datenbank();
    if ($db === null) {
        return;
    }

    try {
        $db->prepare(
            'INSERT INTO scans
                 (bild_pruefsumme, bier_id, aus_speicher, gelesen_brauerei, gelesen_name,
                  sicherheit, hinweis, dauer_ms, modell, fehler)
             VALUES (?,?,?,?,?,?,?,?,?,?)',
        )->execute([
            (string) $eintrag['pruefsumme'],
            $eintrag['bier_id'] ?? null,
            ($eintrag['aus_speicher'] ?? false) ? 1 : 0,
            gekuerzt($eintrag['gelesen_brauerei'] ?? '', 190),
            gekuerzt($eintrag['gelesen_name'] ?? '', 190),
            gekuerzt($eintrag['sicherheit'] ?? '', 20),
            (string) ($eintrag['hinweis'] ?? ''),
            $eintrag['dauer_ms'] ?? null,
            gekuerzt($eintrag['modell'] ?? '', 120),
            gekuerzt($eintrag['fehler'] ?? '', 255),
        ]);
    } catch (PDOException $fehler) {
        error_log('BierExpert: Scan nicht protokolliert — ' . $fehler->getMessage());
    }
}

/** Liest eine JSON-Spalte. Unlesbares gilt als nicht vorhanden. */
function jsonSpalte(mixed $wert): ?array
{
    if (!is_string($wert) || $wert === '') {
        return null;
    }
    $daten = json_decode($wert, true);
    return is_array($daten) ? $daten : null;
}

function alsJson(mixed $wert): string
{
    return json_encode($wert, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) ?: '[]';
}

/**
 * Kürzt auf die Breite der Spalte.
 *
 * MariaDB weist einen zu langen Wert im strengen Modus ab — dann scheiterte
 * das Speichern, und der nächste Scan liefe wieder ans Modell. Lieber ein
 * gekürzter Eintrag als gar keiner. mb_substr zählt Zeichen, nicht Bytes:
 * VARCHAR(190) meint 190 Zeichen, und ein "ä" ist eines davon.
 */
function gekuerzt(mixed $wert, int $zeichen): string
{
    $text = trim((string) $wert);
    return mb_substr($text, 0, $zeichen, 'UTF-8');
}
