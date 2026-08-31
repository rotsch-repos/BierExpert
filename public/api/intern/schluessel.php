<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Suchschlüssel, unter dem ein Bier wiedergefunden wird.
 *
 * Zwei Fotos derselben Flasche ergeben nie exakt denselben Text: Einmal
 * liest das Modell "Rothaus-Bräu", einmal "Badische Staatsbrauerei Rothaus".
 * Ein Schlüssel, der beides trifft, gäbe es nur um den Preis, dass er auch
 * daneben trifft — und ein falscher Treffer ist die schlimmere Sorte Fehler:
 * Der Leser bekäme die Geschichte eines anderen Bieres, ohne dass irgendwo
 * etwas nach Fehler aussähe.
 *
 * Deshalb wird hier zurückhaltend vereinheitlicht: Gross- und Kleinschreibung,
 * Umlaute, Satzzeichen und eine kurze Liste von Wörtern, die nichts
 * unterscheiden ("GmbH", "Brauerei", "Bräu"). Alles darüber hinaus bleibt
 * stehen. Was dann nicht zusammenfindet, landet als zweiter Eintrag in der
 * Datenbank — unschön, aber harmlos.
 */

/**
 * Wörter, die zwei Brauereien nie voneinander unterscheiden.
 *
 * "Kloster", "Staats", "Hof" und dergleichen stehen bewusst NICHT hier:
 * Sie gehören oft zum Namen und tragen Bedeutung.
 */
const FUELLWOERTER = [
    // Rechtsformen
    'gmbh', 'ag', 'kg', 'kgaa', 'ohg', 'ug', 'se', 'ev', 'eg', 'co', 'cie',
    'ltd', 'limited', 'inc', 'llc', 'bv', 'nv', 'sa', 'srl', 'spa', 'aps', 'ab', 'oy',
    // Allgemeines aus dem Gewerbe
    'brauerei', 'brauereien', 'braeu', 'brauhaus', 'privatbrauerei',
    'brewery', 'breweries', 'brewing', 'brewers', 'birra', 'brasserie', 'brouwerij',
    // Bindewörter
    'und', 'and', 'der', 'die', 'das', 'the', 'zum', 'zur',
];

/**
 * Bildet den Schlüssel aus Brauerei und Name.
 *
 * Gibt einen leeren String zurück, wenn eines von beiden unbekannt ist.
 * Das ist wichtig: Ohne diese Prüfung liefen alle nicht erkannten Biere
 * unter demselben Schlüssel zusammen und überschrieben einander.
 */
function schluesselBilden(string $brauerei, string $name): string
{
    $b = teilVereinheitlichen($brauerei);
    $n = teilVereinheitlichen($name);

    if ($b === '' || $n === '') {
        return '';
    }

    $schluessel = $b . '|' . $n;

    // Die Spalte ist VARCHAR(190). Länger wird es nur bei ausufernden
    // Modellantworten; dann lieber gekürzt als abgewiesen.
    return substr($schluessel, 0, 190);
}

/** Vereinheitlicht einen Teil des Schlüssels. */
function teilVereinheitlichen(string $text): string
{
    $text = trim($text);

    if ($text === '') {
        return '';
    }

    // "unbekannt" ist kein Bier. Das Modell trägt es ein, wenn es nichts
    // lesen konnte — daraus darf nie ein Schlüssel werden.
    if (in_array(mb_strtolower($text, 'UTF-8'), ['unbekannt', 'unknown', 'n/a', '-', '?'], true)) {
        return '';
    }

    // Das Ursprüngliche festhalten: Der Rückfall weiter unten braucht es
    // noch, wenn der ASCII-Filter alles aufgezehrt hat.
    $ursprung = $text;

    // Umlaute vor dem Kleinschreiben: "Ä" wird zu "Ae", nicht zu einem Byte,
    // das der Filter danach wegwirft.
    $text = strtr($text, [
        'Ä' => 'Ae', 'ä' => 'ae', 'Ö' => 'Oe', 'ö' => 'oe', 'Ü' => 'Ue', 'ü' => 'ue',
        'ß' => 'ss', 'ẞ' => 'Ss',
        'À' => 'A', 'Á' => 'A', 'Â' => 'A', 'Ã' => 'A', 'Å' => 'A', 'Æ' => 'Ae',
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'å' => 'a', 'æ' => 'ae',
        'È' => 'E', 'É' => 'E', 'Ê' => 'E', 'Ë' => 'E',
        'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e',
        'Ì' => 'I', 'Í' => 'I', 'Î' => 'I', 'Ï' => 'I',
        'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i',
        'Ò' => 'O', 'Ó' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ø' => 'O',
        'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ø' => 'o',
        'Ù' => 'U', 'Ú' => 'U', 'Û' => 'U',
        'ù' => 'u', 'ú' => 'u', 'û' => 'u',
        'Ç' => 'C', 'ç' => 'c', 'Ñ' => 'N', 'ñ' => 'n', 'Ý' => 'Y', 'ý' => 'y',
    ]);

    $text = strtolower($text);

    // In Wörter zerlegen, damit die Füllwörter noch als Wörter erkennbar
    // sind. Erst danach zusammenziehen — "co" innerhalb von "rothaus" darf
    // nicht verschwinden.
    $woerter = preg_split('/[^a-z0-9]+/', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];

    // Bleibt nichts übrig, war die Schrift nicht lateinisch.
    //
    // Der Filter oben kennt nur a-z0-9. Ein griechisches Etikett — "ΜΑΜΟΣ
    // ΑΦΙΛΤΡΑΡΙΣΤΗ" — wird davon restlos aufgezehrt, und heraus kommt ein
    // leerer Schlüssel. Ein leerer Schlüssel heisst für merken.php "kein
    // Bier", und der Eintrag wird abgewiesen. Am 31.08. genau so passiert:
    // Der Scan lief durch, Anthropic zerlegte, und das Ergebnis fiel in
    // nichts. Zweimal. Damit konnte jedes Bier mit griechischem,
    // kyrillischem, hebräischem oder japanischem Etikett grundsätzlich nie
    // ins Kompendium kommen — jeder Scan bezahlt, nichts behalten.
    //
    // Also derselbe Schnitt noch einmal, nur mit Unicode-Buchstaben statt
    // ASCII. Der Schlüssel heisst dann "μαμος" statt "mamos". Das ist kein
    // Schönheitsfehler, sondern belanglos: Angezeigt wird er nie, er muss
    // nur stabil und unterscheidbar sein.
    //
    // Bewusst NICHT über Transliterator (intl): Die Erweiterung fehlt auf
    // der Workstation, und wäre sie auf der einen Seite da und auf der
    // anderen nicht, bildeten beide verschiedene Schlüssel für dasselbe
    // Bier. Dieser Weg rechnet überall gleich.
    //
    // Als Rückfall und nicht als Ersatz, damit die bestehenden Schlüssel
    // Byte für Byte dieselben bleiben — sonst fände die Datenbank ihre
    // eigenen Einträge nicht wieder.
    if ($woerter === []) {
        $woerter = preg_split(
            '/[^\p{L}\p{N}]+/u',
            mb_strtolower($ursprung, 'UTF-8'),
            -1,
            PREG_SPLIT_NO_EMPTY,
        ) ?: [];
    }

    $behalten = array_values(array_filter(
        $woerter,
        static fn (string $wort): bool => !in_array($wort, FUELLWOERTER, true),
    ));

    // Bestand der Name nur aus Füllwörtern — "Brauerei GmbH" —, ist nichts
    // übrig, womit sich etwas unterscheiden liesse. Dann lieber das
    // Ursprüngliche nehmen als einen leeren Schlüssel.
    if ($behalten === []) {
        $behalten = $woerter;
    }

    return implode('', $behalten);
}
