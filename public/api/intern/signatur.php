<?php

declare(strict_types=1);

/**
 * Die Farbsignatur: das billige Vorsieb vor dem teuren Vergleich.
 *
 * Sie beantwortet nicht "welches Bier ist das", sondern "welche kommen
 * überhaupt in Frage". Das ist eine bescheidenere Frage, und genau deshalb
 * darf sie billig beantwortet werden: Ein Vorsieb darf irren, solange es
 * grosszügig irrt — es muss das richtige Bier unter den Kandidaten halten,
 * nicht als einziges benennen. Wer wirklich entscheidet, ist die
 * Registrierung in registrierung.php.
 *
 * Gerechnet wird in dienst/signatur.py, weil es OpenCV für PHP nicht gibt.
 */

/**
 * Wo der Helfer liegt.
 *
 * Abgeleitet aus dem Pfad des Schwesterskripts statt als eigener
 * Konfigurationsschlüssel: Beide liegen in dienst/, werden vom selben
 * ausliefern.sh in denselben Stand kopiert und gehören zusammen. Zwei
 * Schlüssel für ein Verzeichnis wären zwei Gelegenheiten, auseinanderzu-
 * laufen — und der Fehler fiele erst auf, wenn die Suche stumm schlechter
 * wird.
 */
function signaturSkript(): string
{
    $einstellung = konfiguration()['registrierung'];

    if ($einstellung['python'] === '' || $einstellung['skript'] === '') {
        return '';
    }

    $pfad = dirname($einstellung['skript']) . '/signatur.py';

    return is_file($pfad) ? $pfad : '';
}

/**
 * Berechnet die Signatur eines Bildes auf der Platte.
 *
 * @return array{signatur: list<float>, farben: list<string>}|null
 */
function signaturBerechnen(string $bildPfad): ?array
{
    $skript = signaturSkript();

    if ($skript === '' || !is_file($bildPfad)) {
        return null;
    }

    $befehl = sprintf(
        '%s %s %s 2>/dev/null',
        escapeshellcmd(konfiguration()['registrierung']['python']),
        escapeshellarg($skript),
        escapeshellarg($bildPfad),
    );

    exec($befehl, $ausgabe, $stand);

    if ($stand !== 0 || $ausgabe === []) {
        return null;
    }

    $roh = json_decode((string) end($ausgabe), true);

    if (!is_array($roh) || ($roh['ok'] ?? false) !== true) {
        return null;
    }

    $werte = [];
    foreach ((array) ($roh['signatur'] ?? []) as $wert) {
        if (!is_numeric($wert)) {
            return null;
        }
        $werte[] = (float) $wert;
    }

    if ($werte === []) {
        return null;
    }

    $farben = [];
    foreach ((array) ($roh['farben'] ?? []) as $farbe) {
        // Was in die Antwort und später in ein style-Attribut wandert, wird
        // geprüft und nicht geglaubt — auch wenn es aus dem eigenen Helfer
        // kommt.
        if (is_string($farbe) && preg_match('/^#[0-9a-f]{6}$/i', $farbe) === 1) {
            $farben[] = strtolower($farbe);
        }
    }

    return ['signatur' => $werte, 'farben' => $farben];
}

/**
 * Wie ähnlich sich zwei Signaturen sind: 0 (nichts gemein) bis 1 (gleich).
 *
 * Histogrammschnitt — die Summe der jeweils kleineren Anteile. Beide
 * Reihen summieren sich auf 1, deshalb liegt das Ergebnis von selbst
 * zwischen 0 und 1 und braucht keine Normierung.
 *
 * Warum nicht euklidischer Abstand: Der bestraft eine grosse Abweichung in
 * einem einzelnen Fach härter als viele kleine. Bei Farbhistogrammen ist
 * aber genau das Gegenteil richtig — ein Etikett, das eine kräftige Farbe
 * mehr hat, ist immer noch dasselbe Etikett.
 */
function signaturAehnlichkeit(array $a, array $b): float
{
    if ($a === [] || count($a) !== count($b)) {
        return 0.0;
    }

    $schnitt = 0.0;

    foreach ($a as $i => $wert) {
        $schnitt += min((float) $wert, (float) ($b[$i] ?? 0.0));
    }

    return max(0.0, min(1.0, $schnitt));
}
