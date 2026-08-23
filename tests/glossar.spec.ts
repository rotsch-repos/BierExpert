import { expect, test } from '@playwright/test';

test.describe('Bierglossar', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
    await page.goto('/#glossar');
  });

  test('zeigt alle Sorten in drei Gärungsfamilien', async ({ page }) => {
    await expect(page.locator('.familie')).toHaveCount(3);
    const sorten = await page.locator('.sorte').count();
    expect(sorten).toBeGreaterThanOrEqual(15);
    await expect(page.locator('.glas')).toHaveCount(sorten);
  });

  test('zeichnet jedes Glas mit eigener Ausschnittmaske', async ({ page }) => {
    // Gleiche clipPath-IDs würden dazu führen, dass Gläser sich gegenseitig
    // die Maske wegnehmen und leer erscheinen.
    const ids = await page.evaluate(() => [...document.querySelectorAll('clipPath')].map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  test('verwendet verschiedene Glasformen', async ({ page }) => {
    const formen = await page.evaluate(
      () =>
        new Set(
          [...document.querySelectorAll('.glas')].map(
            (svg) => svg.querySelector('.glas-umriss')!.getAttribute('d')!,
          ),
        ).size,
    );
    expect(formen).toBeGreaterThanOrEqual(5);
  });

  test('filtert nach Familie', async ({ page }) => {
    const alle = await page.locator('.sorte').count();

    for (const familie of ['untergärig', 'obergärig', 'spontan & sauer']) {
      await page.locator('.familientaste', { hasText: familie }).click();
      await expect(page.locator('.familie')).toHaveCount(1);
      const gefiltert = await page.locator('.sorte').count();
      expect(gefiltert).toBeGreaterThan(0);
      expect(gefiltert).toBeLessThan(alle);
      await expect(page.locator('.familientaste[aria-pressed="true"]')).toHaveCount(1);
    }

    await page.locator('.familientaste').first().click();
    await expect(page.locator('.sorte')).toHaveCount(alle);
  });

  test('setzt Begriff und Wert der Kennzahlen nebeneinander, ohne zu überlappen', async ({ page }) => {
    // Drei Spalten nebeneinander liefen in schmalen Karten ineinander.
    const kollisionen = await page.evaluate(() => {
      let n = 0;
      document.querySelectorAll('.sorte-zahlen').forEach((dl) => {
        const kinder = [...dl.querySelectorAll('dt, dd')];
        for (let i = 0; i < kinder.length; i++) {
          for (let j = i + 1; j < kinder.length; j++) {
            const a = kinder[i]!.getBoundingClientRect();
            const b = kinder[j]!.getBoundingClientRect();
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) n++;
          }
        }
      });
      return n;
    });
    expect(kollisionen).toBe(0);
  });
});
