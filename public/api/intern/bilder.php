<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Die aufbewahrten Scanfotos.
 *
 * Zu einem bekannten Bier sollen die Fotos mitkommen, die andere davon
 * gemacht haben. Dafür müssen sie liegenbleiben — und das ist eine Umkehr
 * der ursprünglichen Entscheidung, in der scans-Tabelle ausdrücklich keine
 * Bilddaten zu führen.
 *
 * Was von dieser Entscheidung bleibt: Die IP-Adresse wird weiterhin nicht
 * gespeichert. Ein Foto einer Bierflasche sagt nichts über den, der es
 * aufgenommen hat, solange nicht danebensteht, woher es kam.
 *
 * Die Dateien liegen NEBEN der Datenbank, nicht darin. Ein Etikettfoto
 * wiegt ein bis mehrere Megabyte; als BLOB bläht es jede Abfrage auf, die
 * es gar nicht braucht. Als Datei liegt es dort, wo ein Webserver es ohne
 * Umweg über PHP ausliefern kann.
 *
 * Der Dateiname ist die Prüfsumme des Bildes. Damit liegt dasselbe Foto nie
 * zweimal auf der Platte, auch wenn es zehnmal hochgeladen wurde — und der
 * Name verrät nichts über seinen Ursprung.
 */

/** Werden Scanfotos überhaupt aufbewahrt? */
function bilderAufbewahren(): bool
{
    return konfiguration()['bilder']['verzeichnis'] !== '';
}

/**
 * Legt das Foto ab und gibt seinen Dateinamen zurück.
 *
 * Gibt null zurück, wenn nicht aufbewahrt wird oder das Ablegen scheitert.
 * Beides ist kein Grund, den Scan fallen zu lassen: Die Auswertung steht
 * auch ohne das Foto, es fehlt dann nur später in der Galerie.
 */
function bildAblegen(Bild $bild): ?string
{
    if (!bilderAufbewahren()) {
        return null;
    }

    $verzeichnis = konfiguration()['bilder']['verzeichnis'];

    if (!is_dir($verzeichnis) && !@mkdir($verzeichnis, 0o755, true) && !is_dir($verzeichnis)) {
        error_log('BierExpert: Bilderverzeichnis nicht anlegbar — ' . $verzeichnis);

        return null;
    }

    $name = $bild->pruefsumme . bildEndung($bild->medienTyp);
    $pfad = $verzeichnis . '/' . $name;

    // Schon da? Dann war dasselbe Foto bereits einmal hier. Nichts zu tun —
    // und vor allem nicht neu schreiben: Das kostet nur Schreibzugriffe und
    // birgt die Gefahr, eine intakte Datei durch eine halbe zu ersetzen.
    if (is_file($pfad)) {
        return $name;
    }

    $daten = base64_decode($bild->base64, true);

    if ($daten === false || $daten === '') {
        return null;
    }

    // Erst daneben schreiben, dann umbenennen. Ein Abbruch mitten im
    // Schreiben hinterlässt sonst eine halbe Datei unter dem richtigen
    // Namen — und die sähe für immer wie ein gültiges Foto aus, weil der
    // Name ja stimmt. Das Umbenennen selbst ist unteilbar.
    $vorlaeufig = $pfad . '.teil-' . bin2hex(random_bytes(4));

    if (@file_put_contents($vorlaeufig, $daten) === false) {
        error_log('BierExpert: Bild nicht schreibbar — ' . $vorlaeufig);

        return null;
    }

    if (!@rename($vorlaeufig, $pfad)) {
        @unlink($vorlaeufig);
        error_log('BierExpert: Bild nicht umbenennbar — ' . $pfad);

        return null;
    }

    return $name;
}

/**
 * Die Adressen der Fotos zu einem Bier, die neuesten zuerst.
 *
 * @return list<string>
 */
function bilderZuBier(int $bierId, int $hoechstens = 12): array
{
    $basis = konfiguration()['bilder']['basis_url'];

    if ($basis === '') {
        return [];
    }

    try {
        // Gruppiert und nicht DISTINCT: Dasselbe Foto kann mehrfach
        // hochgeladen worden sein, und dann soll es einmal erscheinen —
        // und zwar so weit vorn, wie es zuletzt gesehen wurde.
        //
        // Die Grenze steht im Text und nicht als Platzhalter: LIMIT nimmt
        // in MySQL keinen gebundenen Wert. Sie ist vorher auf 1 bis 50
        // eingegrenzt, kommt also nie ungeprüft aus der Anfrage.
        $abfrage = datenbank()->prepare(
            'SELECT bild_datei, MAX(erstellt_am) AS zuletzt
               FROM scans
              WHERE bier_id = ? AND bild_datei IS NOT NULL AND bild_datei <> \'\'
              GROUP BY bild_datei
              ORDER BY zuletzt DESC
              LIMIT ' . max(1, min(50, $hoechstens)),
        );
        $abfrage->execute([$bierId]);
        $namen = $abfrage->fetchAll(PDO::FETCH_COLUMN);
    } catch (PDOException $fehler) {
        // Eine fehlende Galerie ist kein Grund, die Auskunft über das Bier
        // fallen zu lassen. Der Leser bekommt dann die Texte ohne Fotos.
        error_log('BierExpert: Bilder zu Bier nicht lesbar — ' . $fehler->getMessage());

        return [];
    }

    $adressen = [];
    foreach ($namen as $name) {
        if (is_string($name) && $name !== '') {
            $adressen[] = $basis . '/' . rawurlencode($name);
        }
    }

    return $adressen;
}

/** Verknüpft ein bereits abgelegtes Foto nachträglich mit einem Bier. */
function bildZuBierNachtragen(string $pruefsumme, int $bierId): void
{
    if ($pruefsumme === '') {
        return;
    }

    try {
        // Nur die Zeile ohne Zuordnung: Ein Scan, der schon einem Bier
        // zugeschlagen ist, gehört nicht umgehängt.
        $abfrage = datenbank()->prepare(
            'UPDATE scans SET bier_id = ? WHERE bild_pruefsumme = ? AND bier_id IS NULL',
        );
        $abfrage->execute([$bierId, $pruefsumme]);
    } catch (PDOException $fehler) {
        error_log('BierExpert: Scan nicht nachtragbar — ' . $fehler->getMessage());
    }
}

/** Die Dateiendung zum Medientyp. */
function bildEndung(string $medienTyp): string
{
    return match ($medienTyp) {
        'image/png' => '.png',
        'image/webp' => '.webp',
        'image/gif' => '.gif',
        default => '.jpg',
    };
}
