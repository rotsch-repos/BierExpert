<?php

declare(strict_types=1);

/**
 * GET /api/gesundheit.php
 *
 * Sagt in einem Aufruf, ob die drei Teile stehen: PHP, Datenbank, Modell.
 *
 * Der Grund für diesen Endpunkt: Wenn ein Scan scheitert, gibt es drei Orte,
 * an denen es klemmen kann, und von aussen sehen alle drei gleich aus. Ohne
 * diese Auskunft beginnt jede Fehlersuche mit Raten.
 *
 * Bewusst ohne Wirtsnamen, Benutzernamen und Adressen: Der Endpunkt ist ohne
 * Anmeldung erreichbar, und wo etwas steht, geht niemanden etwas an, der nur
 * wissen will, OB es steht.
 */

require_once __DIR__ . '/intern/pforte.php';

herkunftPruefen();

$befund = [
    'php' => [
        'version' => PHP_VERSION,
        // Ohne diese drei läuft nichts, und ihr Fehlen sähe sonst aus wie
        // ein Programmfehler statt wie eine fehlende Erweiterung.
        'pdo_mysql' => extension_loaded('pdo_mysql'),
        'curl' => extension_loaded('curl'),
        'mbstring' => extension_loaded('mbstring'),
        'post_max_size' => ini_get('post_max_size') ?: 'unbekannt',
    ],
];

/* --- Konfiguration ------------------------------------------------------- */

try {
    $konfiguration = konfiguration();
    $befund['konfiguration'] = [
        'gefunden' => true,
        'datenbank_angaben' => $konfiguration['db']['host'] !== '' && $konfiguration['db']['name'] !== '',
        'datenbank_passwort' => $konfiguration['db']['passwort'] !== '',
        'modell_endpunkt' => $konfiguration['llm']['endpunkt'] !== '',
        'modell' => $konfiguration['llm']['modell'],
        'modell_schnell' => $konfiguration['llm']['modell_schnell'],
        'zwischenspeicher' => $konfiguration['speicher'],
    ];
} catch (BierFehler $fehler) {
    // Ohne Konfiguration lässt sich nichts weiter prüfen — aber genau das
    // ist die Auskunft, auf die es dann ankommt.
    antwortSenden(200, $befund + [
        'konfiguration' => ['gefunden' => false, 'rat' => $fehler->rat],
        'bereit' => false,
    ]);
}

/* --- Datenbank ----------------------------------------------------------- */

$db = datenbank();

if (!$konfiguration['speicher']) {
    // Abgeschaltet ist kein Ausfall. Die beiden auseinanderzuhalten ist der
    // halbe Zweck dieses Endpunkts — sonst sucht man einen Fehler, wo eine
    // Einstellung steht.
    $befund['datenbank'] = [
        'verbunden' => false,
        'abgeschaltet' => true,
        'rat' => 'Der Zwischenspeicher ist in der Konfiguration abgeschaltet (speicher => false). '
            . 'Jeder Scan geht damit ans Modell.',
    ];
} elseif ($db === null) {
    $befund['datenbank'] = [
        'verbunden' => false,
        'rat' => 'Der Grund steht im Fehlerprotokoll des Servers. Häufig: Der Wirt ist nur '
            . 'innerhalb des Hostpoint-Netzes auflösbar, oder das Passwort stimmt nicht.',
    ];
} else {
    $befund['datenbank'] = ['verbunden' => true];
    foreach (['biere', 'etikett_elemente', 'scans'] as $tabelle) {
        try {
            // Der Tabellenname kommt aus dieser Liste, nicht von aussen —
            // deshalb ist er hier zulässigerweise Teil der Anweisung.
            $befund['datenbank']['tabellen'][$tabelle] = (int) $db
                ->query('SELECT COUNT(*) FROM `' . $tabelle . '`')
                ->fetchColumn();
        } catch (PDOException) {
            $befund['datenbank']['tabellen'][$tabelle] = null; // Nicht vorhanden.
        }
    }
    if (in_array(null, $befund['datenbank']['tabellen'], true)) {
        $befund['datenbank']['rat'] = 'Es fehlen Tabellen. Der Arbeitsablauf "Migrationen" '
            . 'legt sie an — er muss einmal von Hand gestartet werden.';
    }
}

/* --- Sprachmodell -------------------------------------------------------- */

// /api/tags listet die geladenen Modelle. Ein leichter Aufruf: Er sagt, ob
// Ollama antwortet UND ob das eingetragene Modell überhaupt vorhanden ist —
// die beiden Fragen, die sonst erst beim ersten Scan auffallen.
$befund['modell'] = modellPruefen($konfiguration['llm']);

// "bereit" heisst: Ein Scan käme durch. Ohne Zwischenspeicher geht das —
// langsamer, aber vollständig. Ohne Modell geht es nicht.
$befund['bereit'] = ($befund['modell']['erreichbar'] ?? false) === true;

antwortSenden(200, $befund);


function modellPruefen(array $llm): array
{
    if ($llm['endpunkt'] === '') {
        return ['erreichbar' => false, 'rat' => 'In der Konfiguration fehlt llm.endpunkt.'];
    }

    $griff = curl_init($llm['endpunkt'] . '/api/tags');
    if ($griff === false) {
        return ['erreichbar' => false];
    }

    $kopfzeilen = ['Accept: application/json'];
    if ($llm['schluessel'] !== '') {
        $kopfzeilen[] = 'Authorization: Bearer ' . $llm['schluessel'];
    }

    curl_setopt_array($griff, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $kopfzeilen,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
    ]);

    $roh = curl_exec($griff);
    $status = (int) curl_getinfo($griff, CURLINFO_RESPONSE_CODE);
    $fehlertext = curl_error($griff);
    curl_close($griff);

    if ($roh === false) {
        return ['erreichbar' => false, 'rat' => $fehlertext];
    }

    if ($status !== 200) {
        return ['erreichbar' => false, 'rat' => 'Antwort mit Status ' . $status . ': ' . kurz((string) $roh, 200)];
    }

    $daten = json_decode((string) $roh, true);
    if (!is_array($daten) || !is_array($daten['models'] ?? null)) {
        return ['erreichbar' => false, 'rat' => 'Unter dieser Adresse antwortet kein Ollama.'];
    }

    $vorhanden = [];
    foreach ($daten['models'] as $modell) {
        if (is_array($modell) && isset($modell['name'])) {
            $vorhanden[] = (string) $modell['name'];
        }
    }

    $befund = ['erreichbar' => true, 'vorhandene_modelle' => $vorhanden];

    // Ollama nennt Modelle mit Markierung ("qwen3-vl:30b"). Eingetragen ist
    // womöglich nur der Name. Beides soll als vorhanden gelten.
    foreach (['modell', 'modell_schnell'] as $welches) {
        $gesucht = $llm[$welches];
        $gefunden = false;
        foreach ($vorhanden as $name) {
            if ($name === $gesucht || str_starts_with($name, $gesucht . ':')) {
                $gefunden = true;
                break;
            }
        }
        $befund[$welches . '_vorhanden'] = $gefunden;
    }

    if (!$befund['modell_vorhanden'] || !$befund['modell_schnell_vorhanden']) {
        $befund['rat'] = 'Ein eingetragenes Modell ist auf dem Server nicht vorhanden. '
            . 'Entweder mit "ollama pull" holen oder in der Konfiguration einen der '
            . 'vorhandenen Namen eintragen.';
    }

    return $befund;
}
