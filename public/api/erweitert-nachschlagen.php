<?php

declare(strict_types=1);

/**
 * POST /api/erweitert-nachschlagen.php
 *
 * "Liegt zu diesem Foto schon die erweiterte Sicht?" — das Gegenstück zu
 * nachschlagen.php, nur für Brauart, Speisen, Verkostung und verwandte
 * Biere.
 *
 * Anfrage:  { "pruefsumme": "<sha256>" }
 * Antwort:  { "gefunden": true,  "erweitert": {…} }
 *           { "gefunden": false }
 *
 * Warum das nötig wurde: erweitert.php beim Hoster kannte keinen Dienst und
 * arbeitete gegen die Datenbank, die es vorfand — und das war seit dem
 * Umzug Hostpoints eigene, nicht die hier. Es fand also nie etwas, rief für
 * JEDEN Scan die bezahlte API und legte das Ergebnis in einer Datenbank ab,
 * die im Betrieb niemand mehr liest. Die Etikettzerlegung kam gratis von
 * hier, die erweiterte Sicht wurde jedes Mal neu bezahlt.
 *
 * Warum nur die Prüfsumme und nicht das Bild: Welches Bier auf dem Foto
 * ist, hat nachschlagen.php längst festgestellt und im Scan-Protokoll
 * vermerkt. Das noch einmal abzulesen wäre ein Modellaufruf für eine
 * Auskunft, die schon dasteht — und ein Bild über den Tunnel für nichts.
 */

require_once __DIR__ . '/intern/pforte.php';

nurPost();
dienstSchluesselPruefen();

$rumpf = rumpfLesen();
$pruefsumme = trim((string) ($rumpf['pruefsumme'] ?? ''));

if (preg_match('/^[0-9a-f]{64}$/', $pruefsumme) !== 1) {
    fehlerSenden(400, 'Es fehlt eine gültige Prüfsumme.',
        'Erwartet wird der SHA-256 des Fotos, wie ihn nachschlagen.php zurückgibt.');
}

$bekannt = bierZuScan($pruefsumme);

if ($bekannt === null || !is_array($bekannt['erweitert'])) {
    antwortSenden(200, ['gefunden' => false]);
}

antwortSenden(200, [
    'gefunden' => true,
    'erweitert' => $bekannt['erweitert'],
]);
