<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Ablauf eines Scans — und das Geradeziehen dessen, was zurückkommt.
 *
 * Zwei Stufen, aus einem Grund: Das grosse Modell mit Bildverständnis über
 * ein ganzes Etikett laufen zu lassen kostet auf eigener Hardware Minuten.
 * Die Frage "welches Bier ist das überhaupt?" beantwortet ein kleines Modell
 * in Sekunden. Steht die Antwort schon in der Datenbank, war das der ganze
 * Aufwand.
 *
 *   1. Ablesen (klein)   → Brauerei und Name
 *   2. Nachschlagen      → Treffer?
 *      ja  → Verorten (klein): die bekannten Elemente in DIESEM Foto finden
 *      nein→ Zerlegen (gross): alles, einschliesslich Bildbereichen
 *
 * Die Grammatik erzwingt die Form der Antwort, nicht ihren Sinn. Ein
 * Bildbereich mit x = 4.7 ist formal gültig und zeigt trotzdem ins Leere.
 * Deshalb wird hier alles geradegezogen, bevor es das Haus verlässt.
 */

/**
 * Erste Stufe: Wer hat es gebraut, und wie hiess es?
 *
 * @return array{ist_bier:bool, brauerei:string, name:string, sicherheit:string}
 */
function erkennen(Bild $bild): array
{
    $roh = modellFragen(
        ERKENNUNG_ANWEISUNG,
        'Hier ist das Foto. Lies Brauerei und Name ab.',
        schemaErkennung(),
        $bild->base64,
        schnell: true,
    );

    return [
        'ist_bier' => (bool) ($roh['ist_bier'] ?? true),
        'brauerei' => text($roh['brauerei'] ?? ''),
        'name' => text($roh['name'] ?? ''),
        'sicherheit' => sicherheit($roh['sicherheit'] ?? ''),
    ];
}

/**
 * Die Rahmen für DIESES Foto — erst rechnen, dann fragen.
 *
 * Zwei Wege zum selben Ziel, in dieser Reihenfolge:
 *
 *   1. Registrierung. Liegt ein Referenzfoto samt Rahmen vor, lässt sich
 *      die Abbildung zwischen beiden Fotos aus den Bildern selbst
 *      bestimmen und die Rahmen durchreichen. Rund 100 ms, ohne GPU, mit
 *      einem Vertrauensmass obendrein.
 *   2. Das Modell. Trägt die Abbildung nicht — anderes Etikett, zu wenig
 *      Übereinstimmung, kein Referenzfoto —, sucht das kleine Modell die
 *      Elemente wie bisher. Rund 2500 ms.
 *
 * Der zweite Weg bleibt, weil der erste eine Voraussetzung hat, die nicht
 * immer erfüllt ist. Ein Bier, das vor der Registrierung aufgenommen wurde,
 * hat kein Referenzfoto; und eine Abbildung, der man nicht trauen kann,
 * ist schlechter als keine.
 *
 * @param  array{referenz_bild?:string, etikett:array} $treffer
 * @return array<string, array{x:float,y:float,breite:float,hoehe:float}>
 */
function bereicheFuerFoto(Bild $bild, array $treffer): array
{
    $elemente = $treffer['etikett']['elemente'] ?? [];

    $registriert = registrierungVersuchen(
        $bild,
        (string) ($treffer['referenz_bild'] ?? ''),
        is_array($elemente) ? $elemente : [],
    );

    if ($registriert !== null) {
        return $registriert;
    }

    return verorten($bild, array_column($elemente, 'bezeichnung'));
}

/**
 * Treffer-Stufe: die gespeicherten Elemente in diesem Foto wiederfinden.
 *
 * Scheitert dieser Aufruf, ist das kein Grund, den ganzen Scan fallen zu
 * lassen — die Zerlegung steht ja, es fehlen nur die Markierungen. Deshalb
 * gibt die Funktion im Fehlerfall eine leere Zuordnung zurück, statt zu
 * werfen. Der Leser bekommt dann die Texte ohne Rahmen auf der Flasche.
 *
 * @param  list<string> $bezeichnungen
 * @return array<string, array{x:float,y:float,breite:float,hoehe:float}>
 */
function verorten(Bild $bild, array $bezeichnungen): array
{
    if ($bezeichnungen === []) {
        return [];
    }

    $liste = '';
    foreach ($bezeichnungen as $nummer => $bezeichnung) {
        $liste .= ($nummer + 1) . '. ' . $bezeichnung . "\n";
    }

    try {
        $roh = modellFragen(
            VERORTUNG_ANWEISUNG,
            "Hier ist das Foto. Finde diese Elemente darauf:\n\n" . $liste,
            schemaVerortung(),
            $bild->base64,
            schnell: true,
        );
    } catch (BierFehler $fehler) {
        error_log('BierExpert: Verortung fehlgeschlagen — ' . $fehler->getMessage());
        return [];
    }

    $bereiche = [];
    $eintraege = is_array($roh['bereiche'] ?? null) ? array_values($roh['bereiche']) : [];

    // Der Rückfall auf die Reihenfolge greift nur, wenn zu jedem vorgegebenen
    // Element genau ein Eintrag zurückkam. Sonst wäre er gefährlich: Hat das
    // Modell einen Eintrag ausgelassen oder einen dazuerfunden, verschiebt
    // sich alles Folgende um eins — und dann sitzt jede Markierung auf dem
    // falschen Element. Ein fehlender Rahmen ist harmlos, ein falscher nicht.
    $reihenfolgeVerlaesslich = count($eintraege) === count($bezeichnungen);

    foreach ($eintraege as $nummer => $eintrag) {
        if (!is_array($eintrag)) {
            continue;
        }

        if (($eintrag['gefunden'] ?? true) === false) {
            continue; // Auf diesem Foto nicht zu sehen — dann auch kein Rahmen.
        }

        // Vorrangig über die Bezeichnung zuordnen: Sie ist das einzige, was
        // Eintrag und Element zweifelsfrei verbindet.
        $bezeichnung = text($eintrag['bezeichnung'] ?? '');
        if (!in_array($bezeichnung, $bezeichnungen, true)) {
            if (!$reihenfolgeVerlaesslich) {
                continue;
            }
            $bezeichnung = $bezeichnungen[$nummer] ?? '';
        }
        if ($bezeichnung === '') {
            continue;
        }

        $bereiche[$bezeichnung] = bereich($eintrag);
    }

    return $bereiche;
}

/**
 * Zieht eine Etikettantwort gerade.
 *
 * Was das Modell liefert, folgt dem Schema. Ob die Zahlen darin einen Sinn
 * ergeben, steht auf einem anderen Blatt.
 */
function etikettSaeubern(array $roh): array
{
    $elemente = [];
    foreach (array_values(is_array($roh['elemente'] ?? null) ? $roh['elemente'] : []) as $element) {
        if (!is_array($element)) {
            continue;
        }
        $bezeichnung = text($element['bezeichnung'] ?? '');
        if ($bezeichnung === '') {
            continue; // Ein Element ohne Namen lässt sich weder anzeigen noch zuordnen.
        }
        $elemente[] = [
            'bezeichnung' => $bezeichnung,
            'position' => text($element['position'] ?? ''),
            'beschreibung' => text($element['beschreibung'] ?? ''),
            'bedeutung' => text($element['bedeutung'] ?? ''),
            'bereich' => bereich(is_array($element['bereich'] ?? null) ? $element['bereich'] : []),
            // Die fertige Einzeichnung, sofern eine gespeichert ist. Sie
            // kommt aus der Datenbank und nicht vom Modell — geprüft wird
            // sie trotzdem: Diese Adresse landet unbesehen im src eines
            // Bildes, und der Weg hierher führt bei der Aufteilung über
            // das Netz.
            'bild' => bildAdresse($element['bild'] ?? null),
        ];
    }

    $gespraechsstoff = [];
    foreach (array_values(is_array($roh['gespraechsstoff'] ?? null) ? $roh['gespraechsstoff'] : []) as $satz) {
        $satz = text($satz);
        if ($satz !== '') {
            $gespraechsstoff[] = $satz;
        }
    }

    return [
        'erkannt' => (bool) ($roh['erkannt'] ?? true),
        'sicherheit' => sicherheit($roh['sicherheit'] ?? ''),
        'name' => textOderUnbekannt($roh['name'] ?? ''),
        'brauerei' => textOderUnbekannt($roh['brauerei'] ?? ''),
        'ort' => textOderUnbekannt($roh['ort'] ?? ''),
        'land' => textOderUnbekannt($roh['land'] ?? ''),
        'gegruendet' => textOderUnbekannt($roh['gegruendet'] ?? ''),
        'stil' => textOderUnbekannt($roh['stil'] ?? ''),
        'stammwuerze' => textOderUnbekannt($roh['stammwuerze'] ?? ''),
        'alkohol' => textOderUnbekannt($roh['alkohol'] ?? ''),
        'elemente' => $elemente,
        'farbwahl' => text($roh['farbwahl'] ?? ''),
        'schriftbild' => text($roh['schriftbild'] ?? ''),
        'hintergrund' => text($roh['hintergrund'] ?? ''),
        'gespraechsstoff' => $gespraechsstoff,
        'hinweis' => text($roh['hinweis'] ?? ''),
    ];
}

/**
 * Ein Bildbereich, auf das Bild begrenzt.
 *
 * Das Modell schätzt die Koordinaten und liegt gelegentlich daneben — ein
 * Rahmen, der bei x = 0.9 beginnt und 0.4 breit ist, ragt rechts hinaus.
 * Beschnitten sitzt er immer noch da, wo das Element ist; unbeschnitten
 * verschöbe er im Frontend die ganze Vorschau.
 */
function bereich(array $roh): array
{
    $x = anteil($roh['x'] ?? 0);
    $y = anteil($roh['y'] ?? 0);

    return [
        'x' => $x,
        'y' => $y,
        'breite' => min(anteil($roh['breite'] ?? 0), 1.0 - $x),
        'hoehe' => min(anteil($roh['hoehe'] ?? 0), 1.0 - $y),
    ];
}

/** Ein Anteil zwischen 0 und 1. Alles andere wird hineingezwungen. */
function anteil(mixed $wert): float
{
    if (!is_int($wert) && !is_float($wert) && !is_numeric($wert)) {
        return 0.0;
    }
    $zahl = (float) $wert;

    // Manche Modelle geben Prozent statt Anteile aus. Ein Wert über 1, aber
    // im Bereich bis 100, ist mit hoher Wahrscheinlichkeit genau das.
    if ($zahl > 1.0 && $zahl <= 100.0) {
        $zahl /= 100.0;
    }

    return max(0.0, min(1.0, $zahl));
}

function text(mixed $wert): string
{
    return is_string($wert) ? trim($wert) : '';
}

/** Leere Pflichtfelder werden zu "unbekannt" — das Frontend erwartet Text. */
function textOderUnbekannt(mixed $wert): string
{
    $t = text($wert);
    return $t === '' ? 'unbekannt' : $t;
}

function sicherheit(mixed $wert): string
{
    $t = strtolower(text($wert));
    return in_array($t, ['hoch', 'mittel', 'niedrig'], true) ? $t : 'mittel';
}

/** Eine Bildadresse, oder nichts. */
function bildAdresse(mixed $wert): string
{
    return is_string($wert) && preg_match('#^https?://#', $wert) === 1 ? $wert : '';
}

/**
 * Prüft eine Vermutung, die über das Netz kam.
 *
 * Sie stammt vom eigenen Dienst — und wird trotzdem geprüft. Was hier
 * durchginge, landete unbesehen in der Seite: die Adresse im src eines
 * Bildes, die Farben in einem style-Attribut, die Kennung in der nächsten
 * Anfrage. Dass die Gegenstelle die eigene ist, macht die Daten nicht
 * wohlgeformt; es macht nur den Fehler unwahrscheinlicher, nicht unmöglich.
 *
 * @return array{id:int, brauerei:string, name:string, wahrscheinlichkeit:float,
 *               leitfarben:list<string>, bild:string}|null
 */
function vermutungSaeubern(array $roh): ?array
{
    $id = (int) ($roh['id'] ?? 0);
    $name = text($roh['name'] ?? '');

    // Ohne Kennung liesse sich die Antwort des Lesers nicht zuordnen, ohne
    // Namen wäre die Frage nicht zu stellen. Beides fehlt: keine Frage.
    if ($id <= 0 || $name === '') {
        return null;
    }

    $anteil = $roh['wahrscheinlichkeit'] ?? 0;
    $farben = [];

    foreach (array_slice((array) ($roh['leitfarben'] ?? []), 0, 3) as $farbe) {
        if (is_string($farbe) && preg_match('/^#[0-9a-f]{6}$/i', $farbe) === 1) {
            $farben[] = strtolower($farbe);
        }
    }

    return [
        'id' => $id,
        'brauerei' => text($roh['brauerei'] ?? ''),
        'name' => $name,
        'wahrscheinlichkeit' => is_numeric($anteil)
            ? max(0.0, min(1.0, (float) $anteil))
            : 0.0,
        'leitfarben' => $farben,
        'bild' => bildAdresse($roh['bild'] ?? null),
    ];
}
