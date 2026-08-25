<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Was hereinkommt, bevor irgendetwas damit gemacht wird.
 *
 * Alle Endpunkte nehmen dieselbe Form entgegen: einen JSON-Rumpf mit dem
 * Bild als base64 und dem Medientyp. Geprüft wird hier — nicht im Endpunkt,
 * damit keiner der Endpunkte eine Prüfung vergessen kann.
 */

/** Erlaubte Bildformate. Dieselbe Liste wie im Frontend. */
const ERLAUBTE_TYPEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Grösse des dekodierten Bildes. Das Frontend rechnet auf 1568 Pixel
 * herunter, damit liegt ein Foto typischerweise unter 1 MB. Acht MB lassen
 * Luft für ein unverkleinertes Bild aus einem anderen Client und sind immer
 * noch weit von dem entfernt, was den Speicher in Bedrängnis brächte.
 */
const BILD_HOECHSTGROESSE = 8 * 1024 * 1024;

/**
 * Setzt die Kopfzeilen für Anfragen aus dem Browser und beantwortet den
 * Vorabflug.
 *
 * Im Betrieb liegen Seite und API unter derselben Adresse — dann fragt der
 * Browser gar nicht erst nach der Erlaubnis, und nichts davon greift. Der
 * Fall, für den es hier steht, ist die Entwicklung: Vite liefert unter
 * localhost:5173 aus, die API antwortet unter bierexpert.de.
 *
 * Bewusst eine Liste statt "*": Mit "*" dürfte jede beliebige Seite im Netz
 * Anfragen an diese API stellen — auf Kosten der Rechenzeit des Servers,
 * an dem das Modell hängt.
 */
function herkunftPruefen(): void
{
    $herkunft = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($herkunft !== '' && in_array($herkunft, konfiguration()['herkuenfte'], true)) {
        header('Access-Control-Allow-Origin: ' . $herkunft);
        // Ohne Vary würde ein Zwischenspeicher die Antwort für die eine
        // Herkunft auch der nächsten ausliefern.
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Anthropic-Schluessel');
        header('Access-Control-Max-Age: 86400');
    }

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/** Besteht auf POST. Ein Etikett auszuwerten ist keine Abfrage. */
function nurPost(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Allow: POST, OPTIONS');
        fehlerSenden(405, 'Dieser Endpunkt nimmt nur POST entgegen.');
    }
}

/** Liest den JSON-Rumpf der Anfrage. */
function rumpfLesen(): array
{
    $roh = file_get_contents('php://input');

    if ($roh === false || $roh === '') {
        // Ist der Rumpf grösser als post_max_size, verwirft PHP ihn
        // stillschweigend — php://input ist dann leer, obwohl der Browser
        // etwas geschickt hat. Ohne diesen Hinweis sucht man den Fehler
        // im Frontend, wo keiner ist.
        $angekuendigt = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($angekuendigt > 0) {
            fehlerSenden(413, 'Das Bild ist grösser, als der Server annimmt.',
                'Angekündigt waren ' . lesbareGroesse($angekuendigt) . ', erlaubt sind '
                    . (ini_get('post_max_size') ?: 'unbekannt') . ' (post_max_size). '
                    . 'Die Einstellung lässt sich bei Hostpoint im Kundenpanel erhöhen.');
        }
        fehlerSenden(400, 'Die Anfrage hatte keinen Inhalt.');
    }

    try {
        $daten = json_decode($roh, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException $fehler) {
        fehlerSenden(400, 'Die Anfrage war kein gültiges JSON.', $fehler->getMessage());
    }

    // json_decode macht aus einer JSON-Liste ebenfalls ein PHP-Array —
    // is_array() allein liesse [1,2] also durch, und der Fehler fiele erst
    // beim fehlenden Feld "bild" auf, wo er nach etwas anderem aussieht.
    if (!is_array($daten) || ($daten !== [] && array_is_list($daten))) {
        fehlerSenden(400, 'Die Anfrage muss ein JSON-Objekt sein.',
            'Erwartet wird { "bild": "…", "typ": "image/jpeg" }.');
    }

    return $daten;
}

/**
 * Ein Bild aus der Anfrage: geprüft, dekodiert, mit Prüfsumme.
 */
final class Bild
{
    public function __construct(
        public readonly string $base64,
        public readonly string $medienTyp,
        public readonly string $pruefsumme,
    ) {
    }
}

/** Holt das Bild aus dem Rumpf und prüft es. */
function bildAusRumpf(array $rumpf): Bild
{
    $base64 = $rumpf['bild'] ?? null;

    if (!is_string($base64) || $base64 === '') {
        fehlerSenden(400, 'Es fehlt das Feld "bild".',
            'Erwartet wird das Bild als base64, ohne den Vorspann "data:...;base64,".');
    }

    // strict: true weist alles zurück, was keine gültige base64-Folge ist,
    // statt die unbekannten Zeichen zu überspringen und einen Torso zu
    // liefern, der später als kaputtes Bild auffällt.
    $daten = base64_decode($base64, true);

    if ($daten === false || $daten === '') {
        fehlerSenden(400, 'Das Feld "bild" ist kein gültiges base64.');
    }

    if (strlen($daten) > BILD_HOECHSTGROESSE) {
        fehlerSenden(413, 'Das Bild ist zu gross.',
            'Erlaubt sind ' . lesbareGroesse(BILD_HOECHSTGROESSE) . ', geschickt wurden '
                . lesbareGroesse(strlen($daten)) . '.');
    }

    // Was tatsächlich im Bild steht, zählt — nicht, was die Anfrage behauptet.
    // Sonst genügte ein umbenanntes Etwas mit "image/jpeg" im Feld "typ".
    $erkannt = @getimagesizefromstring($daten);

    if ($erkannt === false || !isset($erkannt['mime'])) {
        fehlerSenden(400, 'Das ist kein lesbares Bild.',
            'Erlaubt sind JPEG, PNG, WebP und GIF.');
    }

    $typ = (string) $erkannt['mime'];

    if (!in_array($typ, ERLAUBTE_TYPEN, true)) {
        fehlerSenden(415, 'Dieses Bildformat wird nicht unterstützt.',
            'Erkannt wurde ' . $typ . '. Erlaubt sind JPEG, PNG, WebP und GIF.');
    }

    // Die Prüfsumme steht später im Scan-Protokoll und erlaubt, dasselbe
    // Foto wiederzuerkennen, ohne es aufzubewahren.
    return new Bild($base64, $typ, hash('sha256', $daten));
}

function lesbareGroesse(int $bytes): string
{
    if ($bytes >= 1024 * 1024) {
        return round($bytes / (1024 * 1024), 1) . ' MB';
    }
    return round($bytes / 1024) . ' kB';
}
