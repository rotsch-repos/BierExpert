import { expect, test } from '@playwright/test';
import { apiVortaeuschen, seiteOeffnen, BILD } from './helfer';

/**
 * Der dritte Ausgang eines Scans.
 *
 * Bis zum 31.08. kannte die Anwendung nur zwei: gefunden oder nicht. Das war
 * zu grob. Die Suche stützt sich auf drei Signale — Farbsignatur,
 * abgelesener Name, Bildregistrierung —, und die münden nicht in ein Ja
 * oder Nein, sondern in eine Wahrscheinlichkeit. Für das mittlere Band gibt
 * es jetzt die Rückfrage: Der Leser sieht sein Foto und das gespeicherte
 * nebeneinander und entscheidet, wofür keine Menge an Signalen reicht.
 *
 * Geprüft wird hier, was der Browser daraus macht — nicht, wie der Server
 * zu seiner Vermutung kommt.
 */

const VERMUTUNG = {
  id: 42,
  brauerei: 'Badische Staatsbrauerei Rothaus',
  name: 'Tannenzäpfle',
  wahrscheinlichkeit: 0.71,
  leitfarben: ['#1e6b3a', '#c0392b'],
  bild: 'https://bilder.example/referenz.png',
};

async function bisRueckfrage(page: import('@playwright/test').Page): Promise<void> {
  await page.setInputFiles('#datei', BILD);
  await page.waitForSelector('#vorschau:not([hidden])');
  await page.click('#lesen');
  await page.waitForSelector('.vermutung');
}

test.describe('Rückfrage bei unsicherer Zuordnung', () => {
  test('stellt die Frage mit Name, Brauerei und Übereinstimmung', async ({ page }) => {
    await apiVortaeuschen(page, { vermutung: VERMUTUNG });
    await seiteOeffnen(page);
    await bisRueckfrage(page);

    const karte = page.locator('.vermutung');
    await expect(karte).toContainText('Tannenzäpfle');
    await expect(karte).toContainText('Badische Staatsbrauerei Rothaus');
    // Als Prozent, nicht als 0,71: Der Leser soll das Gewicht sehen können.
    await expect(karte.locator('.vermutung-mass')).toContainText('71 %');
  });

  test('zeigt das gespeicherte Referenzfoto zum Vergleich', async ({ page }) => {
    await apiVortaeuschen(page, { vermutung: VERMUTUNG });
    await seiteOeffnen(page);
    await bisRueckfrage(page);

    // Der Kern der Rückfrage: vergleichen können statt glauben müssen.
    const foto = page.locator('.vermutung-bild img');
    await expect(foto).toBeVisible();
    await expect(foto).toHaveAttribute('src', VERMUTUNG.bild);
  });

  test('holt bei „Ja" den Befund mit der Kennung des bestätigten Biers', async ({ page }) => {
    const gesehen = await apiVortaeuschen(page, { vermutung: VERMUTUNG });
    await seiteOeffnen(page);
    await bisRueckfrage(page);

    await page.click('.vermutung .taste-primaer');
    await page.waitForSelector('.chronik-blatt');

    const etikettAufrufe = gesehen.filter((b) => b.art === 'etikett');
    expect(etikettAufrufe).toHaveLength(2);
    // Der erste Aufruf fragt ohne Antwort, der zweite trägt sie.
    expect(etikettAufrufe[0]?.bestaetigtId).toBe(0);
    expect(etikettAufrufe[1]?.bestaetigtId).toBe(VERMUTUNG.id);

    await expect(page.locator('.vermutung')).toHaveCount(0);
  });

  test('schickt bei „Nein" eine ausdrückliche Ablehnung mit', async ({ page }) => {
    const gesehen = await apiVortaeuschen(page, { vermutung: VERMUTUNG });
    await seiteOeffnen(page);
    await bisRueckfrage(page);

    await page.click('.vermutung .taste-sekundaer');
    await page.waitForSelector('.chronik-blatt');

    const etikettAufrufe = gesehen.filter((b) => b.art === 'etikett');
    // -1 und nicht 0: Null hiesse "nicht gefragt worden", und dann käme
    // dieselbe Frage sofort wieder.
    expect(etikettAufrufe[1]?.bestaetigtId).toBe(-1);
  });

  test('fragt nicht, wenn der Server sicher ist', async ({ page }) => {
    const gesehen = await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await page.setInputFiles('#datei', BILD);
    await page.waitForSelector('#vorschau:not([hidden])');
    await page.click('#lesen');
    await page.waitForSelector('.chronik-blatt');

    await expect(page.locator('.vermutung')).toHaveCount(0);
    expect(gesehen.filter((b) => b.art === 'etikett')).toHaveLength(1);
  });
});
