/**
 * Die Schlüsselkammer: der persönliche Anthropic-Schlüssel.
 *
 * Er bleibt in DIESEM Browser (Local Storage) und reist nur als Kopfzeile
 * mit den eigenen Anfragen — auf dem Server wird er weder gespeichert noch
 * protokolliert. So kann genau eine Person auf ihre Rechnung auswerten
 * lassen, ohne dass jeder Besucher der Seite es könnte.
 *
 * Der Zugriff auf localStorage steht in try/catch: In privaten Fenstern
 * oder bei blockierten Website-Daten wirft schon das Lesen — dann verhält
 * sich die Kammer wie leer, statt die Seite zu reissen.
 */

const ABLAGE = 'bierexpert-anthropic-schluessel';

export function schluesselLesen(): string {
  try {
    return localStorage.getItem(ABLAGE) ?? '';
  } catch {
    return '';
  }
}

function schluesselSchreiben(wert: string): void {
  try {
    if (wert === '') {
      localStorage.removeItem(ABLAGE);
    } else {
      localStorage.setItem(ABLAGE, wert);
    }
  } catch {
    // Ohne Ablage bleibt der Schlüssel für diese Sitzung im Feld — die
    // Anfragen dieser Seite tragen ihn trotzdem.
  }
}

/** Verbindet Feld, Taste und Standanzeige der Kammer. */
export function kammerVerdrahten(): void {
  const feld = document.getElementById('schluessel') as HTMLInputElement | null;
  const taste = document.getElementById('schluessel-speichern');
  const stand = document.getElementById('schluessel-stand');
  if (!feld || !taste || !stand) return;

  const anzeigen = (): void => {
    const wert = schluesselLesen();
    // Der Schlüssel selbst erscheint nirgends — nur, OB einer da ist.
    stand.textContent = wert === '' ? 'Kein Schlüssel hinterlegt.' : 'Schlüssel hinterlegt.';
  };

  taste.addEventListener('click', () => {
    schluesselSchreiben(feld.value.trim());
    feld.value = '';
    anzeigen();
  });
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (taste as HTMLButtonElement).click();
    }
  });

  anzeigen();
}
