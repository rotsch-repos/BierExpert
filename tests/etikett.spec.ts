import { expect, test } from '@playwright/test';
import { apiVortaeuschen, bisBefund, ETIKETT, seiteOeffnen } from './helfer';

test.describe('Etikett auswerten', () => {
  test('teilt die Auswertung auf zwei Aufrufe auf', async ({ page }) => {
    const gesehen = await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await bisBefund(page);
    await expect(page.locator('.reiterfeld .warten')).toHaveCount(0);

    // Zwei Endpunkte, und zwar in dieser Reihenfolge. Der zweite darf erst
    // laufen, wenn der erste durch ist: Nur dann weiß der Server schon,
    // welches Bier auf dem Foto ist, und spart sich das Ablesen ein zweites
    // Mal. Nebeneinander gestartet brächte das nichts — am anderen Ende
    // läuft ohnehin nur eine Auswertung zur Zeit.
    expect(gesehen.map((g) => g.art)).toEqual(['etikett', 'erweitert']);

    for (const aufruf of gesehen) {
      expect(aufruf.methode, `${aufruf.art}: geht per POST`).toBe('POST');
      expect(aufruf.hatBild, `${aufruf.art}: hat ein Bild dabei`).toBe(true);
      expect(aufruf.medienTyp, `${aufruf.art}: nennt den Medientyp`).toMatch(/^image\//);
    }
  });

  test('weist die Auskunft als aus dem Gedächtnis aus', async ({ page }) => {
    await apiVortaeuschen(page, { ausSpeicher: true });
    await seiteOeffnen(page);
    await bisBefund(page);

    // Eine Zerlegung aus einer früheren Auswertung beschreibt dasselbe Bier,
    // aber nicht dieses Foto. Wer das nicht liest, hält den älteren Stand
    // für eine Aussage über die Flasche in seiner Hand.
    await expect(page.locator('.abzeichen-speicher')).toHaveText('Aus dem Gedächtnis');
  });

  test('nennt keine Herkunft, wenn frisch gelesen wurde', async ({ page }) => {
    await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await bisBefund(page);

    await expect(page.locator('.abzeichen-speicher')).toHaveCount(0);
    await expect(page.locator('.abzeichen').first()).toContainText('Zuordnung');
  });

  test('zeigt die aufbewahrten Fotos zu einem bekannten Bier', async ({ page }) => {
    await apiVortaeuschen(page, {
      ausSpeicher: true,
      bilder: ['https://bilder.example/eins.png', 'https://bilder.example/zwei.png'],
    });
    await seiteOeffnen(page);
    await bisBefund(page);

    const bilder = page.locator('.galerie-bild');
    await expect(bilder).toHaveCount(2);

    // Der Name des Biers und nicht "Foto": Ein Vorleseprogramm soll sagen,
    // wovon das Bild ist, nicht dass es eines ist.
    await expect(bilder.first()).toHaveAttribute('alt', /Klosterbräu/);
    await expect(page.locator('.galerie-titel')).toContainText('2 Mal fotografiert');
  });

  test('lässt die Galerie weg, wenn der Server keine Fotos aufbewahrt', async ({ page }) => {
    // Die Vorgabe: Es sind fremde Fotos, und wer sie sammelt, soll das
    // entscheiden. Ohne Fotos darf auch keine leere Überschrift entstehen.
    await apiVortaeuschen(page);
    await seiteOeffnen(page);
    await bisBefund(page);

    await expect(page.locator('.galerie')).toHaveCount(0);
  });

  test('zerlegt das Etikett in einzelne Elemente', async ({ page }) => {
    await apiVortaeuschen(page);
    await seiteOeffnen(page);
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
    await seiteOeffnen(page);
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

    await apiVortaeuschen(page, { etikett: kaputt });

    await seiteOeffnen(page);
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
    await seiteOeffnen(page);
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
    await seiteOeffnen(page);
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
    await seiteOeffnen(page);
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
    await seiteOeffnen(page);
    await bisBefund(page);

    await page.locator('.reitertaste').nth(1).click();
    await expect(page.locator('.reiterfeld:not([hidden]) .warten')).toHaveCount(1);
    await expect(page.locator('.reiterfeld:not([hidden]) .rollenliste > div')).toHaveCount(4);
  });

  test('behält die Etikettzerlegung, wenn der zweite Aufruf scheitert', async ({ page }) => {
    await apiVortaeuschen(page, { erweitertFehler: 400 });
    await seiteOeffnen(page);
    await bisBefund(page);

    await expect(page.locator('.reiterfeld .fehler')).toHaveCount(4);

    // Das ist der Kern: der erste Reiter steht trotzdem.
    await page.locator('.reitertaste').first().click();
    await expect(page.locator('.reiterfeld:not([hidden]) .element')).toHaveCount(5);
  });
});
