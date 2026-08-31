<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Die Rahmen vom Referenzfoto auf das vorliegende Foto durchreichen.
 *
 * Der Gedanke, der das erlaubt: Ein Etikett ändert sich über Jahre nicht.
 * Zwei Fotos derselben Flasche unterscheiden sich nur durch Winkel, Abstand
 * und Licht — also durch eine Abbildung, die sich aus den Bildern selbst
 * bestimmen lässt. Wer sie kennt, muss die Elemente nicht ein zweites Mal
 * von einem Modell suchen lassen.
 *
 * Gemessen am 28.08. an vier Fassungen desselben Etiketts: rund 100 ms
 * samt Prozessstart, gegen rund 2500 ms für denselben Durchgang auf der
 * GPU. Dazu kommt etwas, das ein Modell nicht liefert: ein Vertrauensmass.
 * Passt die Abbildung nicht, sagt die Zahl es — 0,97 und 0,95 in den
 * geglückten Fällen, 0,48 in einem misslungenen, 0,0 bei einem fremden
 * Etikett.
 *
 * Deshalb ist das hier kein Ersatz, sondern ein Vorlauf: Trägt die
 * Abbildung nicht, übernimmt weiterhin das Modell.
 */

/**
 * Versucht die Registrierung und gibt die Rahmen je Bezeichnung zurück.
 *
 * Gibt null zurück, wenn sie nicht möglich oder nicht verlässlich war —
 * dann gehört der Fall ans Modell.
 *
 * @param  list<array{bezeichnung:string,referenz_bereich?:array|null}> $elemente
 * @return array<string, array{x:float,y:float,breite:float,hoehe:float}>|null
 */
function registrierungVersuchen(Bild $bild, string $referenzBild, array $elemente): ?array
{
    $einstellung = konfiguration()['registrierung'];

    if ($einstellung['python'] === '' || $einstellung['skript'] === '') {
        return null;
    }

    if ($referenzBild === '' || !bilderAufbewahren()) {
        return null;
    }

    $referenzPfad = konfiguration()['bilder']['verzeichnis'] . '/' . $referenzBild;

    if (!is_file($referenzPfad)) {
        return null;
    }

    // Nur die Elemente, für die überhaupt ein Referenzrahmen vorliegt. Die
    // Reihenfolge muss halten: Das Skript antwortet mit einer Liste
    // derselben Länge, und die Zuordnung läuft über den Platz darin.
    $bezeichnungen = [];
    $rahmen = [];

    foreach ($elemente as $element) {
        $bereich = $element['referenz_bereich'] ?? null;

        if (!is_array($bereich) || !isset($bereich['x'], $bereich['y'], $bereich['breite'], $bereich['hoehe'])) {
            continue;
        }

        $bezeichnungen[] = (string) $element['bezeichnung'];
        $rahmen[] = [
            'x' => (float) $bereich['x'],
            'y' => (float) $bereich['y'],
            'breite' => (float) $bereich['breite'],
            'hoehe' => (float) $bereich['hoehe'],
        ];
    }

    if ($rahmen === []) {
        return null;
    }

    $neuPfad = registrierungBildAblegen($bild);

    if ($neuPfad === null) {
        return null;
    }

    $rahmenPfad = tempnam(sys_get_temp_dir(), 'bierexpert-rahmen-');

    if ($rahmenPfad === false) {
        registrierungAufraeumen($neuPfad, $bild);

        return null;
    }

    file_put_contents($rahmenPfad, json_encode($rahmen));

    $befehl = sprintf(
        '%s %s %s %s %s 2>/dev/null',
        escapeshellcmd($einstellung['python']),
        escapeshellarg($einstellung['skript']),
        escapeshellarg($referenzPfad),
        escapeshellarg($neuPfad),
        escapeshellarg($rahmenPfad),
    );

    exec($befehl, $ausgabe, $stand);

    @unlink($rahmenPfad);
    registrierungAufraeumen($neuPfad, $bild);

    if ($stand !== 0) {
        error_log('BierExpert: Registrierung fehlgeschlagen, Stand ' . $stand);

        return null;
    }

    $antwort = json_decode(implode('', $ausgabe), true);

    if (!is_array($antwort) || ($antwort['getroffen'] ?? false) !== true) {
        return null;
    }

    $bereiche = [];

    foreach (array_values((array) ($antwort['bereiche'] ?? [])) as $nummer => $eintrag) {
        // null heisst: liegt auf diesem Foto ausserhalb des Bildes. Das ist
        // die Antwort und keine Panne — genau die, die ein Modell an dieser
        // Stelle gern erfindet.
        if (!is_array($eintrag) || !isset($bezeichnungen[$nummer])) {
            continue;
        }

        $bereiche[$bezeichnungen[$nummer]] = bereich($eintrag);
    }

    return $bereiche === [] ? null : $bereiche;
}

/**
 * Sorgt dafür, dass das vorliegende Foto als Datei greifbar ist.
 *
 * Im Regelfall liegt es ohnehin schon im Bilderverzeichnis — dann wird
 * nichts geschrieben. Nur wenn nicht, entsteht eine Datei auf Zeit.
 */
function registrierungBildAblegen(Bild $bild): ?string
{
    $verzeichnis = konfiguration()['bilder']['verzeichnis'];
    $vorhanden = $verzeichnis . '/' . $bild->pruefsumme . bildEndung($bild->medienTyp);

    if (is_file($vorhanden)) {
        return $vorhanden;
    }

    $pfad = tempnam(sys_get_temp_dir(), 'bierexpert-foto-');

    if ($pfad === false) {
        return null;
    }

    $daten = base64_decode($bild->base64, true);

    if ($daten === false || @file_put_contents($pfad, $daten) === false) {
        @unlink($pfad);

        return null;
    }

    return $pfad;
}

/** Räumt nur weg, was für diesen Aufruf entstanden ist. */
function registrierungAufraeumen(string $pfad, Bild $bild): void
{
    if (!str_starts_with(basename($pfad), $bild->pruefsumme)) {
        @unlink($pfad);
    }
}

/**
 * Wie gut passen zwei Fotos desselben Etiketts zueinander — als blosse Zahl.
 *
 * Dasselbe Skript, derselbe Merkmalsvergleich wie bei
 * registrierungVersuchen(), nur ohne Rahmen: Gefragt ist hier nicht "wo
 * liegt das Element", sondern "ist das überhaupt dieselbe Flasche". Das
 * Skript rechnet die Abbildung ohnehin, bevor es Rahmen abbildet — die
 * leere Rahmenliste kostet also nichts und erspart einen zweiten Helfer,
 * der auseinanderlaufen könnte.
 *
 * Beide Pfade zeigen auf Dateien, die schon auf der Platte liegen: das
 * Referenzfoto im Bilderverzeichnis, das neue dort ebenfalls, weil
 * nachschlagen.php es vor der Suche aufbewahrt. Es entstehen keine
 * Zwischendateien, und das zählt: Bei mehreren Kandidaten liefe der
 * Vergleich sonst mehrfach über dieselbe Schreiberei.
 *
 * @return float 0.0 bis 1.0 — 0.0 auch dann, wenn gar nicht gerechnet
 *               werden konnte. Ein Nichtwissen ist hier dasselbe wie ein
 *               Nichtpassen: In beiden Fällen darf dieses Bier nicht allein
 *               aufgrund dieser Zahl gewinnen.
 */
function registrierungVertrauen(string $referenzPfad, string $neuPfad): float
{
    $einstellung = konfiguration()['registrierung'];

    if ($einstellung['python'] === '' || $einstellung['skript'] === '') {
        return 0.0;
    }

    if (!is_file($referenzPfad) || !is_file($neuPfad)) {
        return 0.0;
    }

    static $leer = null;

    if ($leer === null) {
        $leer = tempnam(sys_get_temp_dir(), 'bierexpert-leer-');

        if ($leer === false) {
            $leer = null;

            return 0.0;
        }

        file_put_contents($leer, '[]');
    }

    $befehl = sprintf(
        '%s %s %s %s %s 2>/dev/null',
        escapeshellcmd($einstellung['python']),
        escapeshellarg($einstellung['skript']),
        escapeshellarg($referenzPfad),
        escapeshellarg($neuPfad),
        escapeshellarg($leer),
    );

    exec($befehl, $ausgabe, $stand);

    if ($stand !== 0 || $ausgabe === []) {
        return 0.0;
    }

    $antwort = json_decode(implode('', $ausgabe), true);

    if (!is_array($antwort) || !is_numeric($antwort['vertrauen'] ?? null)) {
        return 0.0;
    }

    return max(0.0, min(1.0, (float) $antwort['vertrauen']));
}
