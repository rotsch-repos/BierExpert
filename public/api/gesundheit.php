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
        // Je Stufe getrennt, weil sie bei der Mischung auseinanderfallen:
        // Ablesen beim eigenen Modell, Zerlegen bei Anthropic. Ein einzelner
        // Anbietername verschwiege im Betrieb genau die Hälfte.
        'anbieter_schnell' => $konfiguration['llm']['anbieter_schnell'],
        'anbieter_tief' => $konfiguration['llm']['anbieter_tief'],
        'modell_endpunkt' => $konfiguration['llm']['anbieter_tief'] === 'anthropic'
            || $konfiguration['llm']['anbieter_schnell'] === 'anthropic'
            ? $konfiguration['llm']['anthropic_schluessel'] !== ''
                || $konfiguration['llm']['endpunkt'] !== ''
            : $konfiguration['llm']['endpunkt'] !== '',
        'modell' => $konfiguration['llm']['anbieter_tief'] === 'anthropic'
            ? $konfiguration['llm']['anthropic_modell']
            : $konfiguration['llm']['modell'],
        'modell_schnell' => $konfiguration['llm']['anbieter_schnell'] === 'anthropic'
            ? $konfiguration['llm']['anthropic_modell_schnell']
            : $konfiguration['llm']['modell_schnell'],
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
// Beide Stufen einzeln prüfen. Bei der Mischung hängen sie an
// verschiedenen Anbietern, und dann ist "das Modell antwortet" keine
// Auskunft mehr, sondern eine Verwechslungsgefahr: Das eine kann laufen,
// während das andere fehlt.
$befund['modell'] = [
    'schnell' => stufePruefen($konfiguration['llm'], true),
    'tief' => stufePruefen($konfiguration['llm'], false),
];

/** Taugt eine Stufe für einen Scan? */
$stufeBereit = static fn (array $b): bool => ($b['erreichbar'] ?? false) === true
    || ($b['schluessel_je_anfrage'] ?? false) === true;

// "bereit" heisst: Ein Scan käme durch. Ohne Zwischenspeicher geht das —
// langsamer, aber vollständig. Ohne Modell geht es nicht.
//
// UND, nicht ODER: Ein Scan durchläuft immer die schnelle Stufe, und bei
// einem unbekannten Bier zusätzlich die tiefe. Fehlt eine davon, ist die
// Anwendung nicht bereit — auch wenn die andere tadellos antwortet.
$befund['bereit'] = $stufeBereit($befund['modell']['schnell'])
    && $stufeBereit($befund['modell']['tief']);

antwortSenden(200, $befund);


/**
 * Prüft die eine Stufe: Wer beantwortet sie, und antwortet der auch?
 *
 * @param bool $schnell true für das Ablesen, false für die Zerlegung
 */
function stufePruefen(array $llm, bool $schnell): array
{
    $anbieter = $schnell ? $llm['anbieter_schnell'] : $llm['anbieter_tief'];

    if ($anbieter === 'anthropic') {
        return ['anbieter' => 'anthropic'] + anthropicPruefen($llm);
    }

    return ['anbieter' => 'ollama'] + ollamaPruefen($llm, $schnell);
}


function ollamaPruefen(array $llm, bool $schnell): array
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
    //
    // Geprüft wird nur das Modell DIESER Stufe. Geht die Zerlegung zu
    // Anthropic, muss das grosse Modell hier gar nicht mehr liegen — es
    // dann als Mangel zu melden, schickte auf eine Suche nach einem Fehler,
    // den es nicht gibt. (Und es hielte dazu an, 20 GB Grafikspeicher für
    // etwas freizuhalten, das nie aufgerufen wird.)
    foreach ($schnell ? ['modell_schnell'] : ['modell'] as $welches) {
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

    $schluesselDerStufe = $schnell ? 'modell_schnell_vorhanden' : 'modell_vorhanden';

    if (!$befund[$schluesselDerStufe]) {
        $befund['rat'] = 'Das eingetragene Modell ist auf dem Server nicht vorhanden. '
            . 'Entweder mit "ollama pull" holen oder in der Konfiguration einen der '
            . 'vorhandenen Namen eintragen.';
    }

    return $befund;
}


/**
 * Fragt die Anthropic-API, ob der Schlüssel gilt und die Modelle existieren.
 *
 * /v1/models ist der leichteste Aufruf, der beides beantwortet — dieselbe
 * Rolle, die /api/tags bei Ollama spielt.
 */
function anthropicPruefen(array $llm): array
{
    $schluessel = anthropicSchluessel($llm);
    if ($schluessel === '') {
        // Kein Server-Schlüssel ist im Browser-Modus kein Ausfall: Der
        // Schlüssel reist je Anfrage mit. Prüfen lässt er sich von hier
        // nur, wenn die Anfrage selbst einen mitbringt.
        return [
            'erreichbar' => false,
            'schluessel_je_anfrage' => true,
            'rat' => 'Der Schlüssel kommt je Anfrage aus dem Browser mit. Zum Prüfen: '
                . 'diesen Endpunkt mit der Kopfzeile X-Anthropic-Schluessel aufrufen.',
        ];
    }

    $griff = curl_init($llm['anthropic_basis'] . '/v1/models');
    if ($griff === false) {
        return ['erreichbar' => false];
    }

    curl_setopt_array($griff, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'x-api-key: ' . $schluessel,
            'anthropic-version: 2023-06-01',
        ],
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
    if ($status === 401 || $status === 403) {
        return ['erreichbar' => false, 'rat' => 'Der Schlüssel wurde abgewiesen (Status ' . $status . ').'];
    }
    if ($status !== 200) {
        return ['erreichbar' => false, 'rat' => 'Antwort mit Status ' . $status . ': ' . kurz((string) $roh, 200)];
    }

    $daten = json_decode((string) $roh, true);
    if (!is_array($daten) || !is_array($daten['data'] ?? null)) {
        return ['erreichbar' => false, 'rat' => 'Unter dieser Adresse antwortet keine Anthropic-API.'];
    }

    $vorhanden = [];
    foreach ($daten['data'] as $modell) {
        if (is_array($modell) && isset($modell['id'])) {
            $vorhanden[] = (string) $modell['id'];
        }
    }

    return [
        'erreichbar' => true,
        'vorhandene_modelle' => $vorhanden,
        'modell_vorhanden' => in_array($llm['anthropic_modell'], $vorhanden, true),
        'modell_schnell_vorhanden' => in_array($llm['anthropic_modell_schnell'], $vorhanden, true),
    ];
}
