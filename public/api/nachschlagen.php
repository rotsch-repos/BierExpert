<?php

declare(strict_types=1);

/**
 * POST /api/nachschlagen.php
 *
 * "Kenne ich dieses Bier?" — der Endpunkt auf der Workstation, an dem
 * Modell und Bierdatenbank zusammenliegen.
 *
 * Anfrage:  { "bild": "<base64>", "typ": "image/jpeg" }
 * Antwort:  { "gefunden": true,  "etikett": {…}, "bilder": [...], "gelesen": {…} }
 *           { "gefunden": false, "gelesen": {…}, "schluessel": "…" }
 *
 * Gefragt wird nicht aus einem Browser, sondern von der Seite beim Hoster.
 * Deshalb kein Herkunftsvergleich, sondern ein gemeinsames Geheimnis: Wer
 * die Adresse des Tunnels kennt, soll damit nicht die Grafikkarte
 * beschäftigen können.
 *
 * Was hier NICHT passiert: die Zerlegung eines unbekannten Etiketts. Die
 * bleibt beim Dirigenten — er hält den Schlüssel zur bezahlten API, und er
 * entscheidet, ob sie überhaupt bemüht wird.
 */

require_once __DIR__ . '/intern/pforte.php';

nurPost();
dienstSchluesselPruefen();

$begonnen = hrtime(true);
$bild = bildAusRumpf(rumpfLesen());
$llm = konfiguration()['llm'];

/** Vergangene Zeit in Millisekunden. */
$dauer = static fn (): int => (int) ((hrtime(true) - $begonnen) / 1_000_000);

/* --- Ablesen -------------------------------------------------------------- */

$erkennung = erkennen($bild);

// Vor dem Abgelesenen gilt, was dieses Bild schon einmal war.
//
// Der Schlüssel aus dem Ablesen ist eine Schätzung: Ein Sprachmodell
// antwortet nicht zweimal garantiert gleich, und schon eine anders gelesene
// Brauerei ergibt einen anderen Schlüssel. Dasselbe Foto lief deshalb
// zweimal ins Leere, kostete zweimal eine Zerlegung und legte zwei Einträge
// für dasselbe Bier an — beobachtet am 31.08. („Rothaus-Bräu" einmal als
// „Bolhaus Brau" gelesen).
//
// Die Prüfsumme ist keine Schätzung. Gleiche Bytes sind dasselbe Foto und
// damit dasselbe Bier — unabhängig davon, was das Modell diesmal zu
// erkennen glaubt. erweitert.php geht diesen Weg längst; hier fehlte er.
$ausScan = bierZuScan($bild->pruefsumme);

$schluessel = $ausScan !== null
    ? $ausScan['schluessel']
    : ($erkennung['ist_bier']
        ? schluesselBilden($erkennung['brauerei'], $erkennung['name'])
        : '');

$gelesen = [
    'ist_bier' => $erkennung['ist_bier'],
    'brauerei' => $erkennung['brauerei'],
    'name' => $erkennung['name'],
    'sicherheit' => $erkennung['sicherheit'],
];

// Das Foto aufbewahren, gleich ob das Bier bekannt ist. Gerade die Fotos zu
// noch unbekannten Bieren sind es wert: Sobald der Dirigent das Etikett
// zerlegt und zurückmeldet, gehören sie zu diesem Bier — nachgetragen wird
// das über die Prüfsumme.
$bildDatei = bildAblegen($bild);

/* --- Nachschlagen --------------------------------------------------------- */

$treffer = bierLaden($schluessel);

// Ein Eintrag ohne Elemente ist ein Torso aus einem Aufruf, der nur die
// erweiterte Sicht geholt hat. Für die Zerlegung taugt er nicht.
if ($treffer === null || $treffer['etikett']['elemente'] === []) {
    scanProtokollieren([
        'pruefsumme' => $bild->pruefsumme,
        'bild_datei' => $bildDatei,
        'aus_speicher' => false,
        'gelesen_brauerei' => $erkennung['brauerei'],
        'gelesen_name' => $erkennung['name'],
        'sicherheit' => $erkennung['sicherheit'],
        'dauer_ms' => $dauer(),
        'modell' => $llm['modell_schnell'],
    ]);

    antwortSenden(200, [
        'gefunden' => false,
        'gelesen' => $gelesen,
        // Der Schlüssel geht mit, damit der Dirigent das Ergebnis seiner
        // Zerlegung unter DEMSELBEN Schlüssel zurückmelden kann. Ihn dort
        // neu zu bilden ginge auch — aber dann bildeten ihn zwei Stellen,
        // und zwei Stellen driften auseinander.
        'schluessel' => $schluessel,
        'pruefsumme' => $bild->pruefsumme,
        'dauer_ms' => $dauer(),
    ]);
}

/* --- Treffer: die Elemente in DIESEM Foto wiederfinden --------------------- */

$etikett = $treffer['etikett'];

// Die beiden aufnahmebezogenen Felder kommen nicht aus der Datenbank.
// "sicherheit" sagt, wie gut lesbar DIESES Foto war; "hinweis" nannte, was
// auf einem ANDEREN Foto unleserlich war und wäre hier eine Behauptung über
// etwas, das niemand angesehen hat.
$etikett['sicherheit'] = $erkennung['sicherheit'];
$etikett['hinweis'] = '';

$bereiche = bereicheFuerFoto($bild, $treffer);
foreach ($etikett['elemente'] as $nummer => $element) {
    if (isset($bereiche[$element['bezeichnung']])) {
        $etikett['elemente'][$nummer]['bereich'] = $bereiche[$element['bezeichnung']];
    }
}

scanProtokollieren([
    'pruefsumme' => $bild->pruefsumme,
    'bild_datei' => $bildDatei,
    'bier_id' => $treffer['id'],
    'aus_speicher' => true,
    'gelesen_brauerei' => $erkennung['brauerei'],
    'gelesen_name' => $erkennung['name'],
    'sicherheit' => $erkennung['sicherheit'],
    'dauer_ms' => $dauer(),
    'modell' => $llm['modell_schnell'],
]);

antwortSenden(200, [
    'gefunden' => true,
    'etikett' => $etikett,
    // Die Fotos, die andere von diesem Bier gemacht haben — einschliesslich
    // des gerade hochgeladenen, das oben abgelegt wurde.
    'bilder' => bilderZuBier($treffer['id']),
    'gelesen' => $gelesen,
    'dauer_ms' => $dauer(),
]);
