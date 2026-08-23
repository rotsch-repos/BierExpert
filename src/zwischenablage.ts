import { istErlaubterTyp } from './schema';

/**
 * Bild aus der Zwischenablage holen.
 *
 * Zwei Wege, weil die Zwischenablage je nach Herkunft etwas anderes enthält:
 *
 * - `navigator.clipboard.read()` — für die Schaltfläche. Liefert den Inhalt
 *   direkt, braucht aber eine Nutzergeste und in manchen Browsern eine
 *   Freigabe. Nur über HTTPS oder auf localhost verfügbar.
 * - Das `paste`-Ereignis — für Strg+V. Braucht keine Freigabe.
 *
 * In beiden Fällen kann statt eines Bildes auch eine URL darin liegen: Wer ein
 * Bild auf einer Webseite kopiert, hat je nach Browser nur dessen Adresse in
 * der Zwischenablage, nicht die Bilddaten. Deshalb wird auch danach gesucht.
 */

export class ZwischenablageFehler extends Error {}

/** Über die Schaltfläche: fragt die Zwischenablage aktiv ab. */
export async function ausZwischenablage(): Promise<File> {
  if (!navigator.clipboard?.read) {
    throw new ZwischenablageFehler(
      'Dieser Browser gibt die Zwischenablage nicht frei. Nutze Strg+V direkt auf der Seite.',
    );
  }

  let eintraege: ClipboardItem[];
  try {
    eintraege = await navigator.clipboard.read();
  } catch (fehler) {
    // Verweigerte Freigabe und "kein sicherer Kontext" landen beide hier.
    throw new ZwischenablageFehler(
      window.isSecureContext
        ? 'Der Zugriff auf die Zwischenablage wurde abgelehnt. Erlaube ihn in den ' +
          'Seiteneinstellungen des Browsers, oder nutze Strg+V direkt auf der Seite.'
        : 'Die Zwischenablage ist nur über HTTPS oder auf localhost zugänglich. ' +
          'Nutze Strg+V direkt auf der Seite.',
      { cause: fehler },
    );
  }

  for (const eintrag of eintraege) {
    const bildTyp = eintrag.types.find((typ) => istErlaubterTyp(typ));
    if (bildTyp) {
      const blob = await eintrag.getType(bildTyp);
      return alsDatei(blob, bildTyp);
    }
  }

  // Kein Bild — vielleicht eine Adresse darauf?
  for (const eintrag of eintraege) {
    for (const typ of ['text/plain', 'text/uri-list'] as const) {
      if (!eintrag.types.includes(typ)) continue;
      const text = (await (await eintrag.getType(typ)).text()).trim();
      const datei = await ausDatenUrl(text);
      if (datei) return datei;
    }
  }

  throw new ZwischenablageFehler(
    'In der Zwischenablage liegt kein Bild. Kopiere ein Bild — nicht nur den Link darauf.',
  );
}

/** Über Strg+V: liest, was das Ereignis mitbringt. */
export async function ausEreignis(e: ClipboardEvent): Promise<File | null> {
  const daten = e.clipboardData;
  if (!daten) return null;

  // 1. Ein echtes Bild, der häufigste und beste Fall.
  const bild = Array.from(daten.items)
    .find((eintrag) => eintrag.kind === 'file' && istErlaubterTyp(eintrag.type))
    ?.getAsFile();
  if (bild) return bild;

  // 2. Aus einer Webseite kopiert: das HTML enthält oft ein eingebettetes Bild.
  const html = daten.getData('text/html');
  if (html) {
    const treffer = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    const datei = treffer?.[1] ? await ausDatenUrl(treffer[1]) : null;
    if (datei) return datei;
  }

  // 3. Nur eine Adresse.
  for (const typ of ['text/plain', 'text/uri-list']) {
    const text = daten.getData(typ).trim();
    if (!text) continue;
    const datei = await ausDatenUrl(text);
    if (datei) return datei;
  }

  return null;
}

/**
 * Macht aus einer Adresse eine Datei, sofern das ohne Server geht.
 *
 * `data:`-URLs enthalten das Bild selbst und funktionieren immer. Eine
 * `http(s)`-Adresse ließe sich nur mit einem Abruf einlösen, den die
 * Ursprungsprüfung des fremden Servers in aller Regel abweist — deshalb wird
 * es zwar versucht, aber ein Scheitern ist der Normalfall und kein Fehler.
 */
async function ausDatenUrl(text: string): Promise<File | null> {
  if (text.startsWith('data:')) {
    const typ = /^data:([^;,]+)/.exec(text)?.[1] ?? '';
    if (!istErlaubterTyp(typ)) return null;
    const blob = await (await fetch(text)).blob();
    return alsDatei(blob, typ);
  }

  if (!/^https?:\/\//i.test(text)) return null;

  try {
    const antwort = await fetch(text, { mode: 'cors' });
    if (!antwort.ok) return null;
    const blob = await antwort.blob();
    if (!istErlaubterTyp(blob.type)) return null;
    return alsDatei(blob, blob.type);
  } catch {
    // Ursprungsprüfung des fremden Servers — von hier aus nicht zu umgehen.
    return null;
  }
}

function alsDatei(blob: Blob, typ: string): File {
  const endung = typ.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  return new File([blob], `zwischenablage.${endung}`, { type: typ });
}
