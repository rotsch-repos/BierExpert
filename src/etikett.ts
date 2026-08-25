import { ErweitertSchema, EtikettSchema, type Erweitert, type Etikett } from './schema';
import type { AufbereitetesBild } from './bild';

/**
 * Der Weg zum Sprachmodell führt über den eigenen Server.
 *
 * Vorher stand hier das Anthropic-SDK, und der Browser rief die API direkt
 * auf — mit dem Schlüssel im Seitenquelltext, sichtbar für jeden Besucher.
 * Das ging nur, solange es die Seite eines Einzelnen war.
 *
 * Jetzt liegt zwischen Browser und Modell ein PHP-Backend auf demselben
 * Server, der die Seite ausliefert. Das bringt dreierlei: Der Zugang zum
 * Modell bleibt beim Server, dieselbe Flasche muss nicht zweimal ausgewertet
 * werden — die Datenbank merkt sich, was das Modell einmal gesagt hat —,
 * und das Modell läuft auf eigener Hardware statt gegen Rechnung.
 *
 * Diese Datei weiß davon nur: POST hin, JSON zurück.
 */

/** Zur Entwicklung gegen einen anderen Server: VITE_API_BASIS in .env.local. */
const API_BASIS: string = import.meta.env['VITE_API_BASIS'] ?? '/api';

import { schluesselLesen } from './schluessel';

/**
 * Ein Aufruf darf nicht ewig hängen.
 *
 * Der Server bricht selbst nach fünf Minuten ab. Die halbe Minute obendrauf
 * lässt ihm Zeit, seinen eigenen Abbruch noch als Meldung zu schicken —
 * eine Auskunft, was schiefging, ist mehr wert als ein Abbruch im Browser,
 * der nur "abgebrochen" weiß.
 */
const ZEITGRENZE_MS = 330_000;

export class EtikettFehler extends Error {
  constructor(
    message: string,
    /** Zusatzhinweis für den Leser, was zu tun ist. */
    readonly rat?: string,
  ) {
    super(message);
  }
}

/** Woher die Auskunft kam — und wie lange sie gebraucht hat. */
export interface Auswertung<T> {
  daten: T;
  /** 'speicher': schon einmal ausgewertet. 'modell': frisch gelesen. */
  quelle: 'speicher' | 'modell';
  dauerMs: number;
}

export async function etikettLesen(bild: AufbereitetesBild): Promise<Auswertung<Etikett>> {
  const antwort = await fragen('etikett.php', bild);
  return auspacken(antwort, 'etikett', EtikettSchema, 'Die Etikettzerlegung');
}

/**
 * Holt die erweiterte Sicht — Brauart, Speisen, Verkostung, verwandte Biere.
 *
 * Ein eigener Aufruf, damit er neben der Zerlegung laufen kann: Der Leser
 * wartet dann einmal statt zweimal. Scheitert er, bleibt die Zerlegung
 * stehen und nur die Reiter bleiben leer.
 */
export async function erweitertLesen(bild: AufbereitetesBild): Promise<Auswertung<Erweitert>> {
  const antwort = await fragen('erweitert.php', bild);
  return auspacken(antwort, 'erweitert', ErweitertSchema, 'Die erweiterte Sicht');
}

/** Schickt das Bild und gibt die geparste Antwort zurück. */
async function fragen(pfad: string, bild: AufbereitetesBild): Promise<Record<string, unknown>> {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);

  let antwort: Response;
  try {
    // Liegt in der Kammer ein persönlicher Anthropic-Schlüssel, geht er
    // als Kopfzeile mit — der Server reicht ihn nur durch.
    const kopf: Record<string, string> = { 'Content-Type': 'application/json' };
    const schluessel = schluesselLesen();
    if (schluessel !== '') {
      kopf['X-Anthropic-Schluessel'] = schluessel;
    }
    antwort = await fetch(`${API_BASIS}/${pfad}`, {
      method: 'POST',
      headers: kopf,
      body: JSON.stringify({ bild: bild.base64, typ: bild.medienTyp }),
      signal: abbruch.signal,
    });
  } catch (fehler) {
    if (fehler instanceof DOMException && fehler.name === 'AbortError') {
      throw new EtikettFehler(
        'Die Auswertung hat zu lange gedauert.',
        'Ein grosses Modell braucht beim ersten Aufruf am längsten, weil es erst in ' +
          'den Speicher geladen wird. Der zweite Versuch ist meist deutlich schneller.',
      );
    }
    throw new EtikettFehler(
      'Der Server war nicht erreichbar.',
      'Prüf deine Netzverbindung. Blockiert ein Browser-Add-on die Anfrage?',
    );
  } finally {
    clearTimeout(uhr);
  }

  // Erst den Text holen, dann parsen: Kommt statt JSON eine Fehlerseite des
  // Webservers zurück, steht in ihr die eigentliche Auskunft — sie einfach
  // als "unlesbares JSON" abzutun verschenkt sie.
  const roh = await antwort.text();

  let daten: unknown;
  try {
    daten = JSON.parse(roh);
  } catch {
    throw new EtikettFehler(
      antwort.ok
        ? 'Die Antwort des Servers war unlesbar.'
        : `Der Server meldet Fehler ${antwort.status}.`,
      kurz(roh) || 'Läuft PHP auf diesem Server? Ohne PHP wird die Datei als Text ausgeliefert.',
    );
  }

  if (!daten || typeof daten !== 'object') {
    throw new EtikettFehler('Die Antwort des Servers hatte nicht die erwartete Form.');
  }

  const inhalt = daten as Record<string, unknown>;

  if (!antwort.ok || typeof inhalt['fehler'] === 'string') {
    throw new EtikettFehler(
      typeof inhalt['fehler'] === 'string'
        ? inhalt['fehler']
        : `Der Server meldet Fehler ${antwort.status}.`,
      typeof inhalt['rat'] === 'string' ? inhalt['rat'] : undefined,
    );
  }

  return inhalt;
}

/** Prüft die Nutzlast gegen das Schema und schält sie aus dem Umschlag. */
function auspacken<T>(
  antwort: Record<string, unknown>,
  feld: string,
  schema: { safeParse(wert: unknown): { success: boolean; data?: T } },
  was: string,
): Auswertung<T> {
  const geprueft = schema.safeParse(antwort[feld]);

  // Das Schema steht an zwei Orten — hier als Zod, im Backend als
  // JSON-Schema für die Grammatik. Läuft beides auseinander, fällt es hier
  // auf und nicht erst als leere Stelle in der Darstellung.
  if (!geprueft.success || geprueft.data === undefined) {
    throw new EtikettFehler(
      `${was} kam in unerwarteter Form zurück.`,
      'Versuch es noch einmal — meist genügt ein zweiter Anlauf.',
    );
  }

  return {
    daten: geprueft.data,
    quelle: antwort['quelle'] === 'speicher' ? 'speicher' : 'modell',
    dauerMs: typeof antwort['dauer_ms'] === 'number' ? antwort['dauer_ms'] : 0,
  };
}

/** Kürzt Fremdtext auf ein Mass, das in eine Fehlermeldung passt. */
function kurz(text: string, zeichen = 200): string {
  const sauber = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return sauber.length > zeichen ? `${sauber.slice(0, zeichen)} …` : sauber;
}
