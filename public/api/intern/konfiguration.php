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
            'Es fehlt die Konfigurationsdatei ' . $pfad . '. Sie entsteht beim '
                . 'Deploy im Schritt "Konfiguration auf den Server schreiben". '
                . 'Häufigster Grund, dass sie fehlt: Das Secret LLM_ENDPUNKT ist '
                . 'nicht hinterlegt — dann schreibt der Schritt nichts, ohne das '
                . 'Deploy rot zu färben.',
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

    // Der Anbieter für beide Stufen, sofern nichts Feineres dasteht.
    // Unbekanntes fällt auf die Vorgabe zurück, statt beim ersten Scan zu
    // überraschen.
    $anbieter = anbieterOder($roh['llm']['anbieter'] ?? null, 'ollama');

    $konfiguration = [
        'db' => [
            'host' => (string) ($roh['db']['host'] ?? ''),
            'name' => (string) ($roh['db']['name'] ?? ''),
            'benutzer' => (string) ($roh['db']['benutzer'] ?? ''),
            'passwort' => (string) ($roh['db']['passwort'] ?? ''),
        ],
        'llm' => [
            // Wer antwortet: 'ollama' (das eigene Modell, Vorgabe) oder
            // 'anthropic' — die Brücke, solange der Weg zum eigenen Modell
            // durch fremde Zeitgrenzen führt. Unbekanntes fällt auf die
            // Vorgabe zurück, statt beim ersten Scan zu überraschen.
            'anbieter' => $anbieter,
            // Und jetzt je Stufe getrennt — das ist der Kern des Betriebs
            // auf eigener Hardware.
            //
            // Die beiden Stufen stellen gegensätzliche Ansprüche. Das
            // Ablesen von Brauerei und Name ist eine Fleissaufgabe: Sie
            // fällt bei JEDEM Scan an, auch bei den tausend schon bekannten
            // Bieren, und muss deshalb schnell und umsonst sein. Das
            // Zerlegen eines unbekannten Etiketts fällt genau EINMAL je Bier
            // an, danach nie wieder — dort zählt Genauigkeit, und dort ist
            // ein bezahlter Aufruf gut angelegt.
            //
            // Deshalb: Ablesen lokal, Zerlegen bei Anthropic. Der Preis
            // richtet sich damit nicht nach der Zahl der Scans, sondern nach
            // der Zahl der noch unbekannten Biere — und die geht mit jedem
            // Fund zurück.
            //
            // Fehlt der Eintrag, gilt weiter llm.anbieter für beide Stufen.
            // Bestehende Installationen ändern ihr Verhalten also nicht.
            'anbieter_schnell' => anbieterOder($roh['llm']['anbieter_schnell'] ?? null, $anbieter),
            'anbieter_tief' => anbieterOder($roh['llm']['anbieter_tief'] ?? null, $anbieter),
            'anthropic_schluessel' => (string) ($roh['llm']['anthropic_schluessel'] ?? ''),
            'anthropic_modell' => (string) ($roh['llm']['anthropic_modell'] ?? 'claude-opus-5'),
            'anthropic_modell_schnell' => (string) ($roh['llm']['anthropic_modell_schnell'] ?? 'claude-opus-5'),
            // Wie gründlich das Modell überlegen darf. Stand bis zum Umzug
            // fest auf 'low', und zwar aus einem Grund, den es nicht mehr
            // gibt: Hostpoint kappte die Anfrage nach rund einer halben
            // Minute, und eine gründlichere Antwort, die in die Kappung
            // läuft, ist keine bessere Antwort, sondern gar keine.
            //
            // Auf eigenem Server ist das eine Abwägung statt einer Not, und
            // deshalb steht der Wert jetzt hier. Die Vorgabe bleibt 'low' —
            // wer sie hebt, soll das entscheiden und nicht geschenkt
            // bekommen. Unbekanntes fällt darauf zurück, statt die Anfrage
            // beim ersten Scan mit einem 400 scheitern zu lassen.
            'anthropic_aufwand' => in_array($roh['llm']['anthropic_aufwand'] ?? '',
                ['low', 'medium', 'high', 'xhigh', 'max'], true)
                ? $roh['llm']['anthropic_aufwand']
                : 'low',
            // Nur für Tests umbiegbar — im Betrieb die echte API.
            'anthropic_basis' => rtrim((string) ($roh['llm']['anthropic_basis'] ?? 'https://api.anthropic.com'), '/'),
            'endpunkt' => rtrim((string) ($roh['llm']['endpunkt'] ?? ''), '/'),
            'schluessel' => (string) ($roh['llm']['schluessel'] ?? ''),
            // Das große Modell mit Bildverständnis: zerlegt das Etikett und
            // gibt die Bildbereiche an.
            //
            // qwen3-vl:30b und nicht :32b, obwohl die Zahl kleiner aussieht.
            // Der 30b ist ein MoE-Modell und rechnet nur einen Bruchteil
            // seiner Gewichte je Token; auf derselben Karte und derselben
            // Etikettaufgabe gemessen: 11 s gegen 135 s, bei besserer
            // Trefferlage. Das ist nicht bloss angenehmer — Cloudflare bricht
            // eine Verbindung nach 100 Sekunden ab, wenn bis dahin kein Byte
            // geflossen ist. Mit dem 32b liefe der erste Aufruf in genau
            // diesen Abbruch.
            'modell' => (string) ($roh['llm']['modell'] ?? 'qwen3-vl:30b'),
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

/**
 * Prüft einen Anbieternamen und gibt sonst den Rückfall.
 *
 * Ein Tippfehler in der Konfiguration soll den Scan nicht mit einem
 * unverständlichen Fehler abbrechen lassen, sondern beim Bekannten bleiben.
 */
function anbieterOder(mixed $wert, string $rueckfall): string
{
    return in_array($wert, ['ollama', 'anthropic'], true) ? $wert : $rueckfall;
}
