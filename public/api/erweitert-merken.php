<?php

declare(strict_types=1);

/**
 * POST /api/erweitert-merken.php
 *
 * Nimmt die erweiterte Sicht entgegen, die der Dirigent bei der bezahlten
 * API geholt hat, und legt sie beim Bier ab.
 *
 * Anfrage:  { "pruefsumme": "<sha256>", "erweitert": {…} }
 * Antwort:  { "id": 42 } — oder { "id": null }, wenn zu dem Foto kein Bier
 *           bekannt ist.
 *
 * Das Gegenstück zu merken.php, und aus demselben Grund da: Gerechnet wird,
 * wo der Schlüssel zur bezahlten API liegt; aufbewahrt wird, wo die
 * Datenbank steht. Ohne diesen Endpunkt fiele die erweiterte Sicht bei
 * jedem Scan aufs Neue an — für ein Bier, das längst im Kompendium steht.
 *
 * Welchem Bier sie gehört, sagt die Prüfsumme des Fotos und nicht der
 * Aufrufer. Eine mitgeschickte Kennung wäre eine Behauptung; die Prüfsumme
 * dagegen steht im eigenen Scan-Protokoll.
 */

require_once __DIR__ . '/intern/pforte.php';

nurPost();
dienstSchluesselPruefen();

$rumpf = rumpfLesen();
$pruefsumme = trim((string) ($rumpf['pruefsumme'] ?? ''));
$erweitert = $rumpf['erweitert'] ?? null;

if (preg_match('/^[0-9a-f]{64}$/', $pruefsumme) !== 1) {
    fehlerSenden(400, 'Es fehlt eine gültige Prüfsumme.');
}

if (!is_array($erweitert)) {
    fehlerSenden(400, 'Es fehlt das Feld "erweitert".');
}

// Ungereinigt abgelegt — und zwar bewusst, nicht aus Nachlässigkeit: Genau
// so legt erweitert.php die frische Modellantwort auch bisher ab. Eine
// Reinigung nur an dieser einen Stelle wäre keine Sicherheit, sondern zwei
// verschiedene Vorstellungen davon, was in der Spalte stehen darf. Geprüft
// wird die Struktur im Browser gegen ErweitertSchema, bevor sie angezeigt
// wird.
//
// Was diesen Endpunkt schützt, ist der Dienstschlüssel davor: Ohne ihn
// kommt hier niemand durch.

$bekannt = bierZuScan($pruefsumme);

if ($bekannt === null) {
    // Kein Bier zu diesem Foto. Das ist kein Fehler, sondern der Fall, in
    // dem etikett.php die Zerlegung selbst noch nicht zurückgemeldet hat —
    // dann gehört die erweiterte Sicht noch niemandem.
    antwortSenden(200, ['id' => null]);
}

erweitertSpeichernZuKennung($bekannt['id'], $erweitert);

// Auch die erweiterte Sicht gehört in den Notvorrat: Ohne sie zahlte der
// Rückfall sie bei jedem Scan neu — genau der Fehler, der hier gerade
// behoben wurde, nur eine Ausfallstufe später.
bierSpiegeln($bekannt['id']);

antwortSenden(200, ['id' => $bekannt['id']]);
