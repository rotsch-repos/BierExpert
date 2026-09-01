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
$rumpf = rumpfLesen();
$bild = bildAusRumpf($rumpf);
$llm = konfiguration()['llm'];

// Hat der Leser eine Rückfrage bejaht, reist die Kennung des bestätigten
// Biers mit. Der Dirigent bewertet sie nicht — er reicht sie an den Dienst
// durch, wo die Datenbank steht und wo sie geprüft werden kann.
$bestaetigt = (int) ($rumpf['bestaetigt_id'] ?? 0);

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

/* --- Der Weg über den Nachschlage-Dienst ---------------------------------- */

// Steht eine Dienstadresse in der Konfiguration, liegen Modell und
// Bierdatenbank nicht hier, sondern auf der Workstation hinter dem Tunnel.
// Diese Anlage dirigiert dann nur: Sie fragt dort "kenne ich das Bier?" und
// bemüht die bezahlte API allein bei einem Fehlschlag.
//
// Der Rest der Datei bleibt der Weg für eine Anlage, die alles selbst hat.
// Beide Wege enden in derselben Antwort — was der Leser bekommt, hängt
// nicht davon ab, wo gerechnet wurde.
if (dienstAktiv()) {
    stromStufe('erkennung');
    stromAktiv() && stromZeile(['stufe' => 'erkennung']);

    $befund = dienstFragen('nachschlagen.php', [
        'bild' => $bild->base64,
        'typ' => $bild->medienTyp,
        'bestaetigt_id' => $bestaetigt,
    ]);

    $gelesen = is_array($befund['gelesen'] ?? null) ? $befund['gelesen'] : [];

    stromAktiv() && stromZeile([
        'stufe' => 'erkannt',
        'ist_bier' => (bool) ($gelesen['ist_bier'] ?? true),
        'brauerei' => (string) ($gelesen['brauerei'] ?? ''),
        'name' => (string) ($gelesen['name'] ?? ''),
        'sicherheit' => (string) ($gelesen['sicherheit'] ?? ''),
    ]);

    if (($befund['gefunden'] ?? false) === true && is_array($befund['etikett'] ?? null)) {
        // Auch hier durch die Reinigung: Die Zerlegung kam über das Netz,
        // und was über das Netz kam, ist nicht deshalb wohlgeformt, weil es
        // von der eigenen Gegenstelle stammt.
        $etikett = etikettSaeubern($befund['etikett']);

        stromAktiv() && stromZeile([
            'stufe' => 'gefunden',
            'quelle' => 'speicher',
            'brauerei' => $etikett['brauerei'],
            'name' => $etikett['name'],
            'stil' => $etikett['stil'],
        ]);

        antwortSenden(200, [
            'etikett' => $etikett,
            'bilder' => bilderListe($befund['bilder'] ?? null),
            'quelle' => 'speicher',
            'dauer_ms' => $dauer(),
        ]);
    }

    /* --- Vermutung: fragen, bevor gezahlt wird ---------------------------- */

    // Der Dienst hält dieses Bier für ein bekanntes, ist sich aber nicht
    // sicher genug. Hier endet der Aufruf — ohne Zerlegung, ohne Kosten.
    //
    // Der Leser sieht sein Etikett und das gespeicherte Referenzfoto
    // nebeneinander und entscheidet in einer Sekunde, wofür keine Menge an
    // Signalen reicht. Sagt er ja, kommt dieselbe Anfrage mit bestaetigt_id
    // zurück und wird zum gewöhnlichen Treffer; sagt er nein, kommt sie ohne
    // und läuft in die Zerlegung darunter.
    if (is_array($befund['vermutung'] ?? null)) {
        $vermutung = vermutungSaeubern($befund['vermutung']);

        if ($vermutung !== null) {
            stromAktiv() && stromZeile([
                'stufe' => 'vermutung',
                'brauerei' => $vermutung['brauerei'],
                'name' => $vermutung['name'],
            ]);

            antwortSenden(200, [
                'vermutung' => $vermutung,
                'quelle' => 'vermutung',
                'dauer_ms' => $dauer(),
            ]);
        }
    }

    /* --- Fehlschlag: die bezahlte API, und danach zurückmelden ------------ */

    stromStufe('auswertung');
    stromAktiv() && stromZeile(['stufe' => 'auswertung', 'anbieter' => $llm['anbieter_tief']]);

    $etikett = etikettSaeubern(
        modellFragen(ETIKETT_ANWEISUNG, ETIKETT_FRAGE, schemaEtikett(), $bild->base64),
    );

    $bilder = [];

    if ($etikett['erkannt']) {
        // Zurückmelden, damit das Kompendium wächst. Scheitert es, ist die
        // Auskunft an den Leser trotzdem vollständig — nur beim nächsten
        // Foto desselben Biers fiele wieder ein bezahlter Aufruf an.
        // Deshalb ins Log und nicht in die Antwort.
        try {
            $gemerkt = dienstFragen('merken.php', [
                'schluessel' => (string) ($befund['schluessel'] ?? ''),
                'pruefsumme' => (string) ($befund['pruefsumme'] ?? $bild->pruefsumme),
                'etikett' => $etikett,
                'modell' => $llm['anbieter_tief'] === 'anthropic'
                    ? $llm['anthropic_modell']
                    : $llm['modell'],
            ]);
            $bilder = bilderListe($gemerkt['bilder'] ?? null);
        } catch (BierFehler $fehler) {
            error_log('BierExpert: Zerlegung nicht zurückgemeldet — ' . $fehler->getMessage());
        }
    }

    antwortSenden(200, [
        'etikett' => $etikett,
        'bilder' => $bilder,
        'quelle' => 'modell',
        'dauer_ms' => $dauer(),
    ]);
}

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

// Das Foto aufbewahren — gleich ob das Bier bekannt ist. Gerade die Fotos
// zu noch unbekannten Bieren zählen: Sobald das grosse Modell das Etikett
// zerlegt hat, gehören sie zu diesem Bier.
$bildDatei = bildAblegen($bild);

/* --- Nachschlagen -------------------------------------------------------- */

$treffer = bierLaden($schluessel);

// Ein Eintrag ohne Elemente ist ein Torso: Er entstand aus einem Aufruf,
// der nur die erweiterte Sicht geholt hat. Für die Zerlegung taugt er nicht.
if ($treffer !== null && $treffer['etikett']['elemente'] !== []) {
    // Durch die Reinigung, wie auf dem Dienst-Weg auch. Ohne sie ging der
    // Eintrag hier roh an den Browser — samt referenz_bereich, dem internen
    // Anker der Registrierung, von dem speicher.php ausdrücklich verspricht,
    // er verlasse die Anlage nie. bereicheFuerFoto weiter unten bekommt den
    // ungereinigten $treffer und behält so, was es zum Registrieren braucht.
    $etikett = etikettSaeubern($treffer['etikett']);

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
        'modell' => modellSchnellName($llm),
    ]);

    antwortSenden(200, [
        'etikett' => $etikett,
        // Die Fotos, die andere von diesem Bier gemacht haben.
        'bilder' => bilderZuBier($treffer['id']),
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
    // Das Foto dieses Scans wird zum Referenzfoto des Biers: Die Rahmen aus
    // der Zerlegung beziehen sich darauf, und an ihnen richtet die
    // Registrierung später jede weitere Aufnahme aus.
    $bierId = bierSpeichern($schluessel, $etikett, $llm['modell'], (string) $bildDatei);

    // Die Einzeichnungen entstehen beim Aufnehmen, nicht beim Abrufen:
    // einmal je Bier, danach werden sie nur noch ausgeliefert.
    if ($bierId !== null && $bildDatei !== null) {
        elementbilderErzeugen($bierId, $bildDatei, $etikett['elemente']);
    }
}

scanProtokollieren([
    'pruefsumme' => $bild->pruefsumme,
    'bild_datei' => $bildDatei,
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
    // Beim ersten Fund ist das gerade hochgeladene Foto das einzige — und
    // genau deshalb steht es hier: Ohne diese Zeile bliebe die Galerie
    // ausgerechnet beim ersten Mal leer.
    'bilder' => $bierId === null ? [] : bilderZuBier($bierId),
    'quelle' => 'modell',
    'dauer_ms' => $dauer(),
]);

/**
 * Macht aus dem, was der Dienst als Bilderliste schickte, eine geprüfte.
 *
 * Adressen aus einer fremden Antwort landen unbesehen im href eines
 * Bildes. Sie deshalb hier auf http(s) einzugrenzen kostet nichts und
 * schliesst aus, dass eine verunglückte oder untergeschobene Antwort ein
 * "javascript:" in die Seite trägt.
 *
 * @return list<string>
 */
function bilderListe(mixed $roh): array
{
    if (!is_array($roh)) {
        return [];
    }

    $sauber = [];

    foreach ($roh as $adresse) {
        if (is_string($adresse) && preg_match('#^https?://#', $adresse) === 1) {
            $sauber[] = $adresse;
        }
    }

    return $sauber;
}
