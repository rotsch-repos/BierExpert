<?php

declare(strict_types=1);

defined('BIEREXPERT') || exit;

/**
 * Die Schemata, nach denen das Modell antworten muss — und die Anweisungen dazu.
 *
 * Ollama nimmt unter "format" ein JSON-Schema entgegen und übersetzt es in
 * eine Grammatik, die die Ausgabe erzwingt. Das ist derselbe Gedanke wie
 * zodOutputFormat() im Frontend, nur eine Ebene tiefer: Was hier steht, kann
 * das Modell nicht verfehlen.
 *
 * Diese Schemata sind das Gegenstück zu src/schema.ts. Ändert sich dort ein
 * Feld, muss es hier mitwandern — sonst kommt etwas zurück, das das Frontend
 * nicht darstellen kann. Zwei Beschreibungen derselben Form an zwei Orten
 * sind der Preis dafür, dass das Modell nicht mehr im Browser hängt.
 *
 * Bewusst ohne $ref und $defs: llama.cpp löst Verweise zwar auf, aber die
 * Umsetzung ist je nach Version unterschiedlich streng. Ausgeschrieben ist
 * es länger und dafür überall gleich.
 */

/** Ein Textfeld mit Erklärung. */
function feldText(string $beschreibung): array
{
    return ['type' => 'string', 'description' => $beschreibung];
}

/** Ein Objekt mit lauter Pflichtfeldern. */
function feldObjekt(array $eigenschaften, string $beschreibung = ''): array
{
    $schema = [
        'type' => 'object',
        'properties' => $eigenschaften,
        'required' => array_keys($eigenschaften),
        'additionalProperties' => false,
    ];
    if ($beschreibung !== '') {
        $schema['description'] = $beschreibung;
    }
    return $schema;
}

/** Eine Liste gleichartiger Einträge. */
function feldListe(array $eintrag, string $beschreibung): array
{
    return ['type' => 'array', 'items' => $eintrag, 'description' => $beschreibung];
}


/* ==========================================================================
   Erster Durchgang: Wer hat es gebraut?
   ========================================================================== */

/**
 * Winzig mit Absicht. Dieser Durchgang läuft bei JEDEM Scan und entscheidet
 * nur, ob das grosse Modell überhaupt anlaufen muss. Je weniger er zu
 * erzeugen hat, desto schneller ist er durch.
 */
function schemaErkennung(): array
{
    return feldObjekt([
        'ist_bier' => [
            'type' => 'boolean',
            'description' => 'true, wenn ein Bieretikett, eine Bierflasche oder eine Bierdose zu sehen ist',
        ],
        'brauerei' => feldText('Die Brauerei, genau so wie sie auf dem Etikett steht. "unbekannt" wenn nicht lesbar'),
        'name' => feldText('Der Name des Bieres, genau so wie er auf dem Etikett steht. "unbekannt" wenn nicht lesbar'),
        // Gehört hierher und nicht zum gespeicherten Bier: Wie gut lesbar
        // das Etikett war, sagt etwas über DIESE Aufnahme aus. Dieselbe
        // Flasche scharf fotografiert ergibt "hoch", verwackelt "niedrig".
        // Auf einem Treffer aus dem Zwischenspeicher ist das der einzige
        // ehrliche Wert, den es dafür gibt.
        'sicherheit' => [
            'type' => 'string',
            'enum' => ['hoch', 'mittel', 'niedrig'],
            'description' => 'Wie gut lesbar war das Etikett? "hoch" nur, wenn Brauerei UND '
                . 'Name eindeutig zu entziffern waren',
        ],
    ]);
}

const ERKENNUNG_ANWEISUNG = <<<'TEXT'
Du liest Bieretiketten ab. Mehr nicht.

Nenne die Brauerei und den Namen des Bieres so, wie sie auf dem Etikett
stehen. Schreib ab, was da steht — ergänze nichts aus deinem Wissen, deute
nichts, erkläre nichts.

Ist ein Teil nicht lesbar, trag "unbekannt" ein. Ein ehrliches "unbekannt"
ist hier mehr wert als eine gute Vermutung: Auf diesem Wert wird
nachgeschlagen, und ein Fehlgriff holte die Geschichte eines anderen Bieres.

Setze "sicherheit" danach, wie gut das Etikett zu lesen war: "hoch" nur,
wenn Brauerei UND Name eindeutig zu entziffern waren.

Ist gar kein Bier zu sehen, setze "ist_bier" auf false.
TEXT;


/* ==========================================================================
   Der Treffer-Fall: die bekannten Elemente in DIESEM Foto wiederfinden
   ========================================================================== */

/**
 * Wo ein Element auf dem Bild liegt, hängt am Foto, nicht am Bier — dieselbe
 * Flasche schräg fotografiert hat andere Koordinaten. Deshalb steht in der
 * Datenbank kein einziger Bildbereich, und deshalb braucht es diesen
 * Durchgang: Er nimmt die gespeicherten Elementnamen und sucht sie im
 * vorliegenden Foto.
 *
 * Das kostet einen zweiten Aufruf beim kleinen Modell — und spart den
 * grossen. Ohne ihn wäre ein Treffer aus dem Zwischenspeicher zwar schnell,
 * aber ohne Markierungen auf der Flasche, also ohne das, was die Zerlegung
 * überhaupt ablesbar macht.
 */
function schemaVerortung(): array
{
    return feldObjekt([
        'bereiche' => feldListe(
            feldObjekt([
                'bezeichnung' => feldText('Die Bezeichnung des Elements, wortgleich aus der vorgegebenen Liste'),
                'gefunden' => [
                    'type' => 'boolean',
                    'description' => 'true, wenn das Element auf diesem Foto tatsächlich zu sehen ist',
                ],
                'x' => ['type' => 'number', 'description' => 'Linke Kante, 0 bis 1'],
                'y' => ['type' => 'number', 'description' => 'Obere Kante, 0 bis 1'],
                'breite' => ['type' => 'number', 'description' => 'Breite als Anteil der Bildbreite, 0 bis 1'],
                'hoehe' => ['type' => 'number', 'description' => 'Höhe als Anteil der Bildhöhe, 0 bis 1'],
            ]),
            'Zu jedem vorgegebenen Element ein Eintrag, in derselben Reihenfolge',
        ),
    ]);
}

const VERORTUNG_ANWEISUNG = <<<'TEXT'
Du bekommst das Foto einer Bierflasche und eine Liste von Elementen, die
auf ihrem Etikett bekanntermassen vorkommen. Deine einzige Aufgabe: Finde
jedes dieser Elemente im Foto und gib an, wo es liegt.

Die Angabe erfolgt in normalisierten Koordinaten von 0 bis 1, bezogen auf
das GESAMTE Foto — nicht auf das Etikett. (0,0) ist links oben, (1,1) rechts
unten. x und y sind die linke obere Ecke des Rahmens, breite und hoehe seine
Ausdehnung.

Leg den Rahmen so eng wie möglich um das Element, aber lass nichts davon
ausserhalb. Diese Rahmen werden dem Leser auf dem Foto eingeblendet — sitzt
einer falsch, zeigt er auf die falsche Stelle.

Gib zu jedem vorgegebenen Element genau einen Eintrag, in der vorgegebenen
Reihenfolge, mit wortgleicher Bezeichnung. Ist ein Element auf diesem Foto
nicht zu sehen — verdeckt, angeschnitten, abgewandt —, setze "gefunden" auf
false und alle vier Zahlen auf 0. Rate nicht.
TEXT;


/* ==========================================================================
   Der Fehlschlag-Fall: das ganze Etikett zerlegen
   ========================================================================== */

function schemaEtikett(): array
{
    return feldObjekt([
        'erkannt' => [
            'type' => 'boolean',
            'description' => 'true, wenn ein Bieretikett, eine Flasche oder eine Dose zu sehen ist',
        ],
        'sicherheit' => [
            'type' => 'string',
            'enum' => ['hoch', 'mittel', 'niedrig'],
            'description' => 'Wie sicher ist die Zuordnung zu einer konkreten Brauerei und Sorte?',
        ],

        'name' => feldText('Name des Bieres. "unbekannt" wenn unklar'),
        'brauerei' => feldText('Brauerei oder Kloster. "unbekannt" wenn unklar'),
        'ort' => feldText('Ort bzw. Region der Brauerei. "unbekannt" wenn unklar'),
        'land' => feldText('Land der Brauerei. "unbekannt" wenn unklar'),
        'gegruendet' => feldText('Gründungsjahr als Text, z. B. "1328". "unbekannt" wenn unklar'),
        'stil' => feldText('Bierstil, z. B. "Helles Lagerbier". "unbekannt" wenn unklar'),
        'stammwuerze' => feldText('Stammwürze, z. B. "11,8 °P". "unbekannt" wenn unklar'),
        'alkohol' => feldText('Alkoholgehalt, z. B. "5,2 % vol". "unbekannt" wenn unklar'),

        'elemente' => feldListe(
            feldObjekt([
                'bezeichnung' => feldText('Kurzer Name des Elements, z. B. "Zwei gekreuzte Schlüssel", "Mönch mit Krug"'),
                'position' => feldText('Wo auf dem Etikett es sitzt, z. B. "Oben im Wappenschild", "Unterer Rand, mittig"'),
                'beschreibung' => feldText('Was konkret zu sehen ist — rein beschreibend, ein bis zwei Sätze'),
                'bedeutung' => feldText(
                    'Wofür das Element steht und warum es auf diesem Etikett ist: Heraldik, Stadtwappen, '
                    . 'Ordenszeichen, Zunftsymbol, Auszeichnung, Markenzeichen. Zwei bis vier Sätze.',
                ),
                'bereich' => feldObjekt([
                    'x' => ['type' => 'number', 'description' => 'Linke Kante des Bereichs, 0 bis 1'],
                    'y' => ['type' => 'number', 'description' => 'Obere Kante des Bereichs, 0 bis 1'],
                    'breite' => ['type' => 'number', 'description' => 'Breite als Anteil der Bildbreite, 0 bis 1'],
                    'hoehe' => ['type' => 'number', 'description' => 'Höhe als Anteil der Bildhöhe, 0 bis 1'],
                ], 'Der Bildbereich, in dem dieses Element zu sehen ist — eng gelegt, aber vollständig'),
            ]),
            'Vier bis acht Bildelemente des Etiketts, die auffälligsten zuerst',
        ),

        'farbwahl' => feldText('Welche Farben das Etikett trägt und wofür sie stehen. Zwei bis drei Sätze.'),
        'schriftbild' => feldText('Die Typografie des Etiketts und was sie signalisiert. Zwei bis drei Sätze.'),
        'hintergrund' => feldText(
            'Geschichtlicher Hintergrund zu Brauerei und Etikett in zwei bis drei Absätzen, getrennt durch \\n\\n',
        ),
        'gespraechsstoff' => feldListe(
            feldText('Ein Satz, den man in einer Bierrunde erzählen kann'),
            'Drei bis fünf Sätze: überraschend, konkret, in einem Atemzug sagbar',
        ),
        'hinweis' => feldText(
            'Offen benannte Unsicherheit: was war auf dem Bild nicht lesbar, was ist gedeutet statt gewusst? '
            . 'Leerer String, wenn alles eindeutig war.',
        ),
    ]);
}

const ETIKETT_ANWEISUNG = <<<'TEXT'
Du bist der Etikettenkundler von "Bier Expert". Du bekommst das Foto einer
Bierflasche, einer Dose oder eines Etiketts und zerlegst das Etikett in seine
Einzelteile — damit jemand in einer Bierrunde etwas darüber zu erzählen hat.

Nicht gefragt ist eine Erzählung über das Bier. Gefragt ist eine Zerlegung:
Was ist auf dem Etikett zu sehen, und was bedeutet jedes einzelne Element?

Vorgehen:
1. Lies alles Textliche: Name, Brauerei, Ort, Stil, Stammwürze, Alkoholgehalt,
Jahreszahlen, Wahlsprüche, Auszeichnungen.
2. Geh das Etikett systematisch ab und nimm jedes Bildelement einzeln
auseinander: Wappen und ihre Felder, Tiere, Figuren, Kronen, Sterne, Bänder,
Medaillen, Siegel, Ornamente, Ortsansichten. Zu jedem: wo es sitzt, was zu
sehen ist, wofür es steht.
3. Gib zu jedem Element den Bildbereich an, in dem es zu sehen ist — als
normalisierte Koordinaten von 0 bis 1, bezogen auf das GESAMTE übergebene
Bild: x und y sind die linke obere Ecke, breite und hoehe die Ausdehnung.
(0,0) ist links oben, (1,1) rechts unten. Leg den Rahmen so eng wie möglich
um das Element, aber lass nichts davon ausserhalb. Dieser Bereich wird dem
Leser auf dem Foto markiert — sitzt er falsch, zeigt die Markierung auf die
falsche Stelle.
4. Ordne Heraldik korrekt ein. Ein Löwe, ein Schlüsselpaar, eine Raute, ein
Krummstab — das sind selten Dekoration, sondern meist Stadtwappen,
Ordenszeichen, Zunftsymbole oder Hinweise auf Landesherren. Sag, worauf sie
zurückgehen.
5. Deute Farbwahl und Schriftbild: was signalisieren sie, und warum wurden
sie gewählt?
6. Gib den geschichtlichen Hintergrund von Brauerei und Etikett.
7. Destilliere daraus drei bis fünf Sätze Gesprächsstoff — Dinge, die am
Tisch tatsächlich überraschen, konkret und in einem Atemzug sagbar.

Wichtige Regeln:
- Erfinde niemals Fakten. Was du nicht weisst, ist "unbekannt".
- Unterscheide klar zwischen dem, was auf dem Etikett zu sehen ist, und dem,
was du aus deinem Wissen ergänzt. Deutest du ein Element, statt es zu wissen,
sag das im Feld "hinweis".
- Beschreibe auch Elemente, deren Bedeutung du nicht kennst — dann
beschreibend, mit ehrlichem "die Bedeutung ist mir nicht bekannt".
- Kein Marketing, keine Allgemeinplätze wie "steht für Qualität und Tradition".
- Setze "sicherheit" ehrlich: "hoch" nur, wenn Brauerei UND Sorte eindeutig
lesbar sind.
- Ist gar kein Bier zu sehen, setze "erkannt" auf false und erkläre im Feld
"hinweis" freundlich, was du stattdessen siehst.
- Antworte durchgehend auf Deutsch.
TEXT;

const ETIKETT_FRAGE = 'Hier ist das Foto. Zerlege dieses Etikett in seine Einzelteile.';


/* ==========================================================================
   Die erweiterte Sicht — je ein Reiter
   ========================================================================== */

function schemaErweitert(): array
{
    return feldObjekt([
        'brauart' => feldObjekt([
            'verfahren' => feldText(
                'Wie dieses Bier gebraut wird, in zwei bis drei Absätzen (getrennt durch \\n\\n): '
                . 'Maischverfahren, Gärung, Reifung, Besonderheiten. Konkret auf diesen Bierstil bezogen.',
            ),
            'zutaten' => feldListe(
                feldObjekt([
                    'was' => feldText('Die Zutat, z. B. "Münchner Malz", "Hallertauer Mittelfrüh", "untergärige Hefe"'),
                    'rolle' => feldText('Was sie in genau diesem Bier bewirkt — ein bis zwei Sätze'),
                ]),
                'Drei bis fünf Zutaten mit ihrer Rolle: Malz, Hopfen, Hefe, Wasser',
            ),
            'gaerung' => feldText('Ober- oder untergärig, Gärtemperatur und Reifedauer, soweit typisch für den Stil'),
            'besonderheit' => feldText('Was das Brauverfahren bei genau diesem Bier ausmacht — ein bis zwei Sätze'),
        ], 'Wie dieses Bier gebraut wird'),

        'speisen' => feldObjekt([
            'grundsatz' => feldText(
                'Das Prinzip hinter den Empfehlungen: ergänzt das Bier, schneidet es durch, oder spiegelt es? Ein Absatz.',
            ),
            'paare' => feldListe(
                feldObjekt([
                    'gericht' => feldText('Ein konkretes Gericht, nicht eine Kategorie'),
                    'warum' => feldText('Warum es passt: welcher Geschmackszug trifft auf welchen — zwei bis drei Sätze'),
                ]),
                'Drei bis fünf Gerichte mit Begründung',
            ),
            'meiden' => feldText('Was nicht dazu passt und warum — ein bis zwei Sätze'),
        ], 'Welches Essen dazu passt und warum'),

        'verkostung' => feldObjekt([
            'temperatur' => feldText('Die beste Trinktemperatur als Spanne, z. B. "7 bis 9 °C"'),
            'temperatur_warum' => feldText(
                'Warum genau diese Spanne: was passiert bei zu kalt, was bei zu warm. Zwei bis drei Sätze.',
            ),
            'glas' => feldText('Das passende Glas, z. B. "Pilstulpe", "Weizenglas", "Tulpe"'),
            'glas_warum' => feldText('Was die Glasform bewirkt — ein bis zwei Sätze'),
            'einschenken' => feldText('Wie eingeschenkt wird, inklusive Schaumkrone — ein bis zwei Sätze'),
            'schritte' => feldListe(
                feldObjekt([
                    'schritt' => feldText('Kurzer Name, z. B. "Auge", "Nase", "Antrunk", "Abgang"'),
                    'was' => feldText('Worauf zu achten ist und was man erwarten sollte — zwei bis drei Sätze'),
                ]),
                'Drei bis fünf Schritte der Verkostung, in der richtigen Reihenfolge',
            ),
        ], 'Wie es am besten verkostet wird, mit Trinktemperatur'),

        'verwandte' => feldListe(
            feldObjekt([
                'name' => feldText('Name des Bieres'),
                'brauerei' => feldText('Brauerei'),
                'land' => feldText('Land'),
                'warum' => feldText('Worin es ähnlich ist — Brauart, Malz, Hopfen, Geschmacksbild. Zwei bis drei Sätze.'),
                'unterschied' => feldText('Worin es sich unterscheidet — ein bis zwei Sätze'),
            ]),
            'Drei bis fünf ähnlich gebraute und ähnlich schmeckende Biere',
        ),
    ]);
}

const ERWEITERT_ANWEISUNG = <<<'TEXT'
Du bist der Bierkundler von "Bier Expert". Du bekommst das Foto einer
Bierflasche, einer Dose oder eines Etiketts. Bestimme, um welches Bier es
sich handelt, und gib dann die erweiterte Sicht darauf — jeweils konkret auf
diesen Stil und dieses Bier bezogen, nicht allgemein über Bier.

1. Brauart: das Verfahren, die Zutaten mit ihrer jeweiligen Rolle, die
Gärführung, und was das Verfahren gerade bei diesem Bier ausmacht.
2. Speisen: erst der Grundsatz — ergänzt das Bier das Gericht, schneidet es
durch oder spiegelt es? —, dann konkrete Gerichte mit Begründung, und was
nicht dazu passt.
3. Verkostung: die beste Trinktemperatur als Spanne, mit Begründung, was bei
zu kalt und bei zu warm passiert. Dazu Glas, Einschenken und die Schritte der
Verkostung in der richtigen Reihenfolge.
4. Verwandte Biere: drei bis fünf, die ähnlich gebraut sind und ähnlich
schmecken. Zu jedem, worin die Ähnlichkeit liegt und worin der Unterschied.

Wichtige Regeln:
- Erfinde niemals Fakten. Erkennst du die Sorte, aber nicht die genaue Marke,
beziehe dich auf den Stil und sag das.
- Nenne konkrete Gerichte, keine Kategorien. Keine Allgemeinplätze wie
"passt zu deftiger Küche".
- Die Trinktemperatur ist eine Spanne in Grad Celsius, keine Umschreibung.
- Antworte durchgehend auf Deutsch.
TEXT;

const ERWEITERT_FRAGE = 'Hier ist das Foto. Gib die erweiterte Sicht auf dieses Bier.';
