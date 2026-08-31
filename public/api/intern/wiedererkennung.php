<?php

declare(strict_types=1);

/**
 * Welches bekannte Bier ist das auf dem Foto — und wie sicher?
 *
 * Bis zum 31.08. hing diese Frage an einem einzigen Signal: dem Text, den
 * das kleine Modell aus dem Etikett ablas. Daraus wurde ein Schlüssel
 * gebildet, und über den wurde gesucht. Ein Sprachmodell antwortet aber
 * nicht zweimal garantiert gleich — dasselbe Foto ergab zwei verschiedene
 * Schlüssel, beide gingen ins Leere, beide kosteten eine bezahlte
 * Zerlegung, und es entstanden zwei Einträge für dasselbe Bier.
 *
 * Ein einzelnes unsicheres Signal lässt sich nicht sicher machen. Man kann
 * ihm aber andere zur Seite stellen, die auf ganz andere Weise irren:
 *
 *   1. FARBSIGNATUR — Mikrosekunden. Siebt auf eine Handvoll Kandidaten.
 *      Irrt bei Bieren derselben Brauerei, die sich die Hausfarben teilen.
 *   2. PRODUKTNAME — läuft ohnehin mit. Irrt beim Ablesen, aber anders:
 *      Ein falsch gelesener Name ist selten die exakte Farbe eines anderen
 *      Etiketts.
 *   3. REGISTRIERUNG — rund 30 ms je Kandidat. Vergleicht markante Punkte
 *      im Bild und liefert ein Vertrauensmass. Das ist das eigentliche
 *      Urteil; die beiden davor sorgen nur dafür, dass es nicht gegen jedes
 *      Bier der Datenbank gefällt werden muss.
 *
 * Am Ende steht eine Wahrscheinlichkeit und kein Ja/Nein. Denn es gibt
 * einen dritten Zustand, den die alte Suche nicht kannte und der der
 * ehrlichste von allen ist: "wahrscheinlich dieses, aber frag lieber
 * nach". Ein Mensch entscheidet das in einer Sekunde sicher.
 */

/**
 * Ab hier gilt das Bier als erkannt und wird ohne Rückfrage ausgegeben.
 *
 * Bewusst hoch: Ein falscher Treffer ist schlimmer als eine Rückfrage. Er
 * zeigt dem Leser ein fremdes Bier als seines, und niemand merkt es —
 * während eine Rückfrage nur eine Sekunde kostet.
 */
const WIEDERERKENNUNG_SICHER = 0.82;

/** Darunter gilt das Bier als unbekannt. Dazwischen wird gefragt. */
const WIEDERERKENNUNG_FRAGEN = 0.50;

/**
 * So viele Kandidaten gehen in die teure Prüfung.
 *
 * Hier stand einmal zusätzlich eine Mindestähnlichkeit, unterhalb derer ein
 * Kandidat gar nicht erst geprüft wurde. Sie ist ersatzlos weg, und dafür
 * gibt es eine Messung:
 *
 * Am 31.08. wurden zwei ECHTE Aufnahmen derselben Sol-Flasche verglichen —
 * nicht zwei Fassungen desselben Fotos, sondern zwei getrennte Aufnahmen
 * mit eigenem Licht und eigenem Winkel. Die Farbsignatur kam auf 0,527. Für
 * zwei FREMDE Biere hatte dieselbe Rechnung 0,45 ergeben. Der Abstand
 * zwischen "dasselbe Bier" und "ein anderes" schrumpft bei echten Fotos
 * also auf fast nichts — meine synthetischen 0,98 hatten das Gegenteil
 * vorgegaukelt.
 *
 * Die Registrierung dagegen sagte im selben Fall 0,991 bei 997 Passpunkten.
 * Sie kann es, die Farbe kann es nicht. Eine Schwelle auf dem schwachen
 * Signal hätte den richtigen Kandidaten verworfen, BEVOR das starke ihn je
 * zu sehen bekam — der Fehler, gegen den nichts mehr hilft.
 *
 * Also keine Schwelle mehr, sondern eine Rangfolge: Die besten vier nach
 * dem billigen Mass gehen in die teure Prüfung, und die entscheidet. Was
 * das kostet, ist gedeckelt; was es rettet, ist der Treffer selbst.
 */
const WIEDERERKENNUNG_KANDIDATEN = 4;

/**
 * Sucht das Bier zum Foto.
 *
 * @param array|null $signatur   Farbsignatur des vorliegenden Fotos, falls berechenbar
 * @param string     $neuPfad    Das Foto auf der Platte, für die Registrierung
 * @param array      $erkennung  Was das kleine Modell abgelesen hat
 *
 * @return array{bier:array, wahrscheinlichkeit:float, wie:string}|null
 */
function bierWiedererkennen(?array $signatur, string $neuPfad, array $erkennung): ?array
{
    $kandidaten = bierKandidaten();

    if ($kandidaten === []) {
        return null;
    }

    $gelesen = teilVereinheitlichen((string) ($erkennung['name'] ?? ''));

    /* --- Stufe 1 und 2: billig bewerten und vorsortieren ------------------- */

    $vorsortiert = [];

    foreach ($kandidaten as $kandidat) {
        $farbe = ($signatur !== null && is_array($kandidat['farbsignatur']))
            ? signaturAehnlichkeit($signatur, $kandidat['farbsignatur'])
            : 0.0;

        $name = namensAehnlichkeit($gelesen, teilVereinheitlichen($kandidat['name']));

        $vorsortiert[] = [
            'kandidat' => $kandidat,
            'farbe' => $farbe,
            'name' => $name,
            'billig' => 0.6 * $farbe + 0.4 * $name,
        ];
    }

    if ($vorsortiert === []) {
        return null;
    }

    usort($vorsortiert, static fn (array $a, array $b): int => $b['billig'] <=> $a['billig']);
    $vorsortiert = array_slice($vorsortiert, 0, WIEDERERKENNUNG_KANDIDATEN);

    /* --- Stufe 3: teuer und entscheidend ---------------------------------- */

    $verzeichnis = konfiguration()['bilder']['verzeichnis'];
    $bester = null;

    foreach ($vorsortiert as $eintrag) {
        $referenz = $eintrag['kandidat']['referenz_bild'];

        $vertrauen = ($referenz !== null && $neuPfad !== '')
            ? registrierungVertrauen($verzeichnis . '/' . $referenz, $neuPfad)
            : 0.0;

        $wahrscheinlichkeit = wahrscheinlichkeitBilden(
            $eintrag['farbe'],
            $eintrag['name'],
            $vertrauen,
        );

        if ($bester === null || $wahrscheinlichkeit > $bester['wahrscheinlichkeit']) {
            $bester = [
                'bier' => $eintrag['kandidat'],
                'wahrscheinlichkeit' => $wahrscheinlichkeit,
                'wie' => $vertrauen > 0.0 ? 'registrierung' : 'farbe-und-name',
            ];
        }
    }

    if ($bester === null || $bester['wahrscheinlichkeit'] < WIEDERERKENNUNG_FRAGEN) {
        return null;
    }

    return $bester;
}

/**
 * Führt die drei Signale zu einer Zahl zusammen.
 *
 * Die Registrierung wiegt am schwersten, weil sie als einzige das Bild
 * selbst vergleicht statt seiner Beschreibung. Fehlt sie — das Bier hat
 * kein Referenzfoto —, bleibt das Ergebnis bewusst UNTER der Schwelle für
 * einen sicheren Treffer: Dann wird gefragt, statt zu raten. Farbe und Name
 * allein reichen für eine gute Vermutung, nicht für eine Behauptung.
 */
function wahrscheinlichkeitBilden(float $farbe, float $name, float $vertrauen): float
{
    if ($vertrauen <= 0.0) {
        $ohne = 0.55 * $farbe + 0.45 * $name;

        return min($ohne, WIEDERERKENNUNG_SICHER - 0.01);
    }

    return min(1.0, 0.65 * $vertrauen + 0.20 * $farbe + 0.15 * $name);
}

/**
 * Wie ähnlich sich zwei bereits vereinheitlichte Namen sind: 0 bis 1.
 *
 * Nicht auf Gleichheit prüfen, sondern auf Ähnlichkeit: Genau daran ist die
 * alte Suche gescheitert. "tannenzaeppl" und "tannenzaepfle" sind für einen
 * Zeichenvergleich zwei verschiedene Dinge und für jeden Menschen dasselbe.
 */
function namensAehnlichkeit(string $a, string $b): float
{
    if ($a === '' || $b === '') {
        return 0.0;
    }

    if ($a === $b) {
        return 1.0;
    }

    $abstand = levenshtein($a, $b);
    $laenge = max(strlen($a), strlen($b));

    if ($laenge === 0) {
        return 0.0;
    }

    return max(0.0, 1.0 - $abstand / $laenge);
}
