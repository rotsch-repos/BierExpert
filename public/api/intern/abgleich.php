<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Spiegel: hält den Notvorrat beim Hoster auf Stand.
 *
 * Läuft auf der Workstation und schickt ein Bier, sobald es entsteht oder
 * seine erweiterte Sicht bekommt, an /api/abgleich.php des Hosters. Fällt
 * die Workstation später aus, antwortet der Hoster aus einer frischen
 * Kopie statt aus einem Museum vom Umzugstag.
 *
 * Ereignisgetrieben statt als nächtlicher Lauf: Ein Bier entsteht ein paar
 * Mal die Woche, nicht tausendmal die Stunde — der eine POST im Moment des
 * Entstehens ist billiger und aktueller als jeder Zeitplan, und es gibt
 * keinen Zeitraum, in dem der Vorrat hinterherhinkt.
 *
 * Scheitert der Spiegel, scheitert nur der Spiegel: Der Scan, in dessen
 * Verlauf er läuft, bekommt davon nichts mit. Ins Protokoll, damit ein
 * dauerhaft stummer Abgleich auffällt — der nächste erfolgreiche holt
 * ohnehin alles nach, denn gespiegelt wird immer der ganze Eintrag.
 */

/** Wohin gespiegelt wird — leer heisst: gar nicht (so steht es beim Hoster). */
function abgleichAdresse(): string
{
    return konfiguration()['abgleich']['adresse'];
}

/** Schickt ein Bier samt erweiterter Sicht und Foto-Prüfsummen zum Hoster. */
function bierSpiegeln(int $bierId): void
{
    $adresse = abgleichAdresse();

    if ($adresse === '' || $bierId <= 0) {
        return;
    }

    $db = datenbank();
    if ($db === null) {
        return;
    }

    try {
        $zeile = $db->prepare('SELECT * FROM biere WHERE id = ?');
        $zeile->execute([$bierId]);
        $bier = $zeile->fetch();

        if ($bier === false) {
            return;
        }

        $treffer = bierLaden((string) $bier['schluessel']);

        if ($treffer === null || $treffer['etikett']['elemente'] === []) {
            return;
        }

        $summen = $db->prepare(
            'SELECT DISTINCT bild_pruefsumme FROM scans WHERE bier_id = ? LIMIT 100',
        );
        $summen->execute([$bierId]);

        $rumpf = [
            'biere' => [[
                'schluessel' => (string) $bier['schluessel'],
                'etikett' => $treffer['etikett'],
                'modell' => (string) ($bier['modell'] ?? ''),
                'erweitert' => jsonSpalte($bier['erweitert']),
                'pruefsummen' => array_values(array_map(
                    'strval',
                    $summen->fetchAll(PDO::FETCH_COLUMN),
                )),
            ]],
        ];
    } catch (PDOException $fehler) {
        error_log('BierExpert: Spiegel nicht befüllbar — ' . $fehler->getMessage());

        return;
    }

    $griff = curl_init(rtrim($adresse, '/') . '/abgleich.php');

    if ($griff === false) {
        return;
    }

    curl_setopt_array($griff, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($rumpf, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            // Dasselbe Geheimnis wie in der Gegenrichtung, auf zwei Wegen:
            // Bearer für Server, die ihn durchreichen, die eigene Kopfzeile
            // für Apache auf geteiltem Hosting, der Authorization vor PHP
            // verschluckt.
            'Authorization: Bearer ' . konfiguration()['dienst']['schluessel'],
            'X-Dienst-Schluessel: ' . konfiguration()['dienst']['schluessel'],
        ],
        CURLOPT_RETURNTRANSFER => true,
        // Knapp: Der Spiegel läuft im Rücken eines Scans. Ein zäher Hoster
        // darf den Eintrag verspäten, aber nicht den Scan verschleppen.
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $antwort = curl_exec($griff);
    $status = (int) curl_getinfo($griff, CURLINFO_RESPONSE_CODE);
    curl_close($griff);

    if ($antwort === false || $status !== 200) {
        error_log('BierExpert: Spiegel zum Hoster fehlgeschlagen — Status ' . $status);
    }
}
