import { expect, test } from '@playwright/test';
import { apiVortaeuschen, bisBefund, seiteOeffnen } from './helfer';

/** Trägt in der Kammer einen Schlüssel ein und speichert ihn. */
async function schluesselHinterlegen(page: import('@playwright/test').Page, wert: string): Promise<void> {
  await page.click('#kammer summary');
  await page.fill('#schluessel', wert);
  await page.click('#schluessel-speichern');
  await expect(page.locator('#schluessel-stand')).toHaveText('Schlüssel hinterlegt.');
}

test.describe('Schlüsselkammer', () => {
  test('schickt den hinterlegten Schlüssel als Kopfzeile mit', async ({ page }) => {
    const gesehen = await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await schluesselHinterlegen(page, 'sk-ant-testwert');
    await bisBefund(page);

    // Beide Aufrufe tragen ihn — auch die erweiterte Sicht kostet Guthaben.
    expect(gesehen.length).toBeGreaterThan(0);
    for (const aufruf of gesehen) {
      expect(aufruf.schluessel, `${aufruf.art}: trägt den Schlüssel`).toBe('sk-ant-testwert');
    }

    // Das Feld ist nach dem Speichern leer: Der Wert soll nicht auf dem
    // Bildschirm stehen bleiben, während jemand zusieht.
    await expect(page.locator('#schluessel')).toHaveValue('');
  });

  test('geht ohne Schlüssel auch ohne Kopfzeile', async ({ page }) => {
    const gesehen = await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await bisBefund(page);

    for (const aufruf of gesehen) {
      expect(aufruf.schluessel, `${aufruf.art}: keine Kopfzeile`).toBeNull();
    }
  });

  test('überlebt ein Neuladen der Seite', async ({ page }) => {
    await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await schluesselHinterlegen(page, 'sk-ant-bleibt');
    await page.reload();

    // Der Schlüssel selbst erscheint nirgends — nur, OB einer da ist.
    await page.click('#kammer summary');
    await expect(page.locator('#schluessel-stand')).toHaveText('Schlüssel hinterlegt.');
    await expect(page.locator('#schluessel')).toHaveValue('');
  });

  test('lässt sich durch Speichern eines leeren Feldes entfernen', async ({ page }) => {
    await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await schluesselHinterlegen(page, 'sk-ant-wegdamit');
    await page.click('#schluessel-speichern');
    await expect(page.locator('#schluessel-stand')).toHaveText('Kein Schlüssel hinterlegt.');
  });
});
