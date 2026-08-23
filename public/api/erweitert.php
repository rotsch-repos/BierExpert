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
 * Ein eigener Aufruf, damit er neben der Etikettzerlegung laufen kann. Beide
 * zusammen in einem Aufruf wären nacheinander an der Reihe; nebeneinander
 * wartet der Leser einmal statt zweimal. Und scheitert dieser hier, steht
 * die Zerlegung trotzdem — die Reiter bleiben dann eben leer.
 *
 * Er schlägt selbst nach, statt sich auf die Zerlegung zu verlassen: Die
 * kennt zu diesem Zeitpunkt noch niemand, sie läuft ja gerade. Das kostet
 * einen zweiten Aufruf beim kleinen Modell und erspart die Serialisierung.
 *
 * Ins Scan-Protokoll schreibt dieser Endpunkt bewusst nicht — sonst zählte
 * jeder Scan doppelt und die Frage "wie oft hat der Zwischenspeicher
 * getroffen?" wäre nicht mehr zu beantworten. Das übernimmt etikett.php.
 */

require_once __DIR__ . '/intern/pforte.php';

herkunftPruefen();
nurPost();

$begonnen = hrtime(true);
$bild = bildAusRumpf(rumpfLesen());
$llm = konfiguration()['llm'];

$dauer = static fn (): int => (int) ((hrtime(true) - $begonnen) / 1_000_000);

/* --- Erste Stufe: ablesen ------------------------------------------------ */

$erkennung = erkennen($bild);

$schluessel = $erkennung['ist_bier']
    ? schluesselBilden($erkennung['brauerei'], $erkennung['name'])
    : '';

/* --- Nachschlagen -------------------------------------------------------- */

$treffer = bierLaden($schluessel);

if ($treffer !== null && is_array($treffer['erweitert'])) {
    antwortSenden(200, [
        'erweitert' => $treffer['erweitert'],
        'quelle' => 'speicher',
        'dauer_ms' => $dauer(),
    ]);
}

/* --- Fehlschlag: das grosse Modell ans Werk ------------------------------ */

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
