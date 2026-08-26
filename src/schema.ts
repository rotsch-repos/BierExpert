import { z } from 'zod';

/**
 * Was das Modell zurückliefern soll: keine Erzählung, sondern eine Zerlegung
 * des Etiketts in seine Einzelteile.
 *
 * Alle Felder sind Pflichtfelder. Statt optionaler Felder, bei denen unklar
 * bleibt, ob das Modell sie vergessen oder die Information nicht gefunden hat,
 * trägt es "unbekannt" ein. Das macht das Rendern eindeutig.
 */

/**
 * Bildbereich eines Elements in normalisierten Koordinaten: 0 ist der linke
 * bzw. obere Bildrand, 1 der rechte bzw. untere. Damit bleibt die Angabe
 * unabhängig von der Auflösung — das an die API geschickte Bild und die
 * Vorschau im DOM sind dasselbe (herunterskalierte) Bild, die Werte lassen
 * sich also direkt als Prozent auf die Vorschau legen.
 */
export const BereichSchema = z.object({
  x: z.number().describe('Linke Kante des Bereichs, 0 bis 1'),
  y: z.number().describe('Obere Kante des Bereichs, 0 bis 1'),
  breite: z.number().describe('Breite als Anteil der Bildbreite, 0 bis 1'),
  hoehe: z.number().describe('Höhe als Anteil der Bildhöhe, 0 bis 1'),
});

export type Bereich = z.infer<typeof BereichSchema>;

/** Ein einzelnes Bildelement des Etiketts — der Kern der Auswertung. */
export const ElementSchema = z.object({
  bezeichnung: z
    .string()
    .describe('Kurzer Name des Elements, z. B. "Zwei gekreuzte Schlüssel", "Mönch mit Krug", "Bayerische Raute"'),
  position: z
    .string()
    .describe('Wo auf dem Etikett es sitzt, z. B. "Oben im Wappenschild", "Unterer Rand, mittig"'),
  beschreibung: z.string().describe('Was konkret zu sehen ist — rein beschreibend, ein bis zwei Sätze'),
  bedeutung: z
    .string()
    .describe(
      'Wofür das Element steht und warum es auf diesem Etikett ist: Heraldik, Stadtwappen, ' +
        'Ordenszeichen, Zunftsymbol, Auszeichnung, Markenzeichen. Zwei bis vier Sätze.',
    ),
  bereich: BereichSchema.describe(
    'Der Bildbereich, in dem dieses Element zu sehen ist — so eng wie möglich um das ' +
      'Element gelegt, aber vollständig. Bezogen auf das gesamte übergebene Bild, ' +
      'nicht nur auf das Etikett.',
  ),
  /**
   * Die fertig eingezeichnete Aufnahme zu diesem Element.
   *
   * Kommt aus der Datenbank, nicht vom Modell — deshalb optional: Ein
   * frisch zerlegtes Etikett hat noch keine, und ein Server, der keine
   * Fotos aufbewahrt, hat nie eine.
   */
  bild: z.string().optional().default(''),
});

export type Etikettelement = z.infer<typeof ElementSchema>;


/* ==========================================================================
   Die erweiterte Sicht — je ein Reiter
   ========================================================================== */

export const ZutatSchema = z.object({
  was: z.string().describe('Die Zutat, z. B. "Münchner Malz", "Hallertauer Mittelfrüh", "untergärige Hefe"'),
  rolle: z.string().describe('Was sie in genau diesem Bier bewirkt — ein bis zwei Sätze'),
});

export const BrauartSchema = z.object({
  verfahren: z
    .string()
    .describe(
      'Wie dieses Bier gebraut wird, in zwei bis drei Absätzen (getrennt durch \n\n): ' +
        'Maischverfahren, Gärung, Reifung, Besonderheiten des Betriebs. Konkret auf ' +
        'diesen Bierstil bezogen, nicht allgemein über Bier.',
    ),
  zutaten: z.array(ZutatSchema).describe('Drei bis fünf Zutaten mit ihrer Rolle: Malz, Hopfen, Hefe, Wasser'),
  gaerung: z.string().describe('Ober- oder untergärig, Gärtemperatur und Reifedauer, soweit typisch für den Stil'),
  besonderheit: z.string().describe('Was das Brauverfahren bei genau diesem Bier ausmacht — ein bis zwei Sätze'),
});

export const SpeisePaarSchema = z.object({
  gericht: z.string().describe('Ein konkretes Gericht, nicht eine Kategorie'),
  warum: z.string().describe('Warum es passt: welcher Geschmackszug trifft auf welchen — zwei bis drei Sätze'),
});

export const SpeisenSchema = z.object({
  grundsatz: z
    .string()
    .describe('Das Prinzip hinter den Empfehlungen: ergänzt das Bier, schneidet es durch, oder spiegelt es? Ein Absatz.'),
  paare: z.array(SpeisePaarSchema).describe('Drei bis fünf Gerichte mit Begründung'),
  meiden: z.string().describe('Was nicht dazu passt und warum — ein bis zwei Sätze'),
});

export const VerkostungsschrittSchema = z.object({
  schritt: z.string().describe('Kurzer Name, z. B. "Auge", "Nase", "Antrunk", "Abgang"'),
  was: z.string().describe('Worauf zu achten ist und was man erwarten sollte — zwei bis drei Sätze'),
});

export const VerkostungSchema = z.object({
  temperatur: z.string().describe('Die beste Trinktemperatur als Spanne, z. B. "7 bis 9 °C"'),
  temperatur_warum: z
    .string()
    .describe(
      'Warum genau diese Spanne: was passiert bei zu kalt, was bei zu warm. Zwei bis drei Sätze.',
    ),
  glas: z.string().describe('Das passende Glas, z. B. "Pilstulpe", "Weizenglas", "Tulpe"'),
  glas_warum: z.string().describe('Was die Glasform bewirkt — ein bis zwei Sätze'),
  einschenken: z.string().describe('Wie eingeschenkt wird, inklusive Schaumkrone — ein bis zwei Sätze'),
  schritte: z.array(VerkostungsschrittSchema).describe('Drei bis fünf Schritte der Verkostung, in der richtigen Reihenfolge'),
});

export const VerwandtesBierSchema = z.object({
  name: z.string().describe('Name des Bieres'),
  brauerei: z.string().describe('Brauerei'),
  land: z.string().describe('Land'),
  warum: z.string().describe('Worin es ähnlich ist — Brauart, Malz, Hopfen, Geschmacksbild. Zwei bis drei Sätze.'),
  unterschied: z.string().describe('Worin es sich unterscheidet — ein bis zwei Sätze'),
});

export type Brauart = z.infer<typeof BrauartSchema>;
export type Speisen = z.infer<typeof SpeisenSchema>;
export type Verkostung = z.infer<typeof VerkostungSchema>;
export type VerwandtesBier = z.infer<typeof VerwandtesBierSchema>;

export const EtikettSchema = z.object({
  erkannt: z.boolean().describe('true, wenn ein Bieretikett, eine Flasche oder eine Dose zu sehen ist'),

  sicherheit: z
    .enum(['hoch', 'mittel', 'niedrig'])
    .describe('Wie sicher ist die Zuordnung zu einer konkreten Brauerei und Sorte?'),

  /* --- Was im Glas ist ------------------------------------------------ */
  name: z.string().describe('Name des Bieres. "unbekannt" wenn unklar'),
  brauerei: z.string().describe('Brauerei oder Kloster. "unbekannt" wenn unklar'),
  ort: z.string().describe('Ort bzw. Region der Brauerei. "unbekannt" wenn unklar'),
  land: z.string().describe('Land der Brauerei. "unbekannt" wenn unklar'),
  gegruendet: z.string().describe('Gründungsjahr als Text, z. B. "1328". "unbekannt" wenn unklar'),
  stil: z.string().describe('Bierstil, z. B. "Helles Lagerbier". "unbekannt" wenn unklar'),
  stammwuerze: z.string().describe('Stammwürze, z. B. "11,8 °P". "unbekannt" wenn unklar'),
  alkohol: z.string().describe('Alkoholgehalt, z. B. "5,2 % vol". "unbekannt" wenn unklar'),

  /* --- Das Etikett, Stück für Stück ----------------------------------- */
  elemente: z
    .array(ElementSchema)
    .describe(
      'Jedes erkennbare Bildelement des Etiketts einzeln aufgeschlüsselt: Wappen, Tiere, ' +
        'Figuren, Kronen, Sterne, Bänder, Medaillen, Jahreszahlen, Ortsangaben, Siegel. ' +
        'Vier bis acht Einträge, die auffälligsten zuerst.',
    ),

  farbwahl: z
    .string()
    .describe('Welche Farben das Etikett trägt und wofür sie stehen — Tradition, Bierstil, Wiedererkennung. Zwei bis drei Sätze.'),

  schriftbild: z
    .string()
    .describe('Die Typografie des Etiketts: Schriftart, Anmutung, was sie signalisiert. Zwei bis drei Sätze.'),

  /* --- Hintergrund ----------------------------------------------------- */
  hintergrund: z
    .string()
    .describe(
      'Geschichtlicher Hintergrund zu Brauerei und Etikett in zwei bis drei Absätzen, ' +
        'getrennt durch \\n\\n. Wann entstand die Brauerei, woher stammen die Zeichen ' +
        'im Etikett, was hat sich daran verändert.',
    ),

  /* --- Der Zweck der Übung --------------------------------------------- */
  gespraechsstoff: z
    .array(z.string())
    .describe(
      'Drei bis fünf Sätze, die man in einer Bierrunde erzählen kann: überraschend, ' +
        'konkret, in einem Atemzug sagbar. Kein Marketing, keine Allgemeinplätze.',
    ),

  hinweis: z
    .string()
    .describe(
      'Offen benannte Unsicherheit: was war auf dem Bild nicht lesbar, was ist gedeutet ' +
        'statt gewusst? Leerer String, wenn alles eindeutig war.',
    ),
});

export type Etikett = z.infer<typeof EtikettSchema>;

/** Vom Browser unterstützte und von der API akzeptierte Bildformate. */
export const ERLAUBTE_TYPEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type ErlaubterTyp = (typeof ERLAUBTE_TYPEN)[number];

export function istErlaubterTyp(typ: string): typ is ErlaubterTyp {
  return (ERLAUBTE_TYPEN as readonly string[]).includes(typ);
}

/**
 * Die erweiterte Sicht wird in einem zweiten Aufruf geholt.
 *
 * Nicht aus Bequemlichkeit: Strukturierte Ausgaben werden serverseitig zu einer
 * Grammatik kompiliert, und ein Schema mit Etikettzerlegung UND allen vier
 * Reitern überschreitet deren Größengrenze — die API antwortet dann mit
 * "The compiled grammar is too large". Zwei Aufrufe mit je einem halb so
 * großen Schema bleiben darunter, und die Aufteilung hat einen Nebengewinn:
 * scheitert der zweite Aufruf, bleibt die Etikettzerlegung trotzdem stehen.
 */
export const ErweitertSchema = z.object({
  brauart: BrauartSchema.describe('Wie dieses Bier gebraut wird'),
  speisen: SpeisenSchema.describe('Welches Essen dazu passt und warum'),
  verkostung: VerkostungSchema.describe('Wie es am besten verkostet wird, mit Trinktemperatur'),
  verwandte: z
    .array(VerwandtesBierSchema)
    .describe('Drei bis fünf ähnlich gebraute und ähnlich schmeckende Biere'),
});

export type Erweitert = z.infer<typeof ErweitertSchema>;
