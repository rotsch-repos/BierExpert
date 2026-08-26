<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Draht zum eigenen Sprachmodell.
 *
 * Das Modell läuft nicht hier, sondern auf dem Rechner des Betreibers und ist
 * über einen Tunnel erreichbar. Dieses Backend sitzt dazwischen, aus einem
 * Grund: Läge der Aufruf im Browser, stünde die Adresse des Modells — und ein
 * etwaiger Schlüssel dafür — in jedem Seitenquelltext. Ein Modell auf eigener
 * Hardware ist keins mit Abrechnung nach Verbrauch, aber es ist auch keins,
 * das die halbe Welt benutzen soll.
 *
 * Angesprochen wird /api/chat mit stream=false. Nicht gestreamt, weil das
 * Frontend die Antwort ohnehin erst vollständig braucht: Es baut daraus eine
 * Zerlegung mit Markierungen, kein fortlaufendes Textband.
 */

/**
 * Ruft das Modell auf und gibt die geprüfte Antwort als Array zurück.
 *
 * @param string      $anweisung   Die Systemanweisung
 * @param string      $frage       Was der Benutzer fragt
 * @param array       $schema      JSON-Schema, dem die Antwort folgen MUSS
 * @param string|null $bildBase64  Das Foto, falls das Modell es sehen soll
 * @param bool        $schnell     Kleines Modell und kurze Zeitgrenze
 */
function modellFragen(
    string $anweisung,
    string $frage,
    array $schema,
    ?string $bildBase64 = null,
    bool $schnell = false,
): array {
    $llm = konfiguration()['llm'];

    // Die Weiche: Wer die Frage beantwortet, entscheidet die Konfiguration,
    // nicht die Aufrufstelle. Für die Endpunkte ist beides dasselbe Modell.
    //
    // Entschieden wird je Stufe, nicht je Anlage. Das erlaubt die Mischung,
    // auf die der Betrieb hier hinausläuft: das Ablesen beim eigenen kleinen
    // Modell — es läuft bei jedem Scan und kostet dort nichts —, das
    // Zerlegen eines noch unbekannten Etiketts bei Anthropic, wo es einmal
    // je Bier anfällt und dafür stimmt.
    $anbieter = $schnell ? $llm['anbieter_schnell'] : $llm['anbieter_tief'];

    if ($anbieter === 'anthropic') {
        return anthropicFragen($anweisung, $frage, $schema, $bildBase64, $schnell);
    }

    if ($llm['endpunkt'] === '') {
        throw new BierFehler(
            'Es ist kein Sprachmodell hinterlegt.',
            'In der Konfiguration fehlt llm.endpunkt — die Adresse, unter der Ollama antwortet.',
            503,
        );
    }

    $nachricht = ['role' => 'user', 'content' => $frage];
    $nachrichten = [['role' => 'system', 'content' => $anweisung], $nachricht];

    if ($bildBase64 !== null) {
        // Ollama erwartet das Bild als base64 ohne den "data:"-Vorspann —
        // genau so, wie es das Frontend ohnehin schickt.
        $nachricht['images'] = [$bildBase64];

        // Und hier steht die Anweisung ausnahmsweise IM Text der Frage statt
        // in einer eigenen system-Nachricht.
        //
        // Das ist ein Umweg um einen Fehler in Ollama, nicht um einen in uns:
        // Kommt zu einem Bild eine system-Nachricht dazu, bricht llama-server
        // im Bildpfad mit "CUDA error: an illegal memory access was
        // encountered" ab (ggml_cuda_op_mul, direkt nach "clip_ctx: CLIP
        // using CUDA0 backend"). Der Prozess stirbt, Ollama startet ihn neu,
        // und die nächste Anfrage läuft in dasselbe Messer.
        //
        // Gemessen am 25.08.2026 auf dieser Maschine (Ollama 0.32.15,
        // Treiber 595.84, qwen3-vl:30b): mit dem Testetikett aus tests/
        // 18 Anfragen mit system-Nachricht, 18 Abstürze — dieselbe Anweisung
        // im user-Text: 8 von 8 durch. Weder format noch num_ctx noch
        // temperature noch keep_alive noch Bildformat, Bildgrösse oder
        // Prompt-Länge ändern etwas daran.
        //
        // Es hängt allerdings nicht an der Rolle allein: Mit einem anderen
        // Foto lief dieselbe system-Variante 5 von 5 durch. Welches Bild den
        // Fehler auslöst, liess sich nicht vorhersagen — die Rolle war die
        // einzige Stellschraube, die ihn zuverlässig vermied. Genau deshalb
        // steht hier ein Umweg und keine Bedingung: Ob dieses Bild betroffen
        // wäre, weiss vorher niemand.
        //
        // Nur bei Bildern: Ohne Bild gibt es den Fehler nicht, und dort ist
        // die system-Rolle das Richtige. Fällt der Fehler in einer künftigen
        // Ollama-Fassung weg, gehört dieser Block ersatzlos gestrichen.
        //
        // Der Weg über Anthropic bleibt davon unberührt — dort ist die
        // system-Rolle korrekt und funktioniert.
        $nachricht['content'] = $anweisung . "\n\n" . $frage;
        $nachrichten = [$nachricht];
    }

    $rumpf = [
        'model' => $schnell ? $llm['modell_schnell'] : $llm['modell'],
        'messages' => $nachrichten,
        'stream' => false,
        // Das Schema wird serverseitig in eine Grammatik übersetzt, die das
        // Modell beim Erzeugen einschränkt. Es KANN dann nichts anderes
        // ausgeben als eine Antwort dieser Form.
        'format' => $schema,
        'options' => [
            // Niedrig: Gefragt sind Tatsachen vom Etikett, keine Einfälle.
            'temperature' => $schnell ? 0.1 : 0.4,
            // Ein Bild belegt je nach Auflösung schnell mehrere tausend
            // Token. Bleibt der Kontext auf der Voreinstellung von 4096,
            // fällt der Anfang der Anweisung heraus — und das Modell
            // antwortet auf eine Frage, die es nur noch halb kennt.
            'num_ctx' => $schnell ? 8192 : 16384,
        ],
        // Kein Nachdenken bei der schnellen Stufe.
        //
        // Gemessen am 26.08. mit qwen3-vl:8b: Bei eingeschaltetem Denken
        // erzeugte das Modell auf einem Foto mit mehreren Etiketten 6889
        // Token, davon KEIN einziges als Antwort — es zerredete sich in
        // "Wait, ... Wait, ..." bis zur Token-Grenze und lieferte einen
        // leeren Inhalt nach 68 Sekunden. Drei von drei Versuchen, immer
        // gleich. Mit abgeschaltetem Denken: dieselbe Aufgabe in 0,5 s mit
        // 43 Token.
        //
        // Und das ist kein Zufall dieses einen Bildes, sondern liegt in der
        // Aufgabe: Abgeschrieben werden soll, was auf dem Etikett steht.
        // Dabei gibt es nichts zu überlegen — jeder Gedankengang ist eine
        // Gelegenheit, sich von dem zu entfernen, was dasteht.
        //
        // Nur für die schnelle Stufe. Die Zerlegung eines unbekannten
        // Etiketts ist eine Deutungsaufgabe; dort trägt Nachdenken bei.
        'think' => $schnell ? false : null,
        // Hält das Modell dauerhaft geladen (-1 = nie entladen). Die Karte
        // fasst beide Modelle mit diesen Kontextgrössen nebeneinander.
        //
        // Nicht Bequemlichkeit, sondern Notwehr: Hostpoint beendet eine
        // PHP-Anfrage nach rund einer Minute Wanddauer, hart und ohne
        // Rücksicht auf set_time_limit. Ein kalter Scan — Modell erst von
        // der Platte in den Grafikspeicher — liegt darüber, und der
        // Besucher sieht einen nackten 502 statt einer Antwort. Warm bleibt
        // jeder Scan weit unter der Minute. Gemessen am 25.08.: kalt 502,
        // warm fehlerfrei.
        'keep_alive' => -1,
    ];

    // Bei der tiefen Stufe gehört das Feld gar nicht erst in die Anfrage:
    // Ein ausdrückliches null hiesse "kein Denken", nicht "wie voreingestellt".
    if ($rumpf['think'] === null) {
        unset($rumpf['think']);
    }

    $antwort = anfragen(
        $llm['endpunkt'] . '/api/chat',
        $rumpf,
        $schnell ? $llm['zeitgrenze_schnell'] : $llm['zeitgrenze'],
        $llm['schluessel'],
    );

    $inhalt = $antwort['message']['content'] ?? null;

    // Ollama 0.32 legt die Antwort bei abgeschaltetem Denken in "thinking"
    // statt in "content" — der Inhalt ist richtig, nur das Fach ist falsch.
    // Beobachtet mit qwen3-vl:8b: content leer, thinking enthält das
    // vollständige Schema-JSON, done_reason "stop", 43 Token.
    //
    // Ein Fehler der Vorlage, nicht der Anwendung, und vermutlich in einer
    // künftigen Fassung erledigt. Bis dahin: nachsehen, statt einen
    // brauchbaren Fund wegzuwerfen. Fällt der Fehler weg, verhält sich
    // dieser Zweig von selbst still — dann ist "content" gefüllt.
    if (!is_string($inhalt) || trim($inhalt) === '') {
        $gedanke = $antwort['message']['thinking'] ?? null;
        if (is_string($gedanke) && str_contains($gedanke, '{')) {
            $inhalt = $gedanke;
        }
    }

    if (!is_string($inhalt) || trim($inhalt) === '') {
        // Die häufigste Ursache steht zuerst, weil sie sich beheben lässt:
        // Das Modell hat die Token-Grenze mit Nachdenken aufgebraucht.
        $grund = $antwort['done_reason'] ?? '';
        throw new BierFehler(
            'Das Sprachmodell hat nichts geantwortet.',
            $grund === 'length'
                ? 'Das Modell hat die Token-Grenze erreicht, bevor es geantwortet hat — '
                    . 'es hat sich im Nachdenken verloren. Bei der schnellen Stufe ist '
                    . 'Denken abgeschaltet; meldet die tiefe Stufe das, gehört sie auch dort aus.'
                : 'Läuft das Modell "' . $rumpf['model'] . '"? Ein "ollama list" auf dem Server zeigt es.',
        );
    }

    return jsonAusAntwort($inhalt);
}

/**
 * Schält das JSON aus der Modellantwort.
 *
 * Mit erzwungener Grammatik sollte der Inhalt reines JSON sein. Sollte.
 * Manche Modelle stellen trotzdem einen Gedankengang voran oder legen einen
 * Code-Zaun darum. Das kostet hier drei Zeilen und erspart einen
 * Fehlschlag, dessen Ursache man dem Frontend nicht ansieht.
 */
function jsonAusAntwort(string $inhalt): array
{
    $text = trim($inhalt);

    $anfang = strpos($text, '{');
    $ende = strrpos($text, '}');

    if ($anfang === false || $ende === false || $ende <= $anfang) {
        throw new BierFehler(
            'Die Antwort des Sprachmodells war kein JSON.',
            'Unterstützt das Modell strukturierte Ausgaben? Modelle ohne '
                . 'Grammatikunterstützung ignorieren das Feld "format" stillschweigend.',
        );
    }

    $roh = substr($text, $anfang, $ende - $anfang + 1);

    try {
        $daten = json_decode($roh, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $fehler) {
        throw new BierFehler(
            'Die Antwort des Sprachmodells war unlesbar.',
            $fehler->getMessage(),
        );
    }

    if (!is_array($daten)) {
        throw new BierFehler('Die Antwort des Sprachmodells hatte nicht die erwartete Form.');
    }

    return $daten;
}

/** Ein POST mit JSON hin und JSON zurück. */
function anfragen(string $adresse, array $rumpf, int $zeitgrenze, string $schluessel): array
{
    $kopfzeilen = ['Content-Type: application/json', 'Accept: application/json'];
    if ($schluessel !== '') {
        // Für den Fall, dass vor Ollama ein nginx steht, der einen Schlüssel
        // verlangt. Ollama selbst kennt keine Anmeldung.
        $kopfzeilen[] = 'Authorization: Bearer ' . $schluessel;
    }

    $griff = curl_init($adresse);

    if ($griff === false) {
        throw new BierFehler('Die Anfrage an das Sprachmodell liess sich nicht vorbereiten.', null, 500);
    }

    curl_setopt_array($griff, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($rumpf, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER => $kopfzeilen,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $zeitgrenze,
        // Getrennt von der Gesamtzeit: Steht der Tunnel nicht, soll das
        // nach zehn Sekunden feststehen und nicht nach fünf Minuten.
        CURLOPT_CONNECTTIMEOUT => 10,
        // Die Adresse ist fest hinterlegt. Einer Umleitung zu folgen hiesse,
        // das Bild an einen Ort zu schicken, den niemand eingetragen hat.
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    // Der Herzschlag, solange das Modell rechnet.
    //
    // Die Fortschrittsfunktion ist der einzige Ort, an dem sich während
    // einer blockierenden Anfrage überhaupt etwas tun lässt: curl ruft sie
    // etwa im Sekundentakt auf, auch wenn noch kein einziges Byte
    // zurückgekommen ist. Genau das ist hier der Normalfall — Ollama
    // antwortet erst, wenn es fertig gerechnet hat.
    //
    // Ohne diesen Griff bliebe die Strecke zwischen Anfrage und Antwort
    // vollkommen stumm, und das ist die Stille, an der Cloudflare eine
    // Verbindung abbricht.
    if (stromAktiv()) {
        $puls = pulsgeber(stromStufe());
        curl_setopt_array($griff, [
            CURLOPT_NOPROGRESS => false,
            CURLOPT_XFERINFOFUNCTION => static function () use ($puls): int {
                $puls();

                // 0 heisst "weitermachen". Alles andere bräche die
                // Übertragung ab — der Rückgabewert ist hier kein Beiwerk.
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
        throw statusFehler($status, is_string($roh) ? $roh : '', $adresse);
    }

    try {
        $daten = json_decode((string) $roh, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new BierFehler(
            'Unter der Adresse des Sprachmodells antwortet etwas anderes.',
            'Zurück kam kein JSON, sondern: ' . kurz((string) $roh),
        );
    }

    if (!is_array($daten)) {
        throw new BierFehler('Das Sprachmodell hat unerwartet geantwortet.');
    }

    return $daten;
}

/** Übersetzt einen Verbindungsfehler in etwas Handlungsfähiges. */
function netzFehler(int $nummer, string $text, string $adresse, int $zeitgrenze): BierFehler
{
    $wirt = parse_url($adresse, PHP_URL_HOST) ?: $adresse;

    return match ($nummer) {
        CURLE_OPERATION_TIMEDOUT => new BierFehler(
            'Das Sprachmodell hat nicht rechtzeitig geantwortet.',
            'Nach ' . $zeitgrenze . ' Sekunden kam nichts zurück. Ein grosses Modell braucht '
                . 'beim ersten Aufruf lange, weil es erst in den Speicher geladen wird — '
                . 'der zweite Versuch ist meist deutlich schneller.',
            504,
        ),
        CURLE_COULDNT_CONNECT, CURLE_COULDNT_RESOLVE_HOST => new BierFehler(
            'Das Sprachmodell ist nicht erreichbar.',
            'Keine Verbindung zu ' . $wirt . '. Läuft der Rechner, läuft Ollama, steht der Tunnel?',
            503,
        ),
        CURLE_SSL_CACERT, CURLE_PEER_FAILED_VERIFICATION, CURLE_SSL_CONNECT_ERROR => new BierFehler(
            'Das Zertifikat des Sprachmodells wurde nicht akzeptiert.',
            $text,
            502,
        ),
        default => new BierFehler('Die Verbindung zum Sprachmodell ist gescheitert.', $text),
    };
}

/** Übersetzt einen Fehlerstatus in etwas Handlungsfähiges. */
function statusFehler(int $status, string $rumpf, string $adresse): BierFehler
{
    // Ollama legt seine Fehler unter "error" ab. Steht da etwas, ist es die
    // genauere Auskunft als alles, was sich hier formulieren liesse.
    $gemeldet = '';
    $daten = json_decode($rumpf, true);
    if (is_array($daten) && isset($daten['error']) && is_string($daten['error'])) {
        $gemeldet = $daten['error'];
    }

    return match (true) {
        $status === 401 || $status === 403 => new BierFehler(
            'Der Zugang zum Sprachmodell wurde abgewiesen.',
            'Steht ein nginx davor, der einen Schlüssel verlangt? Der gehört in der '
                . 'Konfiguration unter llm.schluessel.',
            502,
        ),
        $status === 404 => new BierFehler(
            'Unter dieser Adresse antwortet Ollama nicht.',
            ($gemeldet !== '' ? $gemeldet . ' — ' : '')
                . 'Erwartet wird ' . $adresse . '. Zeigt llm.endpunkt auf die Wurzel des '
                . 'Dienstes, ohne "/api" am Ende?',
            502,
        ),
        $status === 429 || $status === 503 => new BierFehler(
            'Zu viele Anfragen in kurzer Zeit.',
            ($gemeldet !== '' ? $gemeldet . ' — ' : '')
                . 'Vor dem Modell steht eine Drosselung, und alle Anfragen dieser Seite '
                . 'kommen von derselben Adresse — sie teilen sich also einen Eimer. '
                . 'Warte einen Augenblick und versuch es erneut.',
            503,
        ),
        $status === 413 => new BierFehler(
            'Das Bild war für den Server vor dem Modell zu gross.',
            'In der nginx-Konfiguration client_max_body_size erhöhen — ein Foto als base64 '
                . 'braucht schnell mehrere Megabyte.',
            502,
        ),
        $status >= 500 => new BierFehler(
            'Das Sprachmodell meldet einen Fehler.',
            $gemeldet !== '' ? $gemeldet : kurz($rumpf),
            502,
        ),
        default => new BierFehler(
            'Das Sprachmodell hat mit Status ' . $status . ' geantwortet.',
            $gemeldet !== '' ? $gemeldet : kurz($rumpf),
            502,
        ),
    };
}

/** Kürzt Fremdtext, damit eine HTML-Fehlerseite nicht die ganze Antwort füllt. */
function kurz(string $text, int $zeichen = 300): string
{
    $text = trim(preg_replace('/\s+/', ' ', strip_tags($text)) ?? '');
    return strlen($text) > $zeichen ? substr($text, 0, $zeichen) . ' …' : $text;
}
