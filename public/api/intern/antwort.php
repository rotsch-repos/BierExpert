<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Wie eine Antwort das Haus verlässt — und wie ein Fehler benannt wird.
 *
 * Das Frontend kennt genau zwei Formen: einen Erfolg mit Nutzdaten, oder
 * ein Objekt mit "fehler" und wahlweise "rat". Der Rat ist der Unterschied
 * zwischen "geht nicht" und "so geht es": Er sagt, was zu tun ist.
 */

/**
 * Ein Fehler, dessen Wortlaut für den Leser bestimmt ist.
 *
 * Alles andere, was fliegt, ist ein Programmfehler und wird zu einer
 * allgemeinen 500 — mit den Einzelheiten im Log statt in der Antwort.
 */
final class BierFehler extends RuntimeException
{
    public function __construct(
        string $meldung,
        public readonly ?string $rat = null,
        public readonly int $status = 502,
    ) {
        parent::__construct($meldung);
    }
}

/** Schreibt die Antwort und beendet den Aufruf. */
function antwortSenden(int $status, array $daten): void
{
    // Läuft ein Strom, sind die Kopfzeilen längst draussen und der Status
    // steht auf 200 — eine zweite Antwort mit eigenem Status gäbe es dort
    // nicht mehr. Die Nutzlast geht dann als letzte Ereigniszeile hinaus.
    //
    // Der Status ist deshalb nicht verloren: Ein Fehler trägt sein "fehler"
    // im Objekt, und danach richtet sich der Leser ohnehin — er muss das
    // bei einem Strom sogar, weil ein Fehler nach dem ersten Byte gar
    // keinen anderen Weg mehr hat.
    if (stromAktiv()) {
        stromZeile(['stufe' => isset($daten['fehler']) ? 'fehler' : 'fertig'] + $daten);
        exit;
    }

    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8', true, $status);
        // Eine Auswertung ist nie zwischenspeicherbar: Dasselbe Foto zweimal
        // geschickt soll den Zwischenspeicher der Datenbank treffen, nicht
        // den des Browsers — nur so wird der Scan überhaupt protokolliert.
        header('Cache-Control: no-store');
    }

    // JSON_UNESCAPED_UNICODE, damit Umlaute als Umlaute im Log stehen und
    // nicht als ä — das liest sich bei der Fehlersuche erheblich besser.
    // JSON_INVALID_UTF8_SUBSTITUTE: Ein einzelnes kaputtes Byte aus einer
    // Modellantwort soll die ganze Antwort nicht zu Fall bringen.
    echo json_encode(
        $daten,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE,
    );
    exit;
}

/** Schreibt eine Fehlerantwort und beendet den Aufruf. */
function fehlerSenden(int $status, string $meldung, ?string $rat = null): void
{
    $daten = ['fehler' => $meldung];
    if ($rat !== null && $rat !== '') {
        $daten['rat'] = $rat;
    }
    antwortSenden($status, $daten);
}
