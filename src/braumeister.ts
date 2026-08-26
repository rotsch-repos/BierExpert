import type { Stromereignis } from './etikett';

/**
 * Die Stimme, die den Leser durch das Warten begleitet.
 *
 * Warum überhaupt: Ein Scan mit unbekanntem Etikett dauert. Ein Balken, der
 * sich bewegt, ohne etwas zu wissen, ist dabei nicht ehrlicher als gar
 * keiner — er tut nur so. Der Fortschritts-Strom weiss dagegen tatsächlich,
 * was gerade geschieht, und ab der ersten halben Sekunde sogar, welches
 * Bier auf dem Foto ist.
 *
 * Deshalb sagt diese Zeile immer etwas Wahres. "Ein neues Etikett" steht da
 * nur, wenn es wirklich keines in der Datenbank gibt; "das kenne ich" nur
 * bei einem Treffer. Die Braumetaphorik ist die Kleidung, nicht der Inhalt —
 * wer sie wegdenkt, liest immer noch, woran der Server gerade arbeitet.
 */

/** Sprüche fürs Warten, wenn nur der Herzschlag kommt. */
const BEIM_WARTEN: Record<string, readonly string[]> = {
  erkennung: [
    'Der Braumeister hält das Etikett ins Licht …',
    'Noch ist die Schrift nicht ganz zu entziffern …',
  ],
  verorten: [
    'Wo sass noch gleich das Wappen?',
    'Die Zeichen werden auf dem Etikett gesucht …',
  ],
  auswertung: [
    'Der Kessel wird angeheizt …',
    'Die Sudpfanne kommt auf Temperatur …',
    'Das Etikett wird Zeile für Zeile gelesen …',
    'Die Hopfengabe will bedacht sein …',
    'Noch einen Augenblick — gut Ding will Weile haben.',
  ],
};

/**
 * Was der Erzähler zu einem Ereignis zu sagen hat.
 *
 * Zwei Felder und nicht eines, weil die beiden Aussagen verschieden lange
 * gelten. Der Fund — welches Bier das ist — steht fest, sobald die erste
 * Stufe gelesen hat, und bleibt bis zum Befund stehen. Die Zeile darunter
 * beschreibt, was gerade geschieht, und wechselt dauernd.
 *
 * Ohne diese Trennung ginge ausgerechnet die wertvollste Auskunft unter:
 * Server schickt "erkannt" und "auswertung" unmittelbar hintereinander, und
 * eine einzelne Zeile wäre nach wenigen Millisekunden überschrieben. Genau
 * das war im Browser zu sehen, bevor es diese zwei Felder gab.
 */
export interface Ansage {
  /** Wechselt laufend: was der Server gerade tut. */
  zeile?: string;
  /** Bleibt stehen: welches Bier erkannt wurde. */
  fund?: string;
}

/**
 * Baut einen Erzähler.
 *
 * Er merkt sich, bei welchem Spruch er zuletzt war, damit der Herzschlag
 * die Zeile weiterdreht statt sie zu wiederholen. Eine Zeile, die sich
 * dreissig Sekunden lang nicht ändert, sieht aus wie eine hängengebliebene
 * Anwendung — auch wenn dahinter alles seinen Gang geht.
 */
export function braumeister(): (ereignis: Stromereignis) => Ansage {
  let umlauf = 0;

  return (ereignis: Stromereignis): Ansage => {
    switch (ereignis.stufe) {
      case 'laden':
        return { zeile: 'Das Foto liegt auf dem Tresen …' };

      case 'erkennung':
        return { zeile: 'Der Braumeister nimmt die Flasche zur Hand …' };

      case 'erkannt': {
        if (ereignis.ist_bier === false) {
          return { zeile: 'Hm. Das sieht dem Braumeister nach gar keinem Bier aus …' };
        }

        const name = (ereignis.name ?? '').trim();
        const brauerei = (ereignis.brauerei ?? '').trim();

        // "unbekannt" ist die ehrliche Antwort der ersten Stufe, wenn sie
        // nichts lesen konnte. Sie dem Leser als Namen vorzusetzen wäre
        // Unsinn — dann lieber nichts behaupten.
        if (name === '' || name.toLowerCase() === 'unbekannt') {
          return { zeile: 'Die Schrift gibt nicht viel her — das grosse Fass muss ran.' };
        }

        return {
          fund:
            brauerei === '' || brauerei.toLowerCase() === 'unbekannt'
              ? `Ein „${name}“`
              : `Ein „${name}“ von ${brauerei}`,
        };
      }

      case 'gefunden': {
        const stil = (ereignis.stil ?? '').trim();
        return {
          zeile:
            stil === ''
              ? 'Das kenne ich doch! Der Zettel liegt schon im Archiv.'
              : `Das kenne ich doch — ${stil}. Der Zettel liegt im Archiv.`,
        };
      }

      case 'verorten':
        return {
          zeile:
            ereignis.elemente && ereignis.elemente > 0
              ? `${ereignis.elemente} Zeichen sind zu suchen …`
              : 'Die Zeichen werden auf dem Etikett gesucht …',
        };

      case 'auswertung':
        return { zeile: 'Ein neues Etikett! Der Kessel wird angeheizt …' };

      case 'puls': {
        const sprueche = BEIM_WARTEN[ereignis.laeuft ?? ''] ?? BEIM_WARTEN['auswertung'];
        if (!sprueche || sprueche.length === 0) return {};
        return { zeile: sprueche[umlauf++ % sprueche.length] };
      }

      // 'fertig' und 'fehler' sagen nichts: Dort tritt der Befund selbst an
      // die Stelle des Wartens.
      default:
        return {};
    }
  };
}
