<?php

declare(strict_types=1);

/**
 * POST /api/etikett.php
 *
 * Nimmt ein Foto entgegen und gibt die Zerlegung des Etiketts zurück.
 *
 * Anfrage:  { "bild": "<base64>", "typ": "image/jpeg" }
 * Antwort:  { "etikett": {…}, "quelle": "speicher"|"modell", "dauer_ms": 1234 }
 * Fehler:   { "fehler": "…", "rat": "…" }
 *
 * Der Ablauf steht in intern/ablauf.php: erst ablesen, dann nachschlagen,
 * und nur wenn das Bier unbekannt ist, das grosse Modell bemühen.
 */

require_once __DIR__ . '/intern/pforte.php';

herkunftPruefen();
nurPost();

$begonnen = hrtime(true);
$bild = bildAusRumpf(rumpfLesen());
$llm = konfiguration()['llm'];

// Erst hier, nicht früher: Bis zu dieser Zeile kann die Anfrage noch mit
// einem ehrlichen Statuscode abgewiesen werden — zu gross, kein Bild, kein
// POST. Ist der Strom einmal offen, steht der Status unwiderruflich auf 200
// und jeder Fehler muss als Zeile hinterhergeschickt werden. Diese Wahl so
// spät wie möglich zu treffen, kostet nichts und erhält die klaren Fehler.
if (stromGewuenscht()) {
    stromBeginnen();

    // Das erste Byte, und der Grund für den ganzen Strom: Ab jetzt zählt
    // Cloudflares Grenze nicht mehr die Zeit bis zur Antwort, sondern nur
    // noch die Stille zwischen zwei Zeilen.
    stromZeile(['stufe' => 'laden']);
}

/** Vergangene Zeit in Millisekunden. */
$dauer = static fn (): int => (int) ((hrtime(true) - $begonnen) / 1_000_000);

/* --- Erste Stufe: ablesen ------------------------------------------------ */

stromStufe('erkennung');
stromAktiv() && stromZeile(['stufe' => 'erkennung']);

$erkennung = erkennen($bild);

// Das erste echte Zwischenergebnis. Es ist keine Beschäftigung des Lesers,
// sondern eine Auskunft, die er sonst erst am Ende bekäme: Der Name des
// Biers steht damit auf dem Schirm, während die Zerlegung noch läuft.
stromAktiv() && stromZeile([
    'stufe' => 'erkannt',
    'ist_bier' => $erkennung['ist_bier'],
    'brauerei' => $erkennung['brauerei'],
    'name' => $erkennung['name'],
    'sicherheit' => $erkennung['sicherheit'],
]);

$schluessel = $erkennung['ist_bier']
    ? schluesselBilden($erkennung['brauerei'], $erkennung['name'])
    : '';

/* --- Nachschlagen -------------------------------------------------------- */

$treffer = bierLaden($schluessel);

// Ein Eintrag ohne Elemente ist ein Torso: Er entstand aus einem Aufruf,
// der nur die erweiterte Sicht geholt hat. Für die Zerlegung taugt er nicht.
if ($treffer !== null && $treffer['etikett']['elemente'] !== []) {
    $etikett = $treffer['etikett'];

    // Die beiden aufnahmebezogenen Felder kommen nicht aus der Datenbank.
    // "sicherheit" sagt, wie gut lesbar DIESES Foto war — dafür ist die
    // erste Stufe die einzige ehrliche Quelle.
    $etikett['sicherheit'] = $erkennung['sicherheit'];
    // "hinweis" nennt, was auf DIESEM Foto unleserlich war. Der Vermerk der
    // früheren Auswertung galt einem anderen Foto und wäre hier eine
    // Behauptung über etwas, das niemand angesehen hat. Woher die Auskunft
    // stammt, sagt "quelle" — das ist keine Unsicherheit, sondern Herkunft.
    $etikett['hinweis'] = '';

    // Beim Treffer ist der Stil schon bekannt — er steht in der Datenbank.
    // Damit kann die Anzeige beim Warten etwas Wahres sagen ("ein Doppelbock")
    // statt einer Floskel.
    stromAktiv() && stromZeile([
        'stufe' => 'gefunden',
        'quelle' => 'speicher',
        'brauerei' => $etikett['brauerei'] ?? '',
        'name' => $etikett['name'] ?? '',
        'stil' => $etikett['stil'] ?? '',
    ]);

    stromStufe('verorten');
    stromAktiv() && stromZeile(['stufe' => 'verorten', 'elemente' => count($etikett['elemente'])]);

    // Die Rahmen für DIESES Foto neu bestimmen. Gespeicherte sässen daneben.
    $bereiche = verorten($bild, array_column($etikett['elemente'], 'bezeichnung'));
    foreach ($etikett['elemente'] as $nummer => $element) {
        if (isset($bereiche[$element['bezeichnung']])) {
            $etikett['elemente'][$nummer]['bereich'] = $bereiche[$element['bezeichnung']];
        }
    }

    scanProtokollieren([
        'pruefsumme' => $bild->pruefsumme,
        'bier_id' => $treffer['id'],
        'aus_speicher' => true,
        'gelesen_brauerei' => $erkennung['brauerei'],
        'gelesen_name' => $erkennung['name'],
        'sicherheit' => $erkennung['sicherheit'],
        'dauer_ms' => $dauer(),
        'modell' => $llm['modell_schnell'],
    ]);

    antwortSenden(200, [
        'etikett' => $etikett,
        'quelle' => 'speicher',
        'dauer_ms' => $dauer(),
    ]);
}

/* --- Fehlschlag: das grosse Modell ans Werk ------------------------------ */

// Bewusst KEINE Abkürzung, wenn die erste Stufe "kein Bier" meldet: Das
// kleine Modell ist schnell, nicht unfehlbar. Über "erkannt" entscheidet
// das grosse — ein zu Unrecht abgewiesenes Foto wäre der ärgerlichere
// Fehler als ein überflüssiger Aufruf.
stromStufe('auswertung');
stromAktiv() && stromZeile([
    'stufe' => 'auswertung',
    // Ehrlich benennen, worauf gewartet wird: Ein unbekanntes Etikett geht
    // an das grosse Modell, und das dauert länger als alles davor.
    'anbieter' => $llm['anbieter_tief'],
]);

try {
    $roh = modellFragen(ETIKETT_ANWEISUNG, ETIKETT_FRAGE, schemaEtikett(), $bild->base64);
} catch (BierFehler $fehler) {
    // Auch der Fehlschlag gehört ins Protokoll — sonst sieht die Statistik
    // später nur die geglückten Scans und damit zu rosig aus.
    scanProtokollieren([
        'pruefsumme' => $bild->pruefsumme,
        'aus_speicher' => false,
        'gelesen_brauerei' => $erkennung['brauerei'],
        'gelesen_name' => $erkennung['name'],
        'sicherheit' => $erkennung['sicherheit'],
        'dauer_ms' => $dauer(),
        'modell' => $llm['modell'],
        'fehler' => $fehler->getMessage(),
    ]);
    throw $fehler;
}

$etikett = etikettSaeubern($roh);

// Abgelegt wird unter DEM SCHLÜSSEL DER ERSTEN STUFE — nicht unter dem, was
// das grosse Modell gelesen hat.
//
// Das ist der entscheidende Punkt am ganzen Zwischenspeicher: Nachgeschlagen
// wird immer mit dem, was die erste Stufe abliest. Legte man unter etwas
// anderem ab, würde nie etwas gefunden. Und die beiden Lesarten gehen
// systematisch auseinander: Auf dem Etikett steht "TANNEN ZÄPFLE", das
// grosse Modell schreibt "Tannenzäpfle Pils" — es ergänzt den Stil aus
// seinem Wissen. Unter dieser Fassung abgelegt wäre der Eintrag beim
// nächsten Foto unauffindbar.
//
// Was das grosse Modell gelesen hat, steht trotzdem in der Zeile: als
// brauerei und name, also als das, was dem Leser angezeigt wird. Nur der
// Schlüssel darunter ist der der ersten Stufe.
$bierId = null;
if ($etikett['erkannt']) {
    $bierId = bierSpeichern($schluessel, $etikett, $llm['modell']);
}

scanProtokollieren([
    'pruefsumme' => $bild->pruefsumme,
    'bier_id' => $bierId,
    'aus_speicher' => false,
    'gelesen_brauerei' => $erkennung['brauerei'],
    'gelesen_name' => $erkennung['name'],
    'sicherheit' => $etikett['sicherheit'],
    'hinweis' => $etikett['hinweis'],
    'dauer_ms' => $dauer(),
    'modell' => $llm['modell'],
]);

antwortSenden(200, [
    'etikett' => $etikett,
    'quelle' => 'modell',
    'dauer_ms' => $dauer(),
]);
