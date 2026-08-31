import {
  ErweitertSchema,
  EtikettSchema,
  VermutungSchema,
  type Erweitert,
  type Etikett,
  type Vermutung,
} from './schema';
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
  /**
   * Fotos, die andere von diesem Bier gemacht haben.
   *
   * Leer, wenn der Server keine aufbewahrt — das ist die Vorgabe, denn es
   * sind fremde Fotos.
   */
  bilder: string[];
}

/**
 * Eine Zeile aus dem Fortschritts-Strom.
 *
 * Der Server schickt sie, während er arbeitet, statt am Ende alles auf
 * einmal. Das ist nicht nur angenehmer: Ein Aufruf, der eine Minute lang
 * kein Byte sendet, wird von Cloudflare abgebrochen (Fehler 524), und ein
 * kaltes Modell braucht auf dieser Hardware länger als eine Minute.
 */
export interface Stromereignis {
  stufe:
    | 'laden'
    | 'erkennung'
    | 'erkannt'
    | 'gefunden'
    | 'verorten'
    | 'auswertung'
    | 'puls'
    | 'vermutung'
    | 'fertig'
    | 'fehler';
  /** Bei 'erkannt' und 'gefunden': was bereits feststeht. */
  brauerei?: string;
  name?: string;
  stil?: string;
  ist_bier?: boolean;
  /** Bei 'verorten': wie viele Elemente gesucht werden. */
  elemente?: number;
  /** Bei 'puls': welche Etappe gerade läuft. */
  laeuft?: string;
}

/**
 * Liest ein Etikett — und meldet unterwegs, wie weit es ist.
 *
 * Ohne Rückruf bleibt alles beim Alten: eine Anfrage, eine Antwort. Mit
 * Rückruf verlangt der Aufruf den Strom und meldet jede Etappe. Der Server
 * entscheidet nicht von sich aus, sondern richtet sich nach dem Accept-Kopf
 * — dieselbe Anwendung läuft schliesslich auch dort, wo ein Strom nichts
 * nützt.
 */
export type Lesung =
  | { art: 'befund'; auswertung: Auswertung<Etikett> }
  | { art: 'vermutung'; vermutung: Vermutung };

export async function etikettLesen(
  bild: AufbereitetesBild,
  aufEreignis?: (ereignis: Stromereignis) => void,
  bestaetigtId = 0,
): Promise<Lesung> {
  const antwort = aufEreignis
    ? await fragenAlsStrom('etikett.php', bild, aufEreignis, bestaetigtId)
    : await fragen('etikett.php', bild, bestaetigtId);

  // Der Server ist sich nicht sicher und fragt zurück. Das ist kein
  // Fehlschlag, sondern ein eigener Ausgang — und er steht deshalb im Typ,
  // statt vom Aufrufer aus einem fehlenden Feld erschlossen zu werden.
  if (antwort['vermutung'] !== undefined && antwort['vermutung'] !== null) {
    const geprueft = VermutungSchema.safeParse(antwort['vermutung']);

    if (geprueft.success && geprueft.data !== undefined) {
      return { art: 'vermutung', vermutung: geprueft.data };
    }
  }

  return {
    art: 'befund',
    auswertung: auspacken(antwort, 'etikett', EtikettSchema, 'Die Etikettzerlegung'),
  };
}

/**
 * Holt die erweiterte Sicht — Brauart, Speisen, Verkostung, verwandte Biere.
 *
 * Ein eigener Aufruf, damit er neben der Zerlegung laufen kann: Der Leser
 * wartet dann einmal statt zweimal. Scheitert er, bleibt die Zerlegung
 * stehen und nur die Reiter bleiben leer.
 */
export async function erweitertLesen(bild: AufbereitetesBild): Promise<Auswertung<Erweitert>> {
  // Über den Strom, obwohl hier niemand Zwischenstände anzeigt.
  //
  // Der Strom hat zwei Aufgaben, und die zweite ist hier die einzige, aber
  // die wichtigere: Er hält die Leitung am Sprechen. Ohne ihn schwieg
  // dieser Aufruf 60 bis 90 Sekunden am Stück, während der Server bei der
  // bezahlten API war — und im Mobilnetz reisst eine so lange Stille ab.
  // Der Leser sah dann "Der Server war nicht erreichbar", während der
  // Server längst fertig war und sein Ergebnis abgelegt hatte. Es war alles
  // da; nur die Leitung war weg.
  //
  // Deshalb ein leerer Rückruf: Angezeigt wird nichts davon, gebraucht wird
  // allein, dass Bytes fliessen.
  const antwort = await fragenAlsStrom('erweitert.php', bild, () => undefined);
  return auspacken(antwort, 'erweitert', ErweitertSchema, 'Die erweiterte Sicht');
}

/**
 * Der Anfragerumpf.
 *
 * bestaetigt_id geht nur mit, wenn der Leser eine Rückfrage bejaht hat. Ohne
 * Antwort keine Kennung: Eine mitgeschickte Null wäre eine Aussage über ein
 * Bier, die niemand getroffen hat.
 */
function rumpfBauen(bild: AufbereitetesBild, bestaetigtId: number): Record<string, unknown> {
  const rumpf: Record<string, unknown> = { bild: bild.base64, typ: bild.medienTyp };

  // Positiv: "ja, dieses Bier". Negativ: "nein, keines" — beides ist eine
  // Antwort und muss mit. Nur die Null bedeutet "nicht gefragt worden".
  if (bestaetigtId !== 0) {
    rumpf['bestaetigt_id'] = bestaetigtId;
  }

  return rumpf;
}

/** Schickt das Bild und gibt die geparste Antwort zurück. */
async function fragen(
  pfad: string,
  bild: AufbereitetesBild,
  bestaetigtId = 0,
): Promise<Record<string, unknown>> {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);

  let antwort: Response;
  try {
    const kopf: Record<string, string> = { 'Content-Type': 'application/json' };
    antwort = await fetch(`${API_BASIS}/${pfad}`, {
      method: 'POST',
      headers: kopf,
      body: JSON.stringify(rumpfBauen(bild, bestaetigtId)),
      signal: abbruch.signal,
    });
  } catch (fehler) {
    throw netzfehler(fehler);
  } finally {
    clearTimeout(uhr);
  }

  // Erst den Text holen, dann parsen: Kommt statt JSON eine Fehlerseite des
  // Webservers zurück, steht in ihr die eigentliche Auskunft — sie einfach
  // als "unlesbares JSON" abzutun verschenkt sie.
  return auswerten(antwort, await antwort.text());
}

/** Übersetzt einen fehlgeschlagenen fetch in eine Meldung für den Leser. */
function netzfehler(fehler: unknown): EtikettFehler {
  if (fehler instanceof DOMException && fehler.name === 'AbortError') {
    return new EtikettFehler(
      'Die Auswertung hat zu lange gedauert.',
      'Ein grosses Modell braucht beim ersten Aufruf am längsten, weil es erst in ' +
        'den Speicher geladen wird. Der zweite Versuch ist meist deutlich schneller.',
    );
  }

  return new EtikettFehler(
    'Der Server war nicht erreichbar.',
    'Prüf deine Netzverbindung. Blockiert ein Browser-Add-on die Anfrage?',
  );
}

/** Macht aus der Antwort des alten Weges den geprüften Umschlag. */
function auswerten(antwort: Response, roh: string): Record<string, unknown> {
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

/**
 * Wie fragen(), nur zeilenweise.
 *
 * Der Server schickt NDJSON: ein JSON-Objekt je Zeile, jedes sofort
 * abgeschickt. Gelesen wird mit einem Reader statt mit .text(), denn .text()
 * wartet auf das Ende — und genau darauf soll ja niemand mehr warten.
 *
 * Zurück kommt der Umschlag der letzten Zeile; er hat dieselbe Gestalt wie
 * die Antwort des alten Weges, damit auspacken() nichts davon merkt.
 */
async function fragenAlsStrom(
  pfad: string,
  bild: AufbereitetesBild,
  aufEreignis: (ereignis: Stromereignis) => void,
  bestaetigtId = 0,
): Promise<Record<string, unknown>> {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);

  try {
    const kopf: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    };

    let antwort: Response;
    try {
      antwort = await fetch(`${API_BASIS}/${pfad}`, {
        method: 'POST',
        headers: kopf,
        body: JSON.stringify(rumpfBauen(bild, bestaetigtId)),
        signal: abbruch.signal,
      });
    } catch (fehler) {
      throw netzfehler(fehler);
    }

    // Ein Server, der den Strom nicht kennt, antwortet wie eh und je. Das
    // ist kein Fehlerfall, sondern der Regelfall auf Hostpoint — dann eben
    // ohne Zwischenstände.
    const art = antwort.headers.get('Content-Type') ?? '';
    if (!art.includes('application/x-ndjson')) {
      return auswerten(antwort, await antwort.text());
    }

    if (!antwort.body) {
      throw new EtikettFehler('Der Server hat einen leeren Strom geschickt.');
    }

    const leser = antwort.body.getReader();
    const entpacker = new TextDecoder();
    let rest = '';
    let letzte: Record<string, unknown> | null = null;

    // Der Leser braucht denselben Schutz wie der fetch davor. Reisst die
    // Verbindung NACH dem ersten Byte — ein Funkloch, ein Wechsel ins
    // Mobilnetz, eine Zwischenstelle, die eine lange Antwort kappt —, dann
    // wirft read() den nackten Fehler des Browsers. Der hiess in WebKit
    // "Load failed" und stand ungefiltert vor dem Leser: englisch, ohne
    // Rat, und ohne Hinweis darauf, dass ein zweiter Versuch genügt.
    try {
      for (;;) {
        const { done, value } = await leser.read();
        if (done) break;

        rest += entpacker.decode(value, { stream: true });

        // Nur bis zum letzten Zeilenumbruch: Was danach kommt, ist eine
        // angefangene Zeile. Sie jetzt zu parsen hiesse, ein halbes JSON zu
        // lesen — der Rest wartet auf das nächste Stück.
        const zeilen = rest.split('\n');
        rest = zeilen.pop() ?? '';

        for (const zeile of zeilen) {
          if (zeile.trim() === '') continue;

          let ereignis: unknown;
          try {
            ereignis = JSON.parse(zeile);
          } catch {
            // Eine unlesbare Zwischenzeile ist kein Grund, den ganzen Scan
            // wegzuwerfen — es zählt die letzte.
            continue;
          }

          if (!ereignis || typeof ereignis !== 'object') continue;
          letzte = ereignis as Record<string, unknown>;
          aufEreignis(letzte as unknown as Stromereignis);
        }
      }
    } catch (fehler) {
      // Eine Zeile, die schon durch war, bleibt gültig: Kam die Auswertung
      // bereits vollständig an und bricht erst das Schliessen der
      // Verbindung, wäre es falsch, den fertigen Befund wegzuwerfen.
      if (letzte !== null && typeof letzte['fehler'] !== 'string' && letzte['stufe'] === 'fertig') {
        return letzte;
      }
      throw netzfehler(fehler);
    }

    if (letzte === null) {
      throw new EtikettFehler(
        'Der Server hat den Strom abgebrochen.',
        'Es kam keine vollständige Zeile an. Steht ein Zwischenspeicher davor, ' +
          'der die Antwort sammelt, statt sie durchzureichen?',
      );
    }

    // Ein Fehler nach dem ersten Byte kann keinen Statuscode mehr tragen —
    // er kommt als letzte Zeile. Deshalb wird hier auf das Feld gesehen und
    // nicht auf antwort.ok.
    if (typeof letzte['fehler'] === 'string') {
      throw new EtikettFehler(
        letzte['fehler'],
        typeof letzte['rat'] === 'string' ? letzte['rat'] : undefined,
      );
    }

    return letzte;
  } finally {
    clearTimeout(uhr);
  }
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
    bilder: bilderLesen(antwort['bilder']),
  };
}

/**
 * Schält die Bilderadressen aus der Antwort.
 *
 * Geprüft wird auf http(s), obwohl der Server dasselbe schon tut: Diese
 * Adressen landen unbesehen im src eines Bildes, und die Prüfung an der
 * Stelle zu wiederholen, an der sie benutzt werden, kostet nichts.
 */
function bilderLesen(roh: unknown): string[] {
  if (!Array.isArray(roh)) return [];

  return roh.filter(
    (adresse): adresse is string => typeof adresse === 'string' && /^https?:\/\//.test(adresse),
  );
}

/** Kürzt Fremdtext auf ein Mass, das in eine Fehlermeldung passt. */
function kurz(text: string, zeichen = 200): string {
  const sauber = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return sauber.length > zeichen ? `${sauber.slice(0, zeichen)} …` : sauber;
}
