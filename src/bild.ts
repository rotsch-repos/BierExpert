import { istErlaubterTyp } from './schema';

/**
 * Anthropic skaliert Bilder ohnehin auf max. 1568 px Kantenlänge herunter.
 * Wir tun das schon im Browser: das spart Upload-Volumen und Tokens,
 * und ein 8-MB-Handyfoto wird damit zu ein paar hundert Kilobyte.
 */
const MAX_KANTE = 1568;
const JPEG_QUALITAET = 0.85;

export interface AufbereitetesBild {
  /** Base64 ohne data:-Präfix — genau das erwartet die Messages API. */
  base64: string;
  medienTyp: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** data:-URL für die Vorschau im DOM. */
  vorschauUrl: string;
  breite: number;
  hoehe: number;
}

export class BildFehler extends Error {}

/**
 * Liest eine Datei ein, skaliert sie bei Bedarf herunter und liefert
 * Base64 plus Vorschau-URL.
 *
 * GIFs werden nicht durch die Canvas geschickt — das würde die Animation
 * platt machen und nur das erste Einzelbild behalten. Sie gehen unverändert
 * durch, solange sie klein genug sind.
 */
export async function bildAufbereiten(datei: File): Promise<AufbereitetesBild> {
  if (!istErlaubterTyp(datei.type)) {
    throw new BildFehler(
      `Dieses Format kann die Chronik nicht lesen (${datei.type || 'unbekannt'}). ` +
        'Erlaubt sind JPEG, PNG, WebP und GIF.',
    );
  }

  if (datei.size > 20 * 1024 * 1024) {
    throw new BildFehler('Das Bildnis ist größer als 20 MB. Bitte ein kleineres wählen.');
  }

  const datenUrl = await alsDatenUrl(datei);

  if (datei.type === 'image/gif') {
    return {
      base64: datenUrl.split(',')[1] ?? '',
      medienTyp: 'image/gif',
      vorschauUrl: datenUrl,
      breite: 0,
      hoehe: 0,
    };
  }

  const bild = await alsBildElement(datenUrl);
  const faktor = Math.min(1, MAX_KANTE / Math.max(bild.naturalWidth, bild.naturalHeight));

  // Klein genug — unverändert durchreichen, kein Qualitätsverlust durch Re-Encoding.
  if (faktor === 1 && datei.size <= 4 * 1024 * 1024) {
    return {
      base64: datenUrl.split(',')[1] ?? '',
      medienTyp: datei.type as AufbereitetesBild['medienTyp'],
      vorschauUrl: datenUrl,
      breite: bild.naturalWidth,
      hoehe: bild.naturalHeight,
    };
  }

  const breite = Math.round(bild.naturalWidth * faktor);
  const hoehe = Math.round(bild.naturalHeight * faktor);

  const canvas = document.createElement('canvas');
  canvas.width = breite;
  canvas.height = hoehe;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new BildFehler('Der Browser stellt keine Canvas bereit.');

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bild, 0, 0, breite, hoehe);

  const skaliert = canvas.toDataURL('image/jpeg', JPEG_QUALITAET);

  return {
    base64: skaliert.split(',')[1] ?? '',
    medienTyp: 'image/jpeg',
    vorschauUrl: skaliert,
    breite,
    hoehe,
  };
}

function alsDatenUrl(datei: File): Promise<string> {
  return new Promise((erfuellen, ablehnen) => {
    const leser = new FileReader();
    leser.onload = () => erfuellen(leser.result as string);
    leser.onerror = () => ablehnen(new BildFehler('Die Datei konnte nicht gelesen werden.'));
    leser.readAsDataURL(datei);
  });
}

function alsBildElement(datenUrl: string): Promise<HTMLImageElement> {
  return new Promise((erfuellen, ablehnen) => {
    const bild = new Image();
    bild.onload = () => erfuellen(bild);
    bild.onerror = () => ablehnen(new BildFehler('Das Bildnis konnte nicht decodiert werden.'));
    bild.src = datenUrl;
  });
}
