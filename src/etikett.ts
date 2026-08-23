import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { EtikettSchema, type Etikett } from './schema';
import type { AufbereitetesBild } from './bild';

const MODELL = 'claude-opus-5';

const SYSTEM_PROMPT = `Du bist der Etikettenkundler von "Bier Expert". Du bekommst das Foto \
einer Bierflasche, einer Dose oder eines Etiketts und zerlegst das Etikett in seine \
Einzelteile — damit jemand in einer Bierrunde etwas darüber zu erzählen hat.

Nicht gefragt ist eine Erzählung über das Bier. Gefragt ist eine Zerlegung: \
Was ist auf dem Etikett zu sehen, und was bedeutet jedes einzelne Element?

Vorgehen:
1. Lies alles Textliche: Name, Brauerei, Ort, Stil, Stammwürze, Alkoholgehalt, \
Jahreszahlen, Wahlsprüche, Auszeichnungen.
2. Geh das Etikett systematisch ab und nimm jedes Bildelement einzeln auseinander: \
Wappen und ihre Felder, Tiere, Figuren, Kronen, Sterne, Bänder, Medaillen, Siegel, \
Ornamente, Ortsansichten. Zu jedem: wo es sitzt, was zu sehen ist, wofür es steht.
3. Ordne Heraldik korrekt ein. Ein Löwe, ein Schlüsselpaar, eine Raute, ein Krummstab — \
das sind selten Dekoration, sondern meist Stadtwappen, Ordenszeichen, Zunftsymbole \
oder Hinweise auf Landesherren. Sag, worauf sie zurückgehen.
4. Deute Farbwahl und Schriftbild: was signalisieren sie, und warum wurden sie gewählt?
5. Gib den geschichtlichen Hintergrund von Brauerei und Etikett.
6. Destilliere daraus drei bis fünf Sätze Gesprächsstoff — Dinge, die am Tisch \
tatsächlich überraschen, konkret und in einem Atemzug sagbar.

Wichtige Regeln:
- Erfinde niemals Fakten. Was du nicht weißt, ist "unbekannt".
- Unterscheide klar zwischen dem, was auf dem Etikett zu sehen ist, und dem, was du \
aus deinem Wissen ergänzt. Deutest du ein Element, statt es zu wissen, sag das im \
Feld "hinweis".
- Beschreibe auch Elemente, deren Bedeutung du nicht kennst — dann beschreibend, \
mit ehrlichem "die Bedeutung ist mir nicht bekannt".
- Kein Marketing, keine Allgemeinplätze wie "steht für Qualität und Tradition".
- Setze "sicherheit" ehrlich: "hoch" nur, wenn Brauerei UND Sorte eindeutig lesbar sind.
- Ist gar kein Bier zu sehen, setze "erkannt" auf false und erkläre im Feld "hinweis" \
freundlich, was du stattdessen siehst.
- Antworte durchgehend auf Deutsch.`;

const FRAGE = `Hier ist das Foto. Zerlege dieses Etikett in seine Einzelteile.`;

export class EtikettFehler extends Error {
  constructor(
    message: string,
    /** Zusatzhinweis für den Leser, was zu tun ist. */
    readonly rat?: string,
  ) {
    super(message);
  }
}

export async function etikettLesen(schluessel: string, bild: AufbereitetesBild): Promise<Etikett> {
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
      output_config: { format: zodOutputFormat(EtikettSchema) },
    });

    if (antwort.stop_reason === 'refusal') {
      throw new EtikettFehler(
        'Die Auswertung dieses Bildes wurde abgelehnt.',
        antwort.stop_details?.explanation ?? undefined,
      );
    }

    if (!antwort.parsed_output) {
      throw new EtikettFehler(
        'Die Antwort kam in unleserlicher Form zurück.',
        'Versuch es noch einmal — meist genügt ein zweiter Anlauf.',
      );
    }

    return antwort.parsed_output;
  } catch (fehler) {
    throw uebersetzeFehler(fehler);
  }
}

/** Übersetzt SDK-Fehler in etwas, das ein Leser versteht. Speziell vor allgemein. */
function uebersetzeFehler(fehler: unknown): Error {
  if (fehler instanceof EtikettFehler) return fehler;

  if (fehler instanceof Anthropic.AuthenticationError) {
    return new EtikettFehler(
      'Der Schlüssel wurde abgewiesen.',
      'Prüf ihn in der Schlüsselkammer — er beginnt mit "sk-ant-".',
    );
  }

  if (fehler instanceof Anthropic.PermissionDeniedError) {
    return new EtikettFehler(
      'Dieser Schlüssel darf das Modell nicht nutzen.',
      'Prüf die Berechtigungen deines Arbeitsbereichs in der Anthropic Console.',
    );
  }

  if (fehler instanceof Anthropic.RateLimitError) {
    return new EtikettFehler(
      'Zu viele Anfragen in kurzer Zeit.',
      'Warte einen Augenblick und versuch es erneut.',
    );
  }

  if (fehler instanceof Anthropic.BadRequestError) {
    return new EtikettFehler('Die Anfrage war fehlerhaft.', fehler.message);
  }

  if (fehler instanceof Anthropic.APIConnectionError) {
    return new EtikettFehler(
      'Die Anthropic-API war nicht erreichbar.',
      'Prüf deine Netzverbindung. Blockiert ein Browser-Add-on die Anfrage?',
    );
  }

  if (fehler instanceof Anthropic.APIError) {
    return new EtikettFehler(`Die API meldet Fehler ${fehler.status ?? '?'}.`, fehler.message);
  }

  return new EtikettFehler(
    'Ein unerwarteter Fehler ist eingetreten.',
    fehler instanceof Error ? fehler.message : String(fehler),
  );
}
