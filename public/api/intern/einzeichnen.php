<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Die fertigen Einzeichnungen: je Element das Referenzfoto mit EINEM Rahmen.
 *
 * Warum fertige Bilder und nicht Koordinaten, die der Browser überlegt: Ein
 * PNG ist selbsttragend. Es funktioniert in einer Nachricht, in einer Mail,
 * in einer Linkvorschau und ohne JavaScript — ein Rahmen, den erst der
 * Browser zeichnet, tut das nicht. Und es liegt am richtigen Ende der
 * Rechnung: gerendert einmal je Bier, ausgeliefert beliebig oft als
 * statische Datei, die ein CDN übernehmen kann, ohne diesen Server zu
 * fragen.
 *
 * Gezeichnet wird mit ffmpeg und nicht mit GD, aus einem schlichten Grund:
 * Auf dieser Maschine gibt es kein GD, kein Imagick und kein ImageMagick,
 * aber ffmpeg. Kommt die Erweiterung eines Tages dazu, wäre gdRahmen() der
 * kürzere Weg — an dieser Schnittstelle ändert das nichts.
 *
 * Der Aufwand des Prozessstarts (~50 ms je Bild) fällt nicht ins Gewicht:
 * Er trifft den einen Scan, der ein Bier neu aufnimmt, und nie wieder.
 */

/** Farbe und Stärke des Rahmens. */
const RAHMEN_FARBE = '#e8a33d';

/**
 * Zeichnet einen Rahmen auf eine Kopie des Fotos.
 *
 * @param  array{x:float,y:float,breite:float,hoehe:float} $bereich Anteile 0..1
 * @return bool Ob die Zieldatei entstanden ist
 */
function rahmenZeichnen(string $quelle, array $bereich, string $ziel): bool
{
    $masse = @getimagesize($quelle);

    if ($masse === false) {
        error_log('BierExpert: Quellbild nicht lesbar — ' . $quelle);

        return false;
    }

    [$breite, $hoehe] = $masse;

    // Anteile in Bildpunkte. Gerundet und in das Bild geklemmt: Das Modell
    // schätzt die Ränder, und eine Schätzung darf knapp danebenliegen —
    // ffmpeg bräche bei einem Rahmen ausserhalb des Bildes ab.
    $x = (int) round($bereich['x'] * $breite);
    $y = (int) round($bereich['y'] * $hoehe);
    $b = (int) round($bereich['breite'] * $breite);
    $h = (int) round($bereich['hoehe'] * $hoehe);

    $x = max(0, min($breite - 1, $x));
    $y = max(0, min($hoehe - 1, $y));
    $b = max(1, min($breite - $x, $b));
    $h = max(1, min($hoehe - $y, $h));

    // Die Strichstärke wächst mit dem Bild: Zwei Punkte sind auf einem
    // grossen Foto ein Haar und auf einem kleinen ein Balken.
    $staerke = max(2, (int) round(min($breite, $hoehe) / 150));

    $filter = sprintf(
        'drawbox=x=%d:y=%d:w=%d:h=%d:color=%s@1.0:t=%d',
        $x,
        $y,
        $b,
        $h,
        RAHMEN_FARBE,
        $staerke,
    );

    // Erst daneben schreiben, dann umbenennen — wie beim Ablegen der Fotos:
    // Ein Abbruch mitten im Schreiben hinterliesse sonst ein halbes Bild
    // unter dem richtigen Namen, und das sähe für immer gültig aus.
    $vorlaeufig = $ziel . '.teil-' . bin2hex(random_bytes(4))
        . '.' . pathinfo($ziel, PATHINFO_EXTENSION);

    $befehl = sprintf(
        'ffmpeg -y -loglevel error -i %s -vf %s %s 2>&1',
        escapeshellarg($quelle),
        escapeshellarg($filter),
        escapeshellarg($vorlaeufig),
    );

    exec($befehl, $ausgabe, $stand);

    if ($stand !== 0 || !is_file($vorlaeufig)) {
        @unlink($vorlaeufig);
        error_log('BierExpert: Rahmen nicht gezeichnet — ' . implode(' ', $ausgabe));

        return false;
    }

    if (!@rename($vorlaeufig, $ziel)) {
        @unlink($vorlaeufig);
        error_log('BierExpert: Einzeichnung nicht umbenennbar — ' . $ziel);

        return false;
    }

    return true;
}

/**
 * Erzeugt die Einzeichnungen zu einem frisch aufgenommenen Bier.
 *
 * Läuft genau einmal je Bier — beim Scan, der es in die Datenbank bringt.
 * Scheitert etwas davon, ist das kein Grund, den Scan fallen zu lassen: Es
 * fehlt dann ein Bild, nicht die Auskunft. Deshalb wird protokolliert und
 * weitergemacht.
 *
 * @param list<array{bezeichnung:string,bereich?:array}> $elemente
 */
function elementbilderErzeugen(int $bierId, string $bildDatei, array $elemente): void
{
    if ($bildDatei === '' || !bilderAufbewahren() || !konfiguration()['bilder']['einzeichnungen']) {
        return;
    }

    $verzeichnis = konfiguration()['bilder']['verzeichnis'];
    $quelle = $verzeichnis . '/' . $bildDatei;

    if (!is_file($quelle)) {
        return;
    }

    $endung = pathinfo($bildDatei, PATHINFO_EXTENSION) ?: 'jpg';
    $stamm = pathinfo($bildDatei, PATHINFO_FILENAME);

    foreach (array_values($elemente) as $nummer => $element) {
        $bereich = $element['bereich'] ?? null;

        // Ohne Bereich kein Rahmen. Das ist der Normalfall für ein Element,
        // das auf diesem Foto verdeckt war — dann bleibt die Spalte leer
        // und die Anzeige zeigt eben kein Bild dazu.
        if (!is_array($bereich) || !isset($bereich['x'], $bereich['y'], $bereich['breite'], $bereich['hoehe'])) {
            continue;
        }

        // Der Name leitet sich aus Prüfsumme und Reihenfolge ab: Derselbe
        // Scan mit denselben Elementen ergibt denselben Namen, also nie eine
        // zweite Datei für dasselbe Bild.
        $name = $stamm . '-' . ($nummer + 1) . '.' . $endung;
        $ziel = $verzeichnis . '/' . $name;

        if (!is_file($ziel) && !rahmenZeichnen($quelle, $bereich, $ziel)) {
            continue;
        }

        elementbildEintragen($bierId, $nummer, $name);
    }
}
