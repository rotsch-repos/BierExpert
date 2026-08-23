import { expect, test } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
  });

  test('startet mit der Lesesicht', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sicht-lesen')).toBeVisible();
    await expect(page.locator('#sicht-glossar')).toBeHidden();
    await expect(page.locator('#banner-titel')).toHaveText('Das Etikett lesen');
    await expect(page).toHaveTitle('Bier Expert');
  });

  test('wechselt über das Hauptmenü und setzt Hash, Titel und aria-current', async ({ page }) => {
    await page.goto('/');
    await page.locator('.menuepunkt[data-sicht="glossar"]').click();

    await expect(page.locator('#sicht-glossar')).toBeVisible();
    await expect(page.locator('#sicht-lesen')).toBeHidden();
    await expect(page.locator('#banner-titel')).toHaveText('Bierglossar');
    await expect(page).toHaveTitle(/Bierglossar/);
    await expect(page.locator('.menuepunkt[aria-current="page"]')).toHaveText('Bierglossar');
    expect(new URL(page.url()).hash).toBe('#glossar');
  });

  test('folgt dem Zurück-Knopf', async ({ page }) => {
    await page.goto('/');
    await page.locator('.menuepunkt[data-sicht="glossar"]').click();
    await expect(page.locator('#sicht-glossar')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#sicht-lesen')).toBeVisible();
  });

  test('lässt sich direkt verlinken', async ({ page }) => {
    await page.goto('/#glossar');
    await expect(page.locator('#sicht-glossar')).toBeVisible();
  });

  test('fällt bei unbekanntem Hash auf die Lesesicht zurück', async ({ page }) => {
    await page.goto('/#gibtsnicht');
    await expect(page.locator('#sicht-lesen')).toBeVisible();
  });

  test('zeigt das Kopfbild und läuft nicht seitlich über', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('.banner img');
    await expect(banner).toBeVisible();
    expect(await banner.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      'kein horizontaler Überlauf',
    ).toBe(false);
  });
});
