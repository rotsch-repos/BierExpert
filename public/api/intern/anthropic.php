<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Draht zur Anthropic-API — die Brücke, solange der eigene Modellrechner
 * hinter Grenzen sitzt, die er nicht kontrolliert.
 *
 * Hostpoint kappt PHP-Anfragen nach rund einer halben Minute. Ein Scan über
 * den Tunnel zum eigenen Modell liegt mit kalter GPU darüber; ein Aufruf der
 * Anthropic-API bleibt darunter. Der Schalter dafür ist llm.anbieter in der
 * Konfiguration: 'ollama' (Vorgabe) oder 'anthropic'. Die Aufrufer merken
 * davon nichts — modellFragen() entscheidet.
 *
 * Angesprochen wird POST /v1/messages mit strukturierter Ausgabe
 * (output_config.format): Das Schema, das bei Ollama zur Grammatik wird,
 * erzwingt hier serverseitig gültiges JSON im ersten Textblock.
 */

/** Wie modellFragen(), nur gegen die Anthropic-API. */
function anthropicFragen(
    string $anweisung,
    string $frage,
    array $schema,
    ?string $bildBase64,
    bool $schnell,
): array {
    $llm = konfiguration()['llm'];
    $schluessel = anthropicSchluessel($llm);

    if ($schluessel === '') {
        throw new BierFehler(
            'Es ist kein Anthropic-Schlüssel da.',
            'Hinterlege ANTHROPIC_SCHLUESSEL in der Konfiguration des Servers — im '
                . 'Verbund gehört die tiefe Stufe zum Dirigenten, nicht zu dieser Anlage.',
            401,
        );
    }

    $inhalt = [];
    if ($bildBase64 !== null) {
        $inhalt[] = [
            'type' => 'image',
            'source' => [
                'type' => 'base64',
                'media_type' => medientypAusBase64($bildBase64),
                'data' => $bildBase64,
            ],
        ];
    }
    $inhalt[] = ['type' => 'text', 'text' => $frage];

    $rumpf = [
        'model' => $schnell ? $llm['anthropic_modell_schnell'] : $llm['anthropic_modell'],
        // Die Antworten sind Schema-JSON von wenigen tausend Token; die
        // Grenze ist Puffer gegen Ausreisser, kein Ziel.
        'max_tokens' => 8192,
        'system' => $anweisung,
        'output_config' => [
            'format' => [
                'type' => 'json_schema',
                'schema' => schemaVerschaerft($schema),
            ],
            // Aus der Konfiguration, Vorgabe 'low'. Der ursprüngliche Grund
            // für den festen Wert — vor dem Server stand eine Kappung bei
            // rund einer halben Minute — ist mit dem Umzug auf die eigene
            // Maschine weggefallen. Die Begründung steht bei der Einstellung
            // in konfiguration.php.
            'effort' => $llm['anthropic_aufwand'],
        ],
        'messages' => [
            ['role' => 'user', 'content' => $inhalt],
        ],
    ];

    $antwort = anthropicAnfragen(
        $llm['anthropic_basis'] . '/v1/messages',
        $rumpf,
        $schnell ? $llm['zeitgrenze_schnell'] : $llm['zeitgrenze'],
        $schluessel,
    );

    if (($antwort['stop_reason'] ?? '') === 'refusal') {
        $erklaerung = $antwort['stop_details']['explanation'] ?? '';
        throw new BierFehler(
            'Das Modell hat die Auswertung abgelehnt.',
            is_string($erklaerung) && $erklaerung !== '' ? $erklaerung : null,
        );
    }
    if (($antwort['stop_reason'] ?? '') === 'max_tokens') {
        throw new BierFehler(
            'Die Antwort des Modells wurde abgeschnitten.',
            'Die Ausgabe hat die Token-Grenze erreicht — das Schema kam nicht zu Ende.',
        );
    }

    foreach ($antwort['content'] ?? [] as $block) {
        if (is_array($block) && ($block['type'] ?? '') === 'text' && is_string($block['text'] ?? null)) {
            return jsonAusAntwort($block['text']);
        }
    }

    throw new BierFehler(
        'Die Antwort der Anthropic-API enthielt keinen Text.',
        'Erwartet wird ein Textblock mit dem Schema-JSON.',
    );
}

/**
 * Liest den Medientyp aus den ersten Bytes des Bildes.
 *
 * Die Anfrage verlangt ihn ausdrücklich, aber durch modellFragen() reist nur
 * das base64 — die geprüfte Typangabe aus der Eingangskontrolle ist an
 * dieser Stelle nicht mehr zur Hand. Die Magischen Bytes sagen dasselbe,
 * ohne dass jede Aufrufstelle umgebaut werden muss.
 */
function medientypAusBase64(string $base64): string
{
    $kopf = (string) base64_decode(substr($base64, 0, 24), true);

    return match (true) {
        str_starts_with($kopf, "\xFF\xD8\xFF") => 'image/jpeg',
        str_starts_with($kopf, "\x89PNG") => 'image/png',
        str_starts_with($kopf, 'GIF8') => 'image/gif',
        str_starts_with($kopf, 'RIFF') && substr($kopf, 8, 4) === 'WEBP' => 'image/webp',
        default => 'image/jpeg',
    };
}

/**
 * Macht ein Schema für die strukturierte Ausgabe wasserdicht.
 *
 * Die API verlangt an jedem Objekt additionalProperties=false und die
 * Pflichtfelder. feldObjekt() setzt beides längst — aber ein einziges von
 * Hand gebautes Objekt ohne die Angaben fiele erst im Betrieb auf, als
 * abgelehnte Anfrage. Der Durchlauf hier kostet nichts und schliesst das.
 */
function schemaVerschaerft(array $schema): array
{
    if (($schema['type'] ?? '') === 'object') {
        $schema['additionalProperties'] = false;
        if (isset($schema['properties']) && is_array($schema['properties'])) {
            $schema['required'] = array_keys($schema['properties']);
            foreach ($schema['properties'] as $name => $unter) {
                if (is_array($unter)) {
                    $schema['properties'][$name] = schemaVerschaerft($unter);
                }
            }
        }
    }
    if (isset($schema['items']) && is_array($schema['items'])) {
        $schema['items'] = schemaVerschaerft($schema['items']);
    }
    return $schema;
}

/** Ein POST an die Anthropic-API, JSON hin und JSON zurück. */
function anthropicAnfragen(string $adresse, array $rumpf, int $zeitgrenze, string $schluessel): array
{
    $griff = curl_init($adresse);
    if ($griff === false) {
        throw new BierFehler('Die Anfrage an die Anthropic-API liess sich nicht vorbereiten.', null, 500);
    }

    curl_setopt_array($griff, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($rumpf, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-api-key: ' . $schluessel,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $zeitgrenze,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    // Derselbe Herzschlag wie beim eigenen Modell, aus demselben Grund:
    // Auch ein Aufruf über das Netz ist bis zur Antwort vollkommen stumm.
    // Die Wartezeit ist hier kürzer, aber die Strecke davor — Browser,
    // Cloudflare, dieser Server — ist dieselbe.
    if (stromAktiv()) {
        $puls = pulsgeber(stromStufe());
        curl_setopt_array($griff, [
            CURLOPT_NOPROGRESS => false,
            CURLOPT_XFERINFOFUNCTION => static function () use ($puls): int {
                $puls();

                return 0;
            },
        ]);
    }

    $roh = curl_exec($griff);
    $status = (int) curl_getinfo($griff, CURLINFO_RESPONSE_CODE);
    $fehlernummer = curl_errno($griff);
    $fehlertext = curl_error($griff);
    curl_close($griff);

    if ($fehlernummer !== 0) {
        throw netzFehler($fehlernummer, $fehlertext, $adresse, $zeitgrenze);
    }

    if ($status < 200 || $status >= 300) {
        throw anthropicStatusFehler($status, is_string($roh) ? $roh : '');
    }

    try {
        $daten = json_decode((string) $roh, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new BierFehler(
            'Unter der Adresse der Anthropic-API antwortet etwas anderes.',
            'Zurück kam kein JSON, sondern: ' . kurz((string) $roh),
        );
    }

    if (!is_array($daten)) {
        throw new BierFehler('Die Anthropic-API hat unerwartet geantwortet.');
    }

    return $daten;
}

/** Übersetzt einen Fehlerstatus der Anthropic-API in etwas Handlungsfähiges. */
function anthropicStatusFehler(int $status, string $rumpf): BierFehler
{
    // Die API legt ihre Fehler unter error.message ab — die genauere
    // Auskunft als alles, was sich hier formulieren liesse.
    $gemeldet = '';
    $daten = json_decode($rumpf, true);
    if (is_array($daten) && is_string($daten['error']['message'] ?? null)) {
        $gemeldet = $daten['error']['message'];
    }

    return match (true) {
        $status === 401 || $status === 403 => new BierFehler(
            'Der Anthropic-Schlüssel wurde abgewiesen.',
            ($gemeldet !== '' ? $gemeldet . ' — ' : '')
                . 'Stimmt das Secret ANTHROPIC_SCHLUESSEL, und ist der Schlüssel in der '
                . 'Console noch aktiv?',
            502,
        ),
        $status === 429 => new BierFehler(
            'Die Anthropic-API drosselt gerade.',
            ($gemeldet !== '' ? $gemeldet . ' — ' : '') . 'Warte einen Augenblick und versuch es erneut.',
            503,
        ),
        $status === 529 => new BierFehler(
            'Die Anthropic-API ist gerade überlastet.',
            'Kurz warten und erneut versuchen.',
            503,
        ),
        default => new BierFehler(
            'Die Anthropic-API meldet Fehler ' . $status . '.',
            $gemeldet !== '' ? $gemeldet : kurz($rumpf),
        ),
    };
}

/**
 * Der Schlüssel des Servers — und nur der.
 *
 * Hier stand einmal ein Rückfall auf die Kopfzeile X-Anthropic-Schluessel:
 * Besucher konnten einen eigenen Schlüssel im Browser hinterlegen, solange
 * der Server keinen hatte. Dieser Weg ist vollständig abgeschafft, samt
 * Oberfläche, Kopfzeile und CORS-Freigabe. Der Grund steht in der
 * Geschichte des 31.08.: Ein längst widerrufener Schlüssel aus einem alten
 * Browser-Zwischenspeicher überstimmte den gültigen des Servers, und der
 * Leser sass in einer Schleife aus Fehlermeldungen fest, deren Ursache er
 * nicht sehen konnte. Ein Geheimnis, das in fremden Browsern liegt, altert
 * schlecht — deshalb liegt es nur noch an einer Stelle.
 */
function anthropicSchluessel(array $llm): string
{
    return trim((string) $llm['anthropic_schluessel']);
}
