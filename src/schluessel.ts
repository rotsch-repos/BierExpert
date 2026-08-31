/**
 * Räumt den persönlichen Anthropic-Schlüssel aus dem Browser.
 *
 * Bis zum 31.08. konnte jeder Besucher hier einen eigenen Schlüssel
 * hinterlegen; er ging als Kopfzeile mit jeder Anfrage mit. Das war nötig,
 * solange der Server keinen eigenen hatte. Seit ANTHROPIC_SCHLUESSEL als
 * Secret beim Deploy ankommt, hat er einen — die Kammer ist damit nicht nur
 * überflüssig, sondern schädlich: Ein alter, längst widerrufener Schlüssel
 * im localStorage überstimmt den funktionierenden auf dem Server, und der
 * Scan scheitert an einem Schlüssel, den der Leser vergessen hat.
 *
 * Deshalb wird der Eintrag beim Start aktiv entfernt statt nur nicht mehr
 * gelesen. Ihn liegen zu lassen hiesse, ein totes Geheimnis in fremden
 * Browsern aufzubewahren — ohne Oberfläche, es je wieder loszuwerden.
 */

// Muss buchstabengetreu der Name sein, unter dem die Kammer abgelegt hat —
// sonst räumt das Vergessen an der Stelle vorbei, an der etwas liegt.
const ABLAGE = 'bierexpert-anthropic-schluessel';

export function schluesselVergessen(): void {
  try {
    localStorage.removeItem(ABLAGE);
  } catch {
    // Private Fenster und Browser, die Websitedaten sperren, werfen hier.
    // Ist der Zugriff versperrt, gibt es auch nichts aufzuräumen.
  }
}
