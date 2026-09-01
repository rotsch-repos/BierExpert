<?php

declare(strict_types=1);

/**
 * POST /api/abgleich.php
 *
 * Nimmt den Spiegelbestand der Workstation entgegen — damit der Notvorrat
 * dieses Namens würdig ist.
 *
 * Anfrage:  { "biere": [ { "schluessel": "…", "etikett": {…}, "modell": "…",
 *                          "erweitert": {…}|null, "pruefsummen": ["…", …] } ] }
 * Antwort:  { "uebernommen": 5, "uebersprungen": 0 }
 *
 * Der Hintergrund: Seit dem Umzug fasst der Dirigent seine eigene Datenbank
 * im Normalbetrieb nicht mehr an — sie ist der Rückfall für den Fall, dass
 * die Workstation nicht erreichbar ist. Ein Rückfall auf einen Stand vom
 * Umzugstag wäre aber ein Museum, kein Vorrat: Jedes seither gelernte Bier
 * fehlte ihm, und jeder Scan darauf zahlte die Zerlegung erneut. Die
 * Workstation spiegelt deshalb jedes neue Bier hierher, sobald es entsteht.
 *
 * Was NICHT mitkommt, mit Absicht: Referenzfoto, Farbsignatur und
 * Registrierungs-Anker. Sie gehören zur Wiedererkennung über das Bild, und
 * die braucht OpenCV — das es auf diesem Hosting nicht gibt. Der Rückfall
 * erkennt über den abgelesenen Text und die Prüfsummen bekannter Fotos;
 * gröber, aber aus eigener Kraft.
 *
 * Geschützt wie die Gegenstellen auf der Workstation: mit dem gemeinsamen
 * Geheimnis. Wer hier ohne es schreiben könnte, könnte das Kompendium
 * fluten.
 */

require_once __DIR__ . '/intern/pforte.php';

nurPost();
dienstSchluesselPruefen();

$rumpf = rumpfLesen();
$biere = is_array($rumpf['biere'] ?? null) ? $rumpf['biere'] : [];

if ($biere === []) {
    fehlerSenden(400, 'Es fehlt die Liste "biere".');
}

$uebernommen = 0;
$uebersprungen = 0;

foreach ($biere as $bier) {
    if (!is_array($bier)) {
        $uebersprungen += 1;

        continue;
    }

    $schluessel = trim((string) ($bier['schluessel'] ?? ''));

    // Durch dieselbe Reinigung wie jede Modellantwort: Der Absender ist die
    // eigene Workstation, aber der Weg führt über das Netz — und was über
    // das Netz kam, ist nicht deshalb wohlgeformt, weil die Gegenstelle die
    // eigene ist.
    $etikett = etikettSaeubern(is_array($bier['etikett'] ?? null) ? $bier['etikett'] : []);

    if ($schluessel === '' || !$etikett['erkannt'] || $etikett['elemente'] === []) {
        $uebersprungen += 1;

        continue;
    }

    // Ohne Referenzfoto — die Registrierung kann hier ohnehin nicht rechnen,
    // und ein Dateiname ohne Datei wäre schlimmer als keiner.
    $kennung = bierSpeichern($schluessel, $etikett, (string) ($bier['modell'] ?? ''), '');

    if ($kennung === null) {
        $uebersprungen += 1;

        continue;
    }

    if (is_array($bier['erweitert'] ?? null)) {
        erweitertSpeichernZuKennung($kennung, $bier['erweitert']);
    }

    // Die Prüfsummen der Fotos, unter denen dieses Bier drüben gesehen
    // wurde: Damit greift im Rückfall dieselbe Abkürzung wie im
    // Normalbetrieb — gleiche Bytes sind dasselbe Bier, ganz ohne Modell.
    foreach (array_slice((array) ($bier['pruefsummen'] ?? []), 0, 100) as $pruefsumme) {
        if (is_string($pruefsumme) && preg_match('/^[0-9a-f]{64}$/', $pruefsumme) === 1) {
            scanVerbindungSichern($pruefsumme, $kennung);
        }
    }

    $uebernommen += 1;
}

antwortSenden(200, [
    'uebernommen' => $uebernommen,
    'uebersprungen' => $uebersprungen,
]);
