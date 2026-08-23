import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ChronikSchema, type Chronik } from './schema';
import type { AufbereitetesBild } from './bild';

const MODELL = 'claude-opus-5';

const SYSTEM_PROMPT = `Du bist der Chronist von "Bier Expert" — ein Bierhistoriker in der \
Tradition der klösterlichen Braumeister. Du bekommst das Bild einer Bierflasche, \
einer Dose oder eines Etiketts und schreibst die Chronik dieses Bieres.

Vorgehen:
1. Lies alles vom Etikett, was du erkennen kannst: Name, Brauerei, Ort, Stil, \
Stammwürze, Alkoholgehalt, Jahreszahlen, Wappen, Schriftzüge.
2. Ordne das Bier historisch ein: Wann und warum entstand es? Wer braute es zuerst? \
Welche Ereignisse — Ordensgründungen, Kriege, Reinheitsgebot, Industrialisierung, \
Firmenübernahmen — haben es geprägt?
3. Schreibe die Entstehungsgeschichte erzählend und im Ton einer Chronik, aber \
sachlich korrekt.

Wichtige Regeln:
- Erfinde niemals Fakten. Was du nicht weißt, ist "unbekannt".
- Unterscheide klar zwischen dem, was auf dem Etikett steht, und dem, was du \
aus deinem Wissen ergänzt.
- Erkennst du die Brauerei, aber nicht die exakte Sorte, schreibe die Geschichte \
der Brauerei und sage das im Feld "hinweis".
- Setze "sicherheit" ehrlich: "hoch" nur, wenn Brauerei UND Sorte eindeutig \
lesbar sind.
- Ist auf dem Bild gar kein Bier zu sehen, setze "erkannt" auf false und erkläre \
im Feld "hinweis" freundlich, was du stattdessen siehst.
- Antworte durchgehend auf Deutsch.`;

const FRAGE = `Hier ist das Bildnis. Erstelle die Chronik dieses Bieres — mit \
besonderem Augenmerk auf seine Entstehungsgeschichte.`;

export class ChronikFehler extends Error {
  constructor(
    message: string,
    /** Zusatzhinweis für den Leser, was zu tun ist. */
    readonly rat?: string,
  ) {
    super(message);
  }
}

export async function chronikBefragen(
  schluessel: string,
  bild: AufbereitetesBild,
): Promise<Chronik> {
  const client = new Anthropic({
    apiKey: schluessel,
    // Ohne Server geht es nicht anders: der Aufruf kommt direkt aus dem Browser.
    // Der Schlüssel ist damit für jeden einsehbar, der diese Seite öffnet.
    dangerouslyAllowBrowser: true,
  });

  try {
    const antwort = await client.messages.parse({
      model: MODELL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: bild.medienTyp, data: bild.base64 },
            },
            { type: 'text', text: FRAGE },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ChronikSchema) },
    });

    if (antwort.stop_reason === 'refusal') {
      throw new ChronikFehler(
        'Die Chronik verweigert die Auskunft zu diesem Bild.',
        antwort.stop_details?.explanation ?? undefined,
      );
    }

    if (!antwort.parsed_output) {
      throw new ChronikFehler(
        'Die Antwort kam in unleserlicher Form zurück.',
        'Versuche es noch einmal — meist genügt ein zweiter Anlauf.',
      );
    }

    return antwort.parsed_output;
  } catch (fehler) {
    throw uebersetzeFehler(fehler);
  }
}

/** Übersetzt SDK-Fehler in etwas, das ein Leser versteht. Speziell vor allgemein. */
function uebersetzeFehler(fehler: unknown): Error {
  if (fehler instanceof ChronikFehler) return fehler;

  if (fehler instanceof Anthropic.AuthenticationError) {
    return new ChronikFehler(
      'Der Schlüssel wurde abgewiesen.',
      'Prüfe ihn in der Schlüsselkammer — er beginnt mit "sk-ant-".',
    );
  }

  if (fehler instanceof Anthropic.PermissionDeniedError) {
    return new ChronikFehler(
      'Dieser Schlüssel darf das Modell nicht nutzen.',
      'Prüfe die Berechtigungen deines Arbeitsbereichs in der Anthropic Console.',
    );
  }

  if (fehler instanceof Anthropic.RateLimitError) {
    return new ChronikFehler(
      'Zu viele Anfragen in kurzer Zeit.',
      'Warte einen Augenblick und befrage die Chronik erneut.',
    );
  }

  if (fehler instanceof Anthropic.BadRequestError) {
    return new ChronikFehler('Die Anfrage war fehlerhaft.', fehler.message);
  }

  if (fehler instanceof Anthropic.APIConnectionError) {
    return new ChronikFehler(
      'Die Anthropic-API war nicht erreichbar.',
      'Prüfe deine Netzverbindung. Blockiert ein Browser-Add-on die Anfrage?',
    );
  }

  if (fehler instanceof Anthropic.APIError) {
    return new ChronikFehler(`Die API meldet Fehler ${fehler.status ?? '?'}.`, fehler.message);
  }

  return new ChronikFehler(
    'Ein unerwarteter Fehler ist eingetreten.',
    fehler instanceof Error ? fehler.message : String(fehler),
  );
}
