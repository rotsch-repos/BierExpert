<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Die Verbindung zur Datenbank.
 *
 * Wichtig ist hier vor allem, was NICHT passiert: Scheitert die Verbindung,
 * fliegt kein Fehler. Die Datenbank ist der Zwischenspeicher, nicht das
 * Werk — sie macht die Anwendung schneller und billiger, aber ohne sie
 * funktioniert immer noch alles, nur eben jedes Mal über das Modell. Eine
 * Anwendung, die geschlossen bleibt, weil ihr Zwischenspeicher klemmt, hat
 * die Abhängigkeit falsch herum.
 *
 * Der Ausfall steht deshalb im Log, nicht in der Antwort.
 */

/** Gibt die Verbindung zurück — oder null, wenn keine zustande kommt. */
function datenbank(): ?PDO
{
    static $verbindung = null;
    static $versucht = false;

    if ($versucht) {
        return $verbindung;
    }
    $versucht = true;

    $konfiguration = konfiguration();

    if (!$konfiguration['speicher']) {
        return null; // Zwischenspeicher bewusst abgeschaltet.
    }

    $db = $konfiguration['db'];

    if ($db['host'] === '' || $db['name'] === '' || $db['benutzer'] === '') {
        error_log('BierExpert: Zwischenspeicher aus — in der Konfiguration fehlen Datenbankangaben.');
        return null;
    }

    try {
        $verbindung = new PDO(
            sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $db['host'], $db['name']),
            $db['benutzer'],
            $db['passwort'],
            [
                // Fehler als Ausnahme: Ein stillschweigend gescheitertes
                // INSERT wäre ein Zwischenspeicher, der nie füllt, ohne dass
                // es auffiele.
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Echte vorbereitete Anweisungen: Der Server bekommt die
                // Werte getrennt von der Anweisung und kann sie gar nicht
                // erst als solche lesen.
                PDO::ATTR_EMULATE_PREPARES => false,
                // Steht der Datenbankserver nicht, soll das nach fünf
                // Sekunden feststehen. Der Scan läuft dann ohne
                // Zwischenspeicher weiter, statt darauf zu warten.
                PDO::ATTR_TIMEOUT => 5,
            ],
        );
    } catch (PDOException $fehler) {
        // Bewusst ohne die Meldung von PDO in der Antwort: Sie enthält Host
        // und Benutzernamen. Ins Log gehört sie, dorthin geht sie auch.
        error_log('BierExpert: Datenbank nicht erreichbar — ' . $fehler->getMessage());
        $verbindung = null;
    }

    return $verbindung;
}
