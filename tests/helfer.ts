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

  await page.route('**/api/*.php', async (route: Route) => {
    const adresse = route.request().url();
    const istErweitert = adresse.includes('erweitert.php');
    const koerper = route.request().postDataJSON() ?? {};

    gesehen.push({
      art: istErweitert ? 'erweitert' : 'etikett',
      methode: route.request().method(),
      hatBild: typeof koerper.bild === 'string' && koerper.bild.length > 0,
      medienTyp: String(koerper.typ ?? ''),
    });

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
          : { etikett: opt.etikett ?? ETIKETT, quelle, dauer_ms: 3400 },
      ),
    });
  });

  return gesehen;
}

/** Öffnet die Seite. Ohne Schlüsselkammer ist das alles, was es braucht. */
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
