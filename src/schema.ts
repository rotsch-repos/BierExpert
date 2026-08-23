import { z } from 'zod';

/**
 * Struktur der Chronik, die Claude zurückliefern soll.
 *
 * Bewusst sind alle Felder Pflichtfelder: statt optionaler Felder, bei denen
 * unklar bleibt, ob das Modell sie vergessen oder die Information nicht
 * gefunden hat, trägt es "unbekannt" ein. Das macht das Rendern eindeutig.
 */
export const ChronikSchema = z.object({
  erkannt: z
    .boolean()
    .describe('true, wenn auf dem Bild eine Bierflasche, -dose oder ein Bieretikett zu sehen ist'),

  sicherheit: z
    .enum(['hoch', 'mittel', 'niedrig'])
    .describe('Wie sicher ist die Zuordnung des konkreten Bieres?'),

  name: z.string().describe('Name des Bieres, z. B. "Augustiner Helles". "unbekannt" wenn unklar'),
  brauerei: z.string().describe('Brauerei oder Kloster. "unbekannt" wenn unklar'),
  ort: z.string().describe('Ort bzw. Region der Brauerei. "unbekannt" wenn unklar'),
  land: z.string().describe('Land der Brauerei. "unbekannt" wenn unklar'),
  gegruendet: z.string().describe('Gründungsjahr der Brauerei als Text, z. B. "1328". "unbekannt" wenn unklar'),
  stil: z.string().describe('Bierstil, z. B. "Helles Lagerbier", "Doppelbock". "unbekannt" wenn unklar'),
  stammwuerze: z.string().describe('Stammwürze, z. B. "11,8 °P". "unbekannt" wenn unklar'),
  alkohol: z.string().describe('Alkoholgehalt, z. B. "5,2 % vol". "unbekannt" wenn unklar'),

  entstehungsgeschichte: z
    .string()
    .describe(
      'Die Entstehungsgeschichte dieses Bieres in 3 bis 5 Absätzen, getrennt durch \\n\\n. ' +
        'Erzählend, chronistisch, aber sachlich korrekt. Wann und warum entstand es, ' +
        'wer braute es zuerst, welche Ereignisse prägten es.',
    ),

  klosterbezug: z
    .string()
    .describe(
      'Bezug zu Kloster-, Zunft- oder Brauhaustradition in 1 bis 2 Absätzen. ' +
        'Gibt es keinen, hier die allgemeine Brautradition der Region einordnen.',
    ),

  besonderheiten: z
    .array(z.string())
    .describe('3 bis 5 knappe Merkwürdigkeiten oder Merkmale, je ein kurzer Satz'),

  hinweis: z
    .string()
    .describe(
      'Offen benannte Unsicherheit: was war auf dem Bild nicht lesbar, was ist ' +
        'geraten? Leerer String, wenn alles eindeutig war.',
    ),
});

export type Chronik = z.infer<typeof ChronikSchema>;

/** Vom Browser unterstützte und von der API akzeptierte Bildformate. */
export const ERLAUBTE_TYPEN = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type ErlaubterTyp = (typeof ERLAUBTE_TYPEN)[number];

export function istErlaubterTyp(typ: string): typ is ErlaubterTyp {
  return (ERLAUBTE_TYPEN as readonly string[]).includes(typ);
}
