<?php

declare(strict_types=1);

/**
 * Der gemeinsame Einstieg aller Endpunkte.
 *
 * Jeder Endpunkt bindet genau diese Datei ein und bekommt damit: eine
 * geprüfte PHP-Version, eine Fehlerbehandlung, die im Fehlerfall JSON statt
 * einer HTML-Warnung zurückgibt, die Konfiguration und alle Bausteine.
 *
 * Die Dateien in diesem Ordner definieren ausschließlich Funktionen. Damit
 * sie beim direkten Aufruf über den Browser nichts tun, prüfen sie auf die
 * Konstante, die allein hier gesetzt wird. Das .htaccess daneben sperrt sie
 * zusätzlich — aber eine Sperre, die von der Serverkonfiguration abhängt,
 * ist keine, auf die man sich allein verlassen sollte.
 */

// Kommt vor allem anderen: readonly-Eigenschaften und enum brauchen 8.1.
// Ohne diese Prüfung wäre die Auskunft ein Parse-Fehler in einer beliebigen
// Datei — mit ihr steht da, was tatsächlich fehlt.
if (PHP_VERSION_ID < 80100) {
    header('Content-Type: application/json; charset=utf-8', true, 500);
    echo json_encode([
        'fehler' => 'Die PHP-Version auf dem Server ist zu alt.',
        'rat' => 'Gebraucht wird mindestens PHP 8.1, vorhanden ist ' . PHP_VERSION
            . '. Bei Hostpoint lässt sich die Version im Kundenpanel je Domain umstellen.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

define('BIEREXPERT', true);

/*
 * Fehler gehören ins Log, nicht in die Antwort. Eine PHP-Warnung, die vor
 * dem JSON ausgegeben wird, macht die Antwort für den Browser unlesbar —
 * und der Leser sähe statt einer Auskunft einen Parse-Fehler im Frontend.
 */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// Eine Modellantwort kann eine Minute und länger brauchen. Auf Unix zählt
// PHP die Wartezeit auf das Netz ohnehin nicht mit; das hier ist gegen den
// Fall, dass doch gezählt wird. Ist die Funktion gesperrt, schadet es nicht.
@set_time_limit(0);

require_once __DIR__ . '/strom.php';
require_once __DIR__ . '/antwort.php';
require_once __DIR__ . '/konfiguration.php';
require_once __DIR__ . '/anfrage.php';
require_once __DIR__ . '/schluessel.php';
require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/ollama.php';
require_once __DIR__ . '/anthropic.php';
require_once __DIR__ . '/datenbank.php';
require_once __DIR__ . '/speicher.php';
require_once __DIR__ . '/bilder.php';
require_once __DIR__ . '/einzeichnen.php';
require_once __DIR__ . '/dienst.php';
require_once __DIR__ . '/ablauf.php';

/*
 * Warnungen in Ausnahmen verwandeln. Sonst läuft ein Aufruf nach einer
 * Warnung weiter und liefert am Ende halbe Daten — ein Fehlschlag, der sich
 * als Erfolg ausgibt, ist schlimmer als einer, der sich als solcher meldet.
 */
set_error_handler(static function (int $stufe, string $meldung, string $datei, int $zeile): bool {
    if ((error_reporting() & $stufe) === 0) {
        return false; // Mit @ unterdrückt — das war Absicht.
    }
    throw new ErrorException($meldung, 0, $stufe, $datei, $zeile);
});

set_exception_handler(static function (Throwable $fehler): void {
    error_log('BierExpert: ' . $fehler->getMessage() . ' @ '
        . $fehler->getFile() . ':' . $fehler->getLine());

    if ($fehler instanceof BierFehler) {
        fehlerSenden($fehler->status, $fehler->getMessage(), $fehler->rat);
    }

    // Bei allem Unerwarteten steht die Ursache im Log, nicht in der Antwort:
    // Dateipfade und Verbindungszeichenfolgen gehen den Aufrufer nichts an.
    fehlerSenden(500, 'Auf dem Server ist etwas schiefgelaufen.',
        'Die Einzelheiten stehen im Fehlerprotokoll des Servers.');
});

// Ein fataler Fehler umgeht den Ausnahme-Handler. Ohne das hier bekäme der
// Browser eine leere Antwort mit Status 200 und meldete "unlesbares JSON".
register_shutdown_function(static function (): void {
    $letzter = error_get_last();
    if ($letzter === null || !in_array($letzter['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }
    error_log('BierExpert (fatal): ' . $letzter['message'] . ' @ ' . $letzter['file'] . ':' . $letzter['line']);
    if (!headers_sent()) {
        fehlerSenden(500, 'Auf dem Server ist etwas schiefgelaufen.',
            'Die Einzelheiten stehen im Fehlerprotokoll des Servers.');
    }
});
