<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Wo die Zugangsdaten stehen — und warum nicht hier.
 *
 * Das Datenbankpasswort und der Schlüssel zum Sprachmodell dürfen nicht im
 * Repository liegen und erst recht nicht im Wurzelverzeichnis der Domain:
 * Was dort liegt, ist im Zweifel abrufbar. Reicht der Server eine .php-Datei
 * einmal als Text aus — weil das Modul beim Umstellen der PHP-Version kurz
 * fehlt —, stünde das Passwort im Browser.
 *
 * Deshalb liegt die Konfiguration im Heimatverzeichnis des Benutzers,
 * außerhalb jedes Wurzelverzeichnisses:
 *
 *     ~/.bierexpert/konfiguration.php
 *
 * Das hat noch einen zweiten Vorteil: Die Auslieferung räumt das
 * Wurzelverzeichnis mit "rsync --delete" leer, bevor sie den neuen Stand
 * hineinlegt. Was dort läge, wäre nach dem nächsten Deploy weg.
 *
 * Die Datei gibt ein Array zurück; ein PHP-Rückgabewert kann selbst dann
 * nicht als Text ausgeliefert werden, wenn jemand sie versehentlich ins
 * Wurzelverzeichnis kopiert — vorausgesetzt, PHP läuft.
 */

/** Liest die Konfiguration einmal und gibt sie danach aus dem Gedächtnis. */
function konfiguration(): array
{
    static $konfiguration = null;
    if ($konfiguration !== null) {
        return $konfiguration;
    }

    $pfad = konfigurationsPfad();

    if (!is_file($pfad) || !is_readable($pfad)) {
        throw new BierFehler(
            'Der Server ist noch nicht eingerichtet.',
            'Es fehlt die Konfigurationsdatei ' . $pfad . '. Sie wird vom '
                . 'Arbeitsablauf "Konfiguration schreiben" angelegt.',
            503,
        );
    }

    $roh = require $pfad;

    if (!is_array($roh)) {
        throw new BierFehler(
            'Die Konfigurationsdatei ist unbrauchbar.',
            'Sie muss ein Array zurückgeben.',
            500,
        );
    }

    $konfiguration = [
        'db' => [
            'host' => (string) ($roh['db']['host'] ?? ''),
            'name' => (string) ($roh['db']['name'] ?? ''),
            'benutzer' => (string) ($roh['db']['benutzer'] ?? ''),
            'passwort' => (string) ($roh['db']['passwort'] ?? ''),
        ],
        'llm' => [
            'endpunkt' => rtrim((string) ($roh['llm']['endpunkt'] ?? ''), '/'),
            'schluessel' => (string) ($roh['llm']['schluessel'] ?? ''),
            // Das große Modell mit Bildverständnis: zerlegt das Etikett und
            // gibt die Bildbereiche an.
            'modell' => (string) ($roh['llm']['modell'] ?? 'qwen3-vl:32b'),
            // Das kleine für die beiden schnellen Durchgänge: erst ablesen,
            // wer es gebraut hat, später die bekannten Elemente im Foto
            // wiederfinden. Beides braucht kein großes Modell.
            'modell_schnell' => (string) ($roh['llm']['modell_schnell'] ?? 'qwen3-vl:8b'),
            // Grosszügig: Ein 32B-Modell mit Bild braucht auf eigener
            // Hardware ohne Weiteres eine Minute und mehr.
            'zeitgrenze' => (int) ($roh['llm']['zeitgrenze'] ?? 300),
            'zeitgrenze_schnell' => (int) ($roh['llm']['zeitgrenze_schnell'] ?? 90),
        ],
        // Zusätzlich erlaubte Herkünfte für Anfragen aus dem Browser.
        // Im Regelfall leer: Seite und API liegen unter derselben Adresse,
        // dann fragt der Browser gar nicht erst nach. Für die Entwicklung
        // gehört hier http://localhost:5173 hinein.
        'herkuenfte' => array_values(array_filter(
            array_map('strval', (array) ($roh['herkuenfte'] ?? [])),
        )),
        // Solange der Zwischenspeicher aus ist, geht jeder Scan ans Modell.
        // Nützlich, um beim Ausprobieren nicht ständig alte Antworten zu
        // bekommen.
        'speicher' => (bool) ($roh['speicher'] ?? true),
    ];

    return $konfiguration;
}

/** Der eine Ort, an dem die Konfiguration gesucht wird — mit einer Hintertür. */
function konfigurationsPfad(): string
{
    // Für Aufbauten, die nicht dem Hostpoint-Muster folgen: ein
    // SetEnv im vhost oder in der .htaccess setzt den Pfad direkt.
    $gesetzt = getenv('BIEREXPERT_KONFIG');
    if (is_string($gesetzt) && $gesetzt !== '') {
        return $gesetzt;
    }

    return heimatverzeichnis() . '/.bierexpert/konfiguration.php';
}

/**
 * Das Heimatverzeichnis des Benutzers, unter dem PHP läuft.
 *
 * Unter PHP-FPM ist HOME nicht verlässlich gesetzt — der Prozess erbt die
 * Umgebung des Pools, nicht die einer Anmeldung. Die Benutzerdatenbank weiß
 * es dagegen immer, sofern die posix-Erweiterung vorhanden ist.
 */
function heimatverzeichnis(): string
{
    if (function_exists('posix_geteuid') && function_exists('posix_getpwuid')) {
        $eintrag = posix_getpwuid(posix_geteuid());
        if (is_array($eintrag) && isset($eintrag['dir']) && $eintrag['dir'] !== '') {
            return rtrim((string) $eintrag['dir'], '/');
        }
    }

    $heim = getenv('HOME');
    if (is_string($heim) && $heim !== '') {
        return rtrim($heim, '/');
    }

    throw new BierFehler(
        'Der Server ist noch nicht eingerichtet.',
        'Das Heimatverzeichnis liess sich nicht bestimmen. Setz den Pfad zur '
            . 'Konfiguration stattdessen direkt: SetEnv BIEREXPERT_KONFIG /pfad/zur/konfiguration.php',
        503,
    );
}
