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

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
};

/** Baut eine Antwort der Messages API als Ereignisstrom nach. */
function alsStrom(nutzlast: unknown): string {
  const text = JSON.stringify(nutzlast);
  const ev = (art: string, daten: unknown) => `event: ${art}\ndata: ${JSON.stringify(daten)}\n\n`;
  return (
    ev('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1500, output_tokens: 0 },
      },
    }) +
    ev('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }) +
    ev('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    }) +
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    ev('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2000 },
    }) +
    ev('message_stop', { type: 'message_stop' })
  );
}

export interface Beobachtung {
  art: 'etikett' | 'erweitert';
  maxTokens: number;
  gestreamt: boolean;
  /** Eigenschaften im JSON-Schema, rekursiv — ein Maß für die Grammatikgröße. */
  schemafelder: number;
}

function schemafelder(schema: unknown): number {
  if (!schema || typeof schema !== 'object') return 0;
  const s = schema as Record<string, any>;
  let n = 0;
  if (s['properties']) {
    n += Object.keys(s['properties']).length;
    for (const wert of Object.values(s['properties'])) n += schemafelder(wert);
  }
  if (s['items']) n += schemafelder(s['items']);
  return n;
}

export interface MockOptionen {
  /** Lässt den zweiten Aufruf mit diesem Status scheitern. */
  erweitertFehler?: number;
  /** Verzögert den zweiten Aufruf, um den Ladezustand prüfen zu können. */
  erweitertVerzoegern?: number;
}

/**
 * Fängt die Anthropic-Aufrufe ab und beantwortet sie aus den Testdaten.
 * Gibt die Liste der gesehenen Anfragen zurück, die sich nach dem Testlauf
 * auswerten lässt.
 *
 * Auch die Schriften werden abgefangen: die Tests sollen nicht davon abhängen,
 * dass Google Fonts erreichbar ist.
 */
export async function apiVortaeuschen(page: Page, opt: MockOptionen = {}): Promise<Beobachtung[]> {
  const gesehen: Beobachtung[] = [];

  await page.route('https://fonts.googleapis.com/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );

  await page.route('**/v1/messages*', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }

    const koerper = route.request().postDataJSON();
    const istErweitert = String(koerper.system).includes('Bierkundler');

    gesehen.push({
      art: istErweitert ? 'erweitert' : 'etikett',
      maxTokens: koerper.max_tokens,
      gestreamt: koerper.stream === true,
      schemafelder: schemafelder(koerper.output_config?.format?.schema ?? koerper.output_config?.format),
    });

    if (istErweitert) {
      if (opt.erweitertVerzoegern) {
        await new Promise((weiter) => setTimeout(weiter, opt.erweitertVerzoegern));
      }
      if (opt.erweitertFehler) {
        return route.fulfill({
          status: opt.erweitertFehler,
          headers: { ...CORS, 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'Testfehler im zweiten Aufruf' },
          }),
        });
      }
    }

    await route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'text/event-stream' },
      body: alsStrom(istErweitert ? ERWEITERT : ETIKETT),
    });
  });

  return gesehen;
}

/** Legt einen Schlüssel ab, damit die Auswertung nicht an der Kammer hängen bleibt. */
export async function schluesselHinterlegen(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('bierexpert.apiSchluessel', 'sk-ant-test'));
  await page.reload();
}

/** Bild hochladen und auswerten lassen, bis der Befund steht. */
export async function bisBefund(page: Page): Promise<void> {
  await page.setInputFiles('#datei', BILD);
  await page.waitForSelector('#vorschau:not([hidden])');
  await page.click('#lesen');
  await page.waitForSelector('.chronik-blatt');
}
