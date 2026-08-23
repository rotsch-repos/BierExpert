import { expect, test } from '@playwright/test';
import { apiVortaeuschen, bisBefund, ERWEITERT, ETIKETT, schluesselHinterlegen } from './helfer';

test.describe('Etikett auswerten', () => {
  test('teilt die Auswertung auf zwei Aufrufe auf', async ({ page }) => {
    const gesehen = await apiVortaeuschen(page);
    await schluesselHinterlegen(page);
    await bisBefund(page);
    await expect(page.locator('.reiterfeld .warten')).toHaveCount(0);

    expect(gesehen.map((g) => g.art).sort()).toEqual(['erweitert', 'etikett']);

    for (const aufruf of gesehen) {
      expect(aufruf.gestreamt, 'Aufrufe laufen gestreamt').toBe(true);
      // Die API weist ein Schema ab, dessen Grammatik zu groß wird. Beide
      // Schemata müssen deutlich unter dem zusammengelegten bleiben.
      expect(aufruf.schemafelder, `${aufruf.art}: Schema bleibt klein`).toBeLessThan(25);
    }
  });

  test('zerlegt das Etikett in einzelne Elemente', async ({ page }) => {
    await apiVortaeuschen(page);
    await schluesselHinterlegen(page);
    await bisBefund(page);

    const elemente = page.locator('.reiterfeld:not([hidden]) .element');
    await expect(elemente).toHaveCount(5);
    await expect(elemente.first().locator('.element-name')).toHaveText('Zwei gekreuzte Schlüssel');
    // Der Großbuchstabensatz kommt aus dem CSS (text-transform); im DOM und
    // damit für Screenreader steht der Text so, wie das Modell ihn liefert.
    await expect(elemente.first().locator('.element-wo')).toHaveText('Oben im Wappenschild');
  });

  test('markiert jedes Element an der gelieferten Stelle im Foto', async ({ page }) => {
    await apiVortaeuschen(page);
    await schluesselHinterlegen(page);
    await bisBefund(page);

    const gemessen = await page.evaluate(() =>
      [...document.querySelectorAll('.element')].map((el) => {
        const marke = el.querySelector('.element-marke');
        if (!marke) return null;
        const figur = el.querySelector('.element-bild')!.getBoundingClientRect();
        const r = marke.getBoundingClientRect();
        return {
          x: (r.left - figur.left) / figur.width,
          y: (r.top - figur.top) / figur.height,
          breite: r.width / figur.width,
          hoehe: r.height / figur.height,
        };
      }),
    );

    const erwartet = (ETIKETT['elemente'] as Array<{ bereich: Record<string, number> }>).map(
      (e) => e.bereich,
    );

    expect(gemessen).toHaveLength(erwartet.length);
    gemessen.forEach((m, i) => {
      const soll = erwartet[i]!;
      expect(m, `Element ${i + 1} hat eine Markierung`).not.toBeNull();
      expect(m!.x).toBeCloseTo(soll['x']!, 2);
      expect(m!.y).toBeCloseTo(soll['y']!, 2);
      expect(m!.breite).toBeCloseTo(soll['breite']!, 2);
      expect(m!.hoehe).toBeCloseTo(soll['hoehe']!, 2);
    });
  });

  test('lässt unbrauchbare Koordinaten ohne Markierung', async ({ page }) => {
    const kaputt = structuredClone(ETIKETT) as any;
    kaputt.elemente[0].bereich = { x: 0, y: 0, breite: 1, hoehe: 1 };          // ganzes Bild
    kaputt.elemente[1].bereich = { x: 0.5, y: 0.5, breite: 0, hoehe: 0 };      // Nullfläche
    kaputt.elemente[2].bereich = { x: 1.4, y: -0.3, breite: 0.4, hoehe: 0.2 }; // außerhalb

    await page.route('https://fonts.googleapis.com/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
    await page.route('**/v1/messages*', async (route) => {
      const kopf = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: kopf });
      const istErweitert = String(route.request().postDataJSON().system).includes('Bierkundler');
      const daten = istErweitert ? ERWEITERT : kaputt;
      const text = JSON.stringify(daten);
      const ev = (a: string, d: unknown) => `event: ${a}\ndata: ${JSON.stringify(d)}\n\n`;
      await route.fulfill({
        status: 200,
        headers: { ...kopf, 'content-type': 'text/event-stream' },
        body:
          ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }) +
          ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
          ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) +
          ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
          ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) +
          ev('message_stop', { type: 'message_stop' }),
      });
    });

    await schluesselHinterlegen(page);
    await bisBefund(page);

    // Drei unbrauchbare Bereiche, zwei gültige: eine falsch sitzende Markierung
    // wäre schlechter als gar keine.
    await expect(page.locator('.element-bild.ohne-marke')).toHaveCount(3);
    await expect(page.locator('.element-marke')).toHaveCount(2);
  });
});

test.describe('Reiter', () => {
  const NAMEN = ['Etikett', 'Brauart', 'Speisen', 'Verkostung', 'Verwandte'];

  test('zeigt alle fünf Reiter und wechselt zwischen ihnen', async ({ page }) => {
    await apiVortaeuschen(page);
    await schluesselHinterlegen(page);
    await bisBefund(page);
    await expect(page.locator('.reiterfeld .warten')).toHaveCount(0);

    await expect(page.locator('.reitertaste')).toHaveText(NAMEN);
    await expect(page.locator('.reiterfeld:not([hidden])')).toHaveCount(1);

    for (const [i, name] of NAMEN.entries()) {
      await page.locator('.reitertaste').nth(i).click();
      await expect(page.locator('.reitertaste[aria-selected="true"]')).toHaveText(name);
      const feld = page.locator('.reiterfeld:not([hidden])');
      await expect(feld).toHaveCount(1);
      expect((await feld.innerText()).trim().length, `${name} hat Inhalt`).toBeGreaterThan(200);
    }
  });

  test('lässt sich mit der Tastatur bedienen', async ({ page }) => {
    await apiVortaeuschen(page);
    await schluesselHinterlegen(page);
    await bisBefund(page);

    await page.locator('.reitertaste').first().click();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.reitertaste[aria-selected="true"]')).toHaveText('Brauart');
    await page.keyboard.press('End');
    await expect(page.locator('.reitertaste[aria-selected="true"]')).toHaveText('Verwandte');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.reitertaste[aria-selected="true"]'), 'läuft um').toHaveText('Etikett');
    await page.keyboard.press('Home');
    await expect(page.locator('.reitertaste[aria-selected="true"]')).toHaveText('Etikett');

    // Nur der aktive Reiter liegt im Tabulatorlauf.
    expect(await page.evaluate(() => [...document.querySelectorAll('.reitertaste')].map((t) => (t as HTMLElement).tabIndex)))
      .toEqual([0, -1, -1, -1, -1]);
  });

  test('füllt die erweiterten Reiter mit ihren Inhalten', async ({ page }) => {
    await apiVortaeuschen(page);
    await schluesselHinterlegen(page);
    await bisBefund(page);
    await expect(page.locator('.reiterfeld .warten')).toHaveCount(0);

    const offen = page.locator('.reiterfeld:not([hidden])');

    await page.locator('.reitertaste').nth(1).click();
    await expect(offen.locator('.rollenliste > div'), 'Zutaten').toHaveCount(4);

    await page.locator('.reitertaste').nth(2).click();
    await expect(offen.locator('.rollenliste > div'), 'Speisepaare').toHaveCount(4);

    await page.locator('.reitertaste').nth(3).click();
    await expect(offen.locator('.servier-wert').first()).toHaveText('8 bis 10 °C');
    await expect(offen.locator('.schrittliste li'), 'Verkostungsschritte').toHaveCount(4);

    await page.locator('.reitertaste').nth(4).click();
    await expect(offen.locator('.verwandtes')).toHaveCount(4);
  });

  test('zeigt einen Ladehinweis, solange der zweite Aufruf läuft', async ({ page }) => {
    await apiVortaeuschen(page, { erweitertVerzoegern: 2000 });
    await schluesselHinterlegen(page);
    await bisBefund(page);

    await page.locator('.reitertaste').nth(1).click();
    await expect(page.locator('.reiterfeld:not([hidden]) .warten')).toHaveCount(1);
    await expect(page.locator('.reiterfeld:not([hidden]) .rollenliste > div')).toHaveCount(4);
  });

  test('behält die Etikettzerlegung, wenn der zweite Aufruf scheitert', async ({ page }) => {
    await apiVortaeuschen(page, { erweitertFehler: 400 });
    await schluesselHinterlegen(page);
    await bisBefund(page);

    await expect(page.locator('.reiterfeld .fehler')).toHaveCount(4);

    // Das ist der Kern: der erste Reiter steht trotzdem.
    await page.locator('.reitertaste').first().click();
    await expect(page.locator('.reiterfeld:not([hidden]) .element')).toHaveCount(5);
  });
});
