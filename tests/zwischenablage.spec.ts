import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BILD } from './helfer';

const BILD_B64 = readFileSync(BILD).toString('base64');

test.describe('Zwischenablage', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
    await page.goto('/');
  });

  test('nimmt ein Bild über die Schaltfläche entgegen', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Die Freigabe der Zwischenablage gibt es nur in Chromium.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.evaluate(async (d) => {
      const blob = await (await fetch('data:image/png;base64,' + d)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }, BILD_B64);

    await page.locator('#einfuegen').click();
    await expect(page.locator('#vorschau')).toBeVisible();
    await expect(page.locator('#lesen')).toBeEnabled();
  });

  test('nimmt eine eingefügte Bilddatei entgegen', async ({ page }) => {
    await page.evaluate((d) => {
      const bin = atob(d);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([arr], 'einfuegen.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, BILD_B64);

    await expect(page.locator('#vorschau')).toBeVisible();
  });

  test('holt das Bild aus mitkopiertem HTML einer Webseite', async ({ page }) => {
    // Wer ein Bild auf einer Webseite kopiert, hat oft nur das HTML im
    // Gepäck — darin steckt das Bild aber als data:-Adresse.
    await page.evaluate((d) => {
      const dt = new DataTransfer();
      dt.setData('text/html', `<img src="data:image/png;base64,${d}">`);
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, BILD_B64);

    await expect(page.locator('#vorschau')).toBeVisible();
  });

  test('meldet verständlich, wenn nur Text in der Zwischenablage liegt', async ({ page }) => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'nur Text, kein Bild');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    await expect(page.locator('.fehler')).toBeVisible();
    await expect(page.locator('.fehler strong')).toContainText('kein Bild');
  });
});
