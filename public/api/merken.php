<?php

declare(strict_types=1);

/**
 * POST /api/merken.php
 *
 * Nimmt die Zerlegung eines bisher unbekannten Etiketts entgegen und legt
 * sie in der Bierdatenbank ab.
 *
 * Anfrage:  { "schluessel": "…", "etikett": {…}, "modell": "…", "pruefsumme": "…" }
 * Antwort:  { "id": 42, "bilder": [...] }
 *
 * Das Gegenstück zu nachschlagen.php und der Grund, warum das Kompendium
 * überhaupt wächst: Zerlegt wird beim Dirigenten, der den Schlüssel zur
 * bezahlten API hält — aufbewahrt wird hier, wo die Datenbank steht.
 *
 * Ohne diesen Endpunkt liefe jedes Bier bei jedem Besuch erneut über die
 * bezahlte API, und die ganze Aufteilung hätte keinen Zweck.
 */

require_once __DIR__ . '/intern/pforte.php';

nurPost();
dienstSchluesselPruefen();

$rumpf = rumpfLesen();

$schluessel = trim((string) ($rumpf['schluessel'] ?? ''));
$etikett = $rumpf['etikett'] ?? null;

if ($schluessel === '') {
    fehlerSenden(400, 'Es fehlt der Schlüssel.',
        'Ohne ihn liefe der Eintrag unter nichts und wäre nie wieder auffindbar.');
}

if (!is_array($etikett)) {
    fehlerSenden(400, 'Es fehlt das Feld "etikett".');
}

// Durch dieselbe Reinigung wie eine frische Modellantwort. Was von aussen
// hereinkommt, ist nicht deshalb wohlgeformt, weil es von der eigenen
// Gegenstelle kommt — ein Bildbereich mit x = 4.7 ist formal gültig und
// zeigt trotzdem ins Leere.
$etikett = etikettSaeubern($etikett);

if (!$etikett['erkannt']) {
    // Kein Bier ist kein Eintrag. Das stillschweigend abzulegen füllte die
    // Datenbank mit Zeilen, die nie jemand trifft.
    antwortSenden(200, ['id' => null, 'bilder' => []]);
}

$referenzBild = bildDateiZuPruefsumme((string) ($rumpf['pruefsumme'] ?? ''));

// Das Foto dieses Scans wird zum Referenzfoto: Die Rahmen aus der Zerlegung
// beziehen sich darauf, und an ihnen richtet die Registrierung später jede
// weitere Aufnahme aus.
$kennung = bierSpeichern($schluessel, $etikett, (string) ($rumpf['modell'] ?? ''), $referenzBild);

if ($kennung === null) {
    fehlerSenden(503, 'Das Bier liess sich nicht ablegen.',
        'Steht die Datenbank? Der Zwischenspeicher ist womöglich abgeschaltet.');
}

// Das Foto, das eben noch zu keinem Bier gehörte, gehört jetzt zu diesem.
// Ohne diesen Nachtrag bliebe die Galerie eines neu aufgenommenen Biers
// ausgerechnet beim ersten Mal leer.
bildZuBierNachtragen((string) ($rumpf['pruefsumme'] ?? ''), $kennung);

// Die Farbsignatur des Referenzfotos — hier und nirgends sonst, denn hier
// steht fest, welches Foto von nun an für dieses Bier steht.
//
// Ohne sie wäre das Bier für die Wiedererkennung halb blind: Es liesse sich
// nur noch über den abgelesenen Namen finden, und genau darauf ist kein
// Verlass. Scheitert die Rechnung, ist das kein Grund, den Eintrag
// abzulehnen — die Suche fällt für dieses Bier auf den alten Weg zurück.
if ($referenzBild !== '') {
    $signatur = signaturBerechnen(
        konfiguration()['bilder']['verzeichnis'] . '/' . $referenzBild,
    );

    if ($signatur !== null) {
        signaturSpeichern($kennung, $signatur['signatur'], $signatur['farben']);
    }
}

// Die Einzeichnungen: je Element das Referenzfoto mit einem Rahmen darum.
// Genau hier und nirgends sonst — es ist der eine Augenblick, in dem ein
// Bier neu in die Datenbank kommt. Alles Spätere liest nur noch.
elementbilderErzeugen($kennung, $referenzBild, $etikett['elemente']);

// Zum Hoster spiegeln, solange der Eintrag frisch ist. Scheitert es, holt
// es der nächste Abgleich nach — der Scan bleibt davon unberührt.
bierSpiegeln($kennung);

antwortSenden(200, [
    'id' => $kennung,
    'bilder' => bilderZuBier($kennung),
]);
