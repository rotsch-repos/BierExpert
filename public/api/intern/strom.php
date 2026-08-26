<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Fortschritts-Strom: NDJSON statt einer einzigen Antwort am Ende.
 *
 * Der Grund ist eine fremde Zeitgrenze. Cloudflare bricht eine Verbindung
 * nach 100 Sekunden ab, wenn bis dahin kein Byte geflossen ist — und zwar
 * gezählt bis zum ERSTEN Byte; danach zählt nur noch die Stille zwischen
 * Bytes. Ein Scan mit kaltem Modell liegt über dieser Grenze, und die GPU
 * dieser Maschine ist umkämpft: kalt ist hier der Normalfall.
 *
 * Wer früh ein Byte schickt und dann alle paar Sekunden eines nachlegt,
 * fällt nicht mehr unter diese Regel — unabhängig davon, wie lange das
 * Modell tatsächlich braucht.
 *
 * Der zweite Gewinn ist der eigentliche: Der Leser sieht, was geschieht.
 * "Der Kessel wird angeheizt" ist keine Beschäftigungstherapie, sondern die
 * ehrliche Auskunft, dass gerade ein Modell in den Grafikspeicher geladen
 * wird. Und wenn die erste Stufe das Bier erkannt hat, steht der Name
 * bereits auf dem Schirm, während die Zerlegung noch läuft.
 *
 * Jede Zeile ist ein vollständiges JSON-Objekt mit einem Feld "stufe".
 * Zeilenweise, damit der Leser im Browser sie einzeln verarbeiten kann,
 * ohne auf das Ende zu warten.
 */

/** Läuft für diese Anfrage ein Strom? */
function stromAktiv(): bool
{
    static $aktiv = false;

    if (func_num_args() > 0) {
        $aktiv = (bool) func_get_arg(0);
    }

    return $aktiv;
}

/**
 * Verlangt der Aufrufer den Strom?
 *
 * Über den Accept-Kopf und nicht als Vorgabe: Der alte Weg — eine Anfrage,
 * eine Antwort — bleibt damit unverändert gültig. Das ist kein Zaudern,
 * sondern nötig, solange dieselbe Anwendung auch auf Hostpoint läuft, wo
 * die Anfrage ohnehin nach einer halben Minute gekappt wird. Ein Strom
 * hilft dort nichts und ein Bruch schadete.
 */
function stromGewuenscht(): bool
{
    return str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/x-ndjson');
}

/**
 * Öffnet den Strom: Kopfzeilen raus, Pufferung aus, erstes Byte unterwegs.
 */
function stromBeginnen(): void
{
    if (!headers_sent()) {
        header('Content-Type: application/x-ndjson; charset=utf-8', true, 200);
        header('Cache-Control: no-store');
        // Ohne diese Zeile sammelt nginx die Antwort und gibt sie erst am
        // Stück heraus — dann käme das erste Byte am Ende, und der ganze
        // Aufwand wäre umsonst. nginx wertet die Kopfzeile aus und schaltet
        // die Pufferung für diese eine Antwort ab.
        header('X-Accel-Buffering: no');
    }

    // Alle Puffer von PHP selbst ebenso: implicit_flush allein genügt
    // nicht, wenn irgendwo weiter oben ein ob_start() steht.
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    ob_implicit_flush(true);

    stromAktiv(true);

    // Der Server darf so lange rechnen, wie er braucht. Der Browser bricht
    // von sich aus nach fünfeinhalb Minuten ab (src/etikett.ts), und der
    // Herzschlag hält die Strecke davor offen.
    set_time_limit(0);
}

/** Schreibt eine Ereigniszeile und schickt sie sofort los. */
function stromZeile(array $ereignis): void
{
    echo json_encode(
        $ereignis,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE,
    ), "\n";

    flush();
}

/**
 * Welche Etappe gerade läuft.
 *
 * Steht hier und nicht als Parameter durch modellFragen() hindurch: Der
 * Herzschlag entsteht tief unten in anfragen(), die Bedeutung der Etappe
 * kennt aber nur der Ablauf ganz oben. Die Angabe durch drei Schichten zu
 * reichen hiesse, drei Signaturen für etwas zu ändern, das nur die Anzeige
 * betrifft.
 */
function stromStufe(?string $stufe = null): string
{
    static $aktuell = 'auswertung';

    if ($stufe !== null) {
        $aktuell = $stufe;
    }

    return $aktuell;
}

/**
 * Der Herzschlag während einer langen Modellanfrage.
 *
 * Gibt eine Funktion zurück, die curl im Sekundentakt aufruft, während es
 * auf das Modell wartet. Sie schreibt aber nur alle paar Sekunden eine
 * Zeile: Häufiger wäre Lärm ohne Gewinn, seltener liefe die Strecke in
 * Cloudflares Grenze.
 *
 * @param  string $stufe Was gerade läuft — für die Anzeige beim Leser
 * @return callable(): void
 */
function pulsgeber(string $stufe): callable
{
    $zuletzt = hrtime(true);

    return static function () use ($stufe, &$zuletzt): void {
        if (!stromAktiv()) {
            return;
        }

        $jetzt = hrtime(true);
        if (($jetzt - $zuletzt) / 1_000_000_000 < PULS_ABSTAND_SEKUNDEN) {
            return;
        }

        $zuletzt = $jetzt;
        stromZeile(['stufe' => 'puls', 'laeuft' => $stufe]);
    };
}

/**
 * Wie oft ein Lebenszeichen.
 *
 * Fünf Sekunden sind reichlich Abstand zu Cloudflares hundert und dennoch
 * selten genug, dass der Strom nicht zur Datenflut wird.
 */
const PULS_ABSTAND_SEKUNDEN = 5;
