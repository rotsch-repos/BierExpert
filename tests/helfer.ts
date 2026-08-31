import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// __dirname gibt es in ES-Modulen nicht.
const hier = dirname(fileURLToPath(import.meta.url));

export const BILD = join(hier, 'fixtures', 'testflasche.png');

export const ETIKETT = JSON.parse(
  readFileSync(join(hier, 'fixtures', 'etikett.json'), 'utf8'),
) as Record<string, unknown>;

export const ERWEITERT = JSON.parse(
  readFileSync(join(hier, 'fixtures', 'erweitert.json'), 'utf8'),
) as Record<string, unknown>;

/** Was von einer Anfrage an die eigene API festgehalten wird. */
export interface Beobachtung {
  art: 'etikett' | 'erweitert';
  methode: string;
  /** Ist ein Bild mitgegangen? Ohne eines kann das Modell nichts lesen. */
  hatBild: boolean;
  medienTyp: string;
  /** Der persönliche Anthropic-Schlüssel aus der Kopfzeile, falls einer mitging. */
  schluessel: string | null;
  /** Die Antwort des Lesers auf eine Rückfrage: >0 ja, -1 nein, 0 nicht gefragt. */
  bestaetigtId: number;
}

export interface MockOptionen {
  /** Lässt den zweiten Aufruf mit diesem Status scheitern. */
  erweitertFehler?: number;
  /** Verzögert den zweiten Aufruf, um den Ladezustand prüfen zu können. */
  erweitertVerzoegern?: number;
  /** Andere Etikettdaten als die aus der Datei — für Sonderfälle. */
  etikett?: Record<string, unknown>;
  /** Antwortet, als käme die Auskunft aus dem Zwischenspeicher. */
  ausSpeicher?: boolean;
  /** Fotos, die der Server zu diesem Bier aufbewahrt hat. */
  bilder?: string[];
  /**
   * Lässt den Server zurückfragen, statt gleich zu antworten.
   *
   * Beantwortet wird damit nur der erste Aufruf — der ohne Antwort des
   * Lesers. Kommt die Anfrage mit einer Bestätigung wieder, antwortet der
   * Server wie sonst auch. Genau das ist der Ablauf, den es zu prüfen gilt.
   */
  vermutung?: Record<string, unknown>;
}

/**
 * Fängt die Aufrufe an die eigene API ab und beantwortet sie aus den Testdaten.
 *
 * Vorher stand hier ein nachgebauter Ereignisstrom der Anthropic-API. Seit
 * das Sprachmodell hinter einem eigenen PHP-Backend liegt, ist die Antwort
 * schlichtes JSON — der halbe Helfer fiel damit weg. Was das Backend
 * seinerseits mit Ollama und der Datenbank treibt, prüfen diese Tests nicht;
 * hier geht es um das, was der Browser daraus macht.
 *
 * Auch die Schriften werden abgefangen: die Tests sollen nicht davon abhängen,
 * dass Google Fonts erreichbar ist.
 */
export async function apiVortaeuschen(page: Page, opt: MockOptionen = {}): Promise<Beobachtung[]> {
  const gesehen: Beobachtung[] = [];
  const quelle = opt.ausSpeicher ? 'speicher' : 'modell';

  await page.route('https://fonts.googleapis.com/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );

  // Die Galeriebilder wirklich ausliefern. Ohne das schlüge das Laden fehl,
  // und die Anwendung entfernt ein Bild, das nicht kommt — der Test prüfte
  // dann eine Reihe, die es zu Recht nicht mehr gibt.
  await page.route('https://bilder.example/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(BILD) }),
  );

  await page.route('**/api/*.php', async (route: Route) => {
    const adresse = route.request().url();
    const istErweitert = adresse.includes('erweitert.php');
    const koerper = route.request().postDataJSON() ?? {};

    gesehen.push({
      art: istErweitert ? 'erweitert' : 'etikett',
      methode: route.request().method(),
      hatBild: typeof koerper.bild === 'string' && koerper.bild.length > 0,
      medienTyp: String(koerper.typ ?? ''),
      schluessel: (await route.request().headerValue('x-anthropic-schluessel')) ?? null,
      bestaetigtId: Number(koerper.bestaetigt_id ?? 0),
    });

    // Die Rückfrage gilt nur, solange der Leser nicht geantwortet hat.
    if (!istErweitert && opt.vermutung && !koerper.bestaetigt_id) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          vermutung: opt.vermutung,
          quelle: 'vermutung',
          dauer_ms: 700,
        }),
      });
    }

    if (istErweitert) {
      if (opt.erweitertVerzoegern) {
        await new Promise((weiter) => setTimeout(weiter, opt.erweitertVerzoegern));
      }
      if (opt.erweitertFehler) {
        return route.fulfill({
          status: opt.erweitertFehler,
          contentType: 'application/json',
          body: JSON.stringify({
            fehler: 'Testfehler im zweiten Aufruf',
            rat: 'Das ist Absicht — der erste Aufruf soll davon unberührt bleiben.',
          }),
        });
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        istErweitert
          ? { erweitert: ERWEITERT, quelle, dauer_ms: 1200 }
          : {
              etikett: opt.etikett ?? ETIKETT,
              bilder: opt.bilder ?? [],
              quelle,
              dauer_ms: 3400,
            },
      ),
    });
  });

  return gesehen;
}

/** Öffnet die Seite. */
export async function seiteOeffnen(page: Page): Promise<void> {
  await page.goto('/');
}

/** Bild hochladen und auswerten lassen, bis der Befund steht. */
export async function bisBefund(page: Page): Promise<void> {
  await page.setInputFiles('#datei', BILD);
  await page.waitForSelector('#vorschau:not([hidden])');
  await page.click('#lesen');
  await page.waitForSelector('.chronik-blatt');
}
