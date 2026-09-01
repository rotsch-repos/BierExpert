<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Der Draht zwischen Hoster und Workstation.
 *
 * Die Aufteilung: Die Seite liegt beim Hoster, das Modell und die
 * Bierdatenbank stehen zu Hause hinter einem Tunnel. Für jedes Foto fragt
 * der Hoster zuerst dort an — "kenne ich das Bier?" — und wendet sich nur
 * bei einem Fehlschlag an die bezahlte API.
 *
 * Warum nicht andersherum, also die Datenbank beim Hoster? Weil das Modell
 * ohnehin zu Hause steht: Die erste Stufe braucht Bild UND Datenbank, und
 * eines von beiden über das Netz zu holen kostet bei jedem einzelnen Scan
 * eine Rundreise. So bleibt beides beisammen, und über das Netz geht nur
 * das, was am Ende auch angezeigt wird.
 *
 * Diese Datei hat zwei Seiten: den Wächter für die Endpunkte auf der
 * Workstation und den Ruf für den Hoster. Sie stehen zusammen, weil sie
 * dasselbe Geheimnis teilen — auseinandergezogen driften sie auseinander.
 */

/** Dirigiert diese Anlage einen entfernten Dienst? */
function dienstAktiv(): bool
{
    return konfiguration()['dienst']['adresse'] !== '';
}

/**
 * Der Wächter: Lässt nur durch, wer das Geheimnis kennt.
 *
 * Ohne ihn könnte jeder, der die Adresse des Tunnels kennt, die Grafikkarte
 * beschäftigen und Einträge in die Bierdatenbank schreiben. Beides ist
 * nicht nur unhöflich, sondern teuer: Am Ende der Kette hängt eine bezahlte
 * API und eine Karte, die eine Anfrage nach der anderen abarbeitet.
 */
function dienstSchluesselPruefen(): void
{
    $erwartet = konfiguration()['dienst']['schluessel'];

    if ($erwartet === '') {
        // Kein Geheimnis hinterlegt heisst: Dieser Endpunkt ist nicht für
        // den Betrieb über das Netz gedacht. Ihn dann ohne Prüfung offen
        // stehen zu lassen wäre die falsche Auslegung von "nicht
        // eingerichtet" — deshalb zu statt auf.
        fehlerSenden(
            503,
            'Dieser Endpunkt ist nicht eingerichtet.',
            'In der Konfiguration fehlt dienst.schluessel. Ohne ein gemeinsames '
                . 'Geheimnis nimmt der Nachschlage-Dienst keine Anfragen an.',
        );
    }

    $mitgebracht = '';

    // Auch die REDIRECT_-Fassung: Apache auf geteiltem Hosting reicht die
    // Authorization-Kopfzeile oft nicht an PHP durch, legt sie aber nach
    // einer Rewrite-Runde unter diesem Namen ab.
    $kopf = (string) ($_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '');

    if (str_starts_with($kopf, 'Bearer ')) {
        $mitgebracht = substr($kopf, 7);
    }

    // Und als verlässlichster Weg eine eigene Kopfzeile: Die streicht kein
    // Webserver, weil keiner sie für seine eigene Anmeldung hält. Genau
    // daran scheiterte der erste Spiegel zum Hoster — die Workstation
    // schickte Bearer, Apache verschluckte ihn, und der Abgleich lief mit
    // 401 ins Leere, während die Gegenrichtung (nginx) tadellos ging.
    if ($mitgebracht === '') {
        $mitgebracht = trim((string) ($_SERVER['HTTP_X_DIENST_SCHLUESSEL'] ?? ''));
    }

    // hash_equals und nicht ===: Ein einfacher Vergleich bricht beim ersten
    // ungleichen Zeichen ab und verrät über die Laufzeit, wie viele Zeichen
    // stimmten. Bei einem Geheimnis, das jemand erraten will, ist das der
    // Unterschied zwischen aussichtslos und machbar.
    if (!hash_equals($erwartet, $mitgebracht)) {
        fehlerSenden(401, 'Nicht angemeldet.', 'Erwartet wird der Dienstschlüssel als "Authorization: Bearer …".');
    }
}

/**
 * Der Ruf: Fragt den entfernten Dienst und gibt seine Antwort zurück.
 *
 * @param  string $pfad  Etwa 'nachschlagen.php'
 * @param  array  $rumpf Was hingeschickt wird
 * @return array         Was zurückkam
 */
function dienstFragen(string $pfad, array $rumpf): array
{
    $dienst = konfiguration()['dienst'];
    $adresse = $dienst['adresse'] . '/' . ltrim($pfad, '/');

    $griff = curl_init($adresse);

    if ($griff === false) {
        throw new BierFehler('Die Anfrage an den Nachschlage-Dienst liess sich nicht vorbereiten.', null, 500);
    }

    curl_setopt_array($griff, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($rumpf, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $dienst['schluessel'],
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $dienst['zeitgrenze'],
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    // Derselbe Herzschlag wie bei den Modellaufrufen: Am anderen Ende hängt
    // eine Grafikkarte, die auch kalt sein kann. Die Strecke davor ist
    // dieselbe und darf genauso wenig verstummen.
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
        throw netzFehler($fehlernummer, $fehlertext, $adresse, $dienst['zeitgrenze']);
    }

    $daten = json_decode(is_string($roh) ? $roh : '', true);

    if (!is_array($daten)) {
        throw new BierFehler(
            'Der Nachschlage-Dienst hat nichts Lesbares geantwortet.',
            'Antwort mit Status ' . $status . '. Steht unter ' . $dienst['adresse']
                . ' wirklich der Dienst — und nicht die Anmeldeseite des Tunnels?',
        );
    }

    if ($status < 200 || $status >= 300) {
        throw new BierFehler(
            is_string($daten['fehler'] ?? null)
                ? $daten['fehler']
                : 'Der Nachschlage-Dienst meldet Fehler ' . $status . '.',
            is_string($daten['rat'] ?? null) ? $daten['rat'] : null,
            // 401 und 503 des Dienstes sind Fehler DIESER Anlage, nicht des
            // Besuchers: Der Schlüssel stimmt nicht oder der Dienst ist
            // nicht eingerichtet. Als 502 weitergereicht steht dem Leser
            // wenigstens nicht "nicht angemeldet" auf der Seite, wo er sich
            // nirgends anmelden kann.
            502,
        );
    }

    return $daten;
}
