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

// Derselbe Strom wie in etikett.php, und aus demselben Grund.
//
// Er fehlte hier — und das war der teuerste Unterschied zwischen den beiden
// Endpunkten. etikett.php bekam den Pulsschlag ausdruecklich, damit
// Cloudflare nicht die Zeit bis zur Antwort zaehlt, sondern nur die Stille
// zwischen zwei Zeilen. Dieser Aufruf dauert genauso lange — 60 bis 90
// Sekunden, wenn die erweiterte Sicht neu geholt werden muss — und schwieg
// dabei von Anfang bis Ende.
//
// Am 31.08. genau daran gescheitert: Roger sah "Der Server war nicht
// erreichbar", waehrend der Server in Ruhe fertigrechnete und das Ergebnis
// ablegte. Es war alles da; nur die Leitung war weg. Ein Fehler, der die
// Arbeit nicht verhindert, sondern nur ihre Zustellung — und der sich am
// Handy im Mobilnetz zuverlaessig zeigt und am Schreibtisch nie.
if (stromGewuenscht()) {
    stromBeginnen();
    stromZeile(['stufe' => 'laden']);
}

/* --- Der Weg über den Nachschlage-Dienst --------------------------------- */

// Liegt die Datenbank nicht hier, liegt auch die erweiterte Sicht nicht
// hier. Ohne diesen Zweig arbeitete dieser Endpunkt gegen die Datenbank,
// die er zufällig vorfand — beim Hoster also gegen Hostpoints eigene, in
// der seit dem Umzug nichts mehr steht, was zählt. Er fand nie etwas, rief
// für JEDEN Scan die bezahlte API und legte das Ergebnis dort ab, wo es im
// Betrieb niemand mehr liest.
//
// Gefragt wird nur mit der Prüfsumme: Welches Bier auf dem Foto ist, hat
// nachschlagen.php längst festgestellt. Das Bild noch einmal über den
// Tunnel zu schicken, um es ein zweites Mal ablesen zu lassen, wäre ein
// Modellaufruf für eine Auskunft, die schon dasteht.
if (dienstAktiv()) {
    try {
        $befund = dienstFragen('erweitert-nachschlagen.php', [
            'pruefsumme' => $bild->pruefsumme,
        ]);

        if (($befund['gefunden'] ?? false) === true && is_array($befund['erweitert'] ?? null)) {
            antwortSenden(200, [
                'erweitert' => $befund['erweitert'],
                'quelle' => 'speicher',
                'dauer_ms' => $dauer(),
            ]);
        }
    } catch (BierFehler $fehler) {
        error_log('BierExpert: Erweitert-Nachschlag fehlgeschlagen — ' . $fehler->getMessage());

        // Hier stand einmal "kein Grund aufzugeben: die bezahlte API kann
        // die Auskunft geben, sie kostet nur". Roger hat das gestrichen —
        // "sie kostet nur" ist bei einem längeren Ausfall keine Fussnote,
        // sondern eine offene Rechnung je Besucher-Scan. Im Ausfall gibt es
        // nur noch, was die eigene Datenbank umsonst hergibt: Der kurze Weg
        // unten schlägt über die Prüfsumme nach — der Spiegel hat die
        // erweiterte Sicht bekannter Biere ja hierher gelegt. Findet er
        // nichts, macht der Braumeister Pause.
        $bekannt = bierZuScan($bild->pruefsumme);

        if ($bekannt !== null && is_array($bekannt['erweitert'])) {
            antwortSenden(200, [
                'erweitert' => $bekannt['erweitert'],
                'quelle' => 'speicher',
                'dauer_ms' => $dauer(),
            ]);
        }

        throw braumeisterPause();
    }

    stromStufe('auswertung');
    stromAktiv() && stromZeile(['stufe' => 'auswertung', 'anbieter' => $llm['anbieter_tief']]);

    $erweitert = modellFragen(
        ERWEITERT_ANWEISUNG,
        ERWEITERT_FRAGE,
        schemaErweitert(),
        $bild->base64,
    );

    // Zurückmelden, damit es das letzte Mal war. Scheitert es, ist die
    // Auskunft an den Leser trotzdem vollständig — nur beim nächsten Foto
    // desselben Biers fiele wieder ein bezahlter Aufruf an. Deshalb ins
    // Log und nicht in die Antwort.
    try {
        dienstFragen('erweitert-merken.php', [
            'pruefsumme' => $bild->pruefsumme,
            'erweitert' => $erweitert,
        ]);
    } catch (BierFehler $fehler) {
        error_log('BierExpert: Erweiterte Sicht nicht zurückgemeldet — ' . $fehler->getMessage());
    }

    antwortSenden(200, [
        'erweitert' => $erweitert,
        'quelle' => 'modell',
        'dauer_ms' => $dauer(),
    ]);
}

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
    stromStufe('auswertung');
    stromAktiv() && stromZeile(['stufe' => 'auswertung', 'anbieter' => $llm['anbieter_tief']]);

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

stromStufe('auswertung');
    stromAktiv() && stromZeile(['stufe' => 'auswertung', 'anbieter' => $llm['anbieter_tief']]);

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
