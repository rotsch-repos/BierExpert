import { expect, test, type Route } from '@playwright/test';
import { BILD, ERWEITERT, ETIKETT, seiteOeffnen } from './helfer';

/**
 * Der Fortschritts-Strom.
 *
 * Geprüft wird hier, was der Browser aus den Zeilen macht — nicht, dass der
 * Server sie zeitlich gestaffelt schickt. Das lässt sich mit abgefangenen
 * Anfragen nicht nachstellen: Playwright liefert eine Antwort immer am
 * Stück aus. Die Staffelung ist gegen das echte PHP-Backend gemessen
 * (siehe README) und hängt ohnehin am Server, nicht am Browser.
 *
 * Was hier zählt, ist der Vertrag: Der Browser verlangt den Strom, versteht
 * ihn — und kommt vor allem mit einem Fehler zurecht, der NACH dem ersten
 * Byte auftritt. Der kann keinen Statuscode mehr tragen, weil der längst
 * auf 200 steht. Ohne diesen Zweig wäre ein gescheiterter Scan im Strom ein
 * stummer Abbruch.
 */

/** Baut eine NDJSON-Antwort aus einzelnen Ereignissen. */
function ndjson(zeilen: readonly Record<string, unknown>[]): string {
  return zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n';
}

const VERLAUF: readonly Record<string, unknown>[] = [
  { stufe: 'laden' },
  { stufe: 'erkennung' },
  {
    stufe: 'erkannt',
    ist_bier: true,
    brauerei: 'Klosterbrauerei (Testdaten)',
    name: 'Dunkler Doppelbock',
    sicherheit: 'hoch',
  },
  { stufe: 'auswertung', anbieter: 'anthropic' },
  { stufe: 'puls', laeuft: 'auswertung' },
];

/**
 * Beantwortet den Etikettaufruf als Strom, den zweiten wie gehabt.
 *
 * @returns die Accept-Köpfe, mit denen gefragt wurde
 */
async function stromVortaeuschen(
  page: import('@playwright/test').Page,
  schluss: Record<string, unknown>,
): Promise<string[]> {
  const angefragt: string[] = [];

  await page.route('https://fonts.googleapis.com/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );

  await page.route('**/api/*.php', async (route: Route) => {
    if (route.request().url().includes('erweitert.php')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ erweitert: ERWEITERT, quelle: 'modell', dauer_ms: 1200 }),
      });
    }

    angefragt.push((await route.request().headerValue('accept')) ?? '');

    // Status 200, auch im Fehlerfall: So verhält sich der Server, sobald der
    // Strom offen ist. Genau das ist der Fall, den der Browser können muss.
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson; charset=utf-8',
      body: ndjson([...VERLAUF, schluss]),
    });
  });

  return angefragt;
}

test.describe('Fortschritts-Strom', () => {
  test('verlangt den Strom und wertet ihn aus', async ({ page }) => {
    const angefragt = await stromVortaeuschen(page, {
      stufe: 'fertig',
      etikett: ETIKETT,
      quelle: 'modell',
      dauer_ms: 4200,
    });

    await seiteOeffnen(page);
    await page.setInputFiles('#datei', BILD);
    await page.waitForSelector('#vorschau:not([hidden])');
    await page.click('#lesen');
    await page.waitForSelector('.chronik-blatt');

    // Der Server entscheidet nicht von sich aus, sondern richtet sich nach
    // diesem Kopf — sonst bräche der Strom jede ältere Gegenstelle.
    expect(angefragt[0]).toContain('application/x-ndjson');

    // Die letzte Zeile trägt die Nutzlast. Kommt der Befund an, hat der
    // Leser sie aus dem Strom herausgeholt und nicht aus einer Gesamtantwort.
    await expect(page.locator('.chronik-blatt')).toContainText('Klosterbrauerei');
  });

  test('zeigt einen Fehler an, der erst nach dem ersten Byte auftritt', async ({ page }) => {
    await stromVortaeuschen(page, {
      stufe: 'fehler',
      fehler: 'Das Sprachmodell hat nichts geantwortet.',
      rat: 'Das ist Absicht — der Fehler kommt aus dem Strom, nicht aus dem Status.',
    });

    await seiteOeffnen(page);
    await page.setInputFiles('#datei', BILD);
    await page.waitForSelector('#vorschau:not([hidden])');
    await page.click('#lesen');

    // Ohne den Zweig im Leser bliebe hier die Wartezeile stehen, bis der
    // Browser nach fünfeinhalb Minuten von selbst abbricht.
    await expect(page.locator('.fehler')).toContainText('Das Sprachmodell hat nichts geantwortet.');
  });

  test('kommt weiter mit einem Server ohne Strom zurecht', async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );

    // Die alte Gestalt: eine Anfrage, eine Antwort, kein NDJSON. So
    // antwortet dieselbe Anwendung auf Hostpoint, wo ein Strom nichts nützt.
    await page.route('**/api/*.php', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          route.request().url().includes('erweitert.php')
            ? { erweitert: ERWEITERT, quelle: 'modell', dauer_ms: 1200 }
            : { etikett: ETIKETT, quelle: 'speicher', dauer_ms: 3400 },
        ),
      }),
    );

    await seiteOeffnen(page);
    await page.setInputFiles('#datei', BILD);
    await page.waitForSelector('#vorschau:not([hidden])');
    await page.click('#lesen');

    await expect(page.locator('.chronik-blatt')).toContainText('Klosterbrauerei');
  });
});
