<?php

declare(strict_types=1);

/**
 * POST /api/erweitert.php
 *
 * Nimmt dasselbe Foto entgegen und gibt die erweiterte Sicht zurück:
 * Brauart, Speisen, Verkostung, verwandte Biere.
 *
 * Anfrage:  { "bild": "<base64>", "typ": "image/jpeg" }
 * Antwort:  { "erweitert": {…}, "quelle": "speicher"|"modell", "dauer_ms": 1234 }
 * Fehler:   { "fehler": "…", "rat": "…" }
 *
 * Ein eigener Aufruf, damit die Reiter unabhängig von der Zerlegung
 * scheitern können: Geht hier etwas schief, bleibt die Etikettzerlegung
 * stehen und nur die Reiter bleiben leer.
 *
 * Er läuft NACH etikett.php, nicht daneben. Das war einmal anders gedacht —
 * zwei Aufrufe nebeneinander lassen den Leser einmal warten statt zweimal.
 * Nur bringt das hier nichts: Der Dienst vor dem Modell lässt ohnehin nur
 * eine Inferenz zur Zeit durch (gemessen: zwei parallele Aufrufe brauchen
 * exakt doppelt so lang wie einer). Nebeneinander gestartet warten sie also
 * bloss aufeinander.
 *
 * Nacheinander ist dann sogar schneller, denn dieser Endpunkt kann sich
 * einen ganzen Modellaufruf sparen: Welches Bier auf dem Foto ist, hat
 * etikett.php gerade bestimmt und ins Scan-Protokoll geschrieben. Über die
 * Prüfsumme des Bildes findet sich das wieder — ohne noch einmal abzulesen.
 *
 * Ins Scan-Protokoll schreibt dieser Endpunkt bewusst nicht: Sonst zählte
 * jeder Scan doppelt und die Frage "wie oft hat der Zwischenspeicher
 * getroffen?" wäre nicht mehr zu beantworten.
 */

require_once __DIR__ . '/intern/pforte.php';

herkunftPruefen();
nurPost();

$begonnen = hrtime(true);
$bild = bildAusRumpf(rumpfLesen());
$llm = konfiguration()['llm'];

$dauer = static fn (): int => (int) ((hrtime(true) - $begonnen) / 1_000_000);

/* --- Der kurze Weg: Was hat etikett.php zu diesem Foto festgestellt? ----- */

$bekannt = bierZuScan($bild->pruefsumme);

if ($bekannt !== null && is_array($bekannt['erweitert'])) {
    antwortSenden(200, [
        'erweitert' => $bekannt['erweitert'],
        'quelle' => 'speicher',
        'dauer_ms' => $dauer(),
    ]);
}

if ($bekannt !== null) {
    // Das Bier ist bekannt, die erweiterte Sicht dazu noch nicht. Ein
    // Modellaufruf, kein Ablesen.
    $erweitert = modellFragen(ERWEITERT_ANWEISUNG, ERWEITERT_FRAGE, schemaErweitert(), $bild->base64);
    erweitertSpeichernZuKennung($bekannt['id'], $erweitert);

    antwortSenden(200, [
        'erweitert' => $erweitert,
        'quelle' => 'modell',
        'dauer_ms' => $dauer(),
    ]);
}

/* --- Der Rückfallweg: selbst ablesen ------------------------------------ */

// Hierher führen drei Wege: Die Datenbank antwortet nicht, etikett.php ist
// zu diesem Foto nie gelaufen, oder es hat kein Bier erkannt. In allen drei
// Fällen muss dieser Endpunkt für sich allein zurechtkommen — er ist keiner,
// der ohne einen anderen nicht kann.
$erkennung = erkennen($bild);

$schluessel = $erkennung['ist_bier']
    ? schluesselBilden($erkennung['brauerei'], $erkennung['name'])
    : '';

$treffer = bierLaden($schluessel);

if ($treffer !== null && is_array($treffer['erweitert'])) {
    antwortSenden(200, [
        'erweitert' => $treffer['erweitert'],
        'quelle' => 'speicher',
        'dauer_ms' => $dauer(),
    ]);
}

$erweitert = modellFragen(ERWEITERT_ANWEISUNG, ERWEITERT_FRAGE, schemaErweitert(), $bild->base64);

// Abgelegt wird unter dem Schlüssel der ersten Stufe — demselben, unter dem
// etikett.php ablegt und unter dem beide nachschlagen. Nur wenn Ablegen und
// Nachschlagen denselben Schlüssel benutzen, wird je etwas gefunden.
if ($schluessel !== '') {
    erweitertSpeichern(
        $schluessel,
        $erkennung['brauerei'],
        $erkennung['name'],
        $erweitert,
        $llm['modell'],
    );
}

antwortSenden(200, [
    'erweitert' => $erweitert,
    'quelle' => 'modell',
    'dauer_ms' => $dauer(),
]);
