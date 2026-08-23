import type { Biersorte, Glasform } from './glossar';

/**
 * Zeichnet ein Bierglas als SVG — Glasform, Bierfarbe und Schaumkrone der
 * jeweiligen Sorte.
 *
 * Warum gezeichnet und nicht fotografiert: Fotos echter Markenbiere liegen
 * nicht bei und wären rechtlich heikel. Farbe, Schaumhöhe und Glasform sind
 * ohnehin genau die Merkmale, an denen sich eine Sorte im Glas erkennen lässt.
 */

const BREITE = 100;
const HOEHE = 190;

/**
 * Umriss je Glasform als Pfad, plus der Bereich, den die Füllung einnimmt.
 * Die Füllung wird per clipPath auf den Umriss beschnitten, damit sie der
 * Glasform folgt, statt als Rechteck darüberzuliegen.
 */
interface Bauplan {
  /** Umriss des Glaskörpers (ohne Stiel/Fuß). */
  koerper: string;
  /** Stiel und Fuß, falls die Form einen hat. */
  fuss?: string;
  /** Oberkante der Füllung. */
  oben: number;
  /** Unterkante der Füllung. */
  unten: number;
}

const BAUPLAENE: Record<Glasform, Bauplan> = {
  // Pilstulpe: schmaler Fuß, ausschwingender Kelch
  tulpe: {
    koerper: 'M32 34 C32 34 28 78 34 112 C38 136 42 150 44 158 L56 158 C58 150 62 136 66 112 C72 78 68 34 68 34 Z',
    fuss: 'M44 158 L44 172 M32 174 L68 174',
    oben: 38,
    unten: 157,
  },
  // Weizenglas: hoch, unten schlank, oben bauchig
  weizen: {
    koerper: 'M36 24 C36 24 33 52 37 76 C40 96 30 118 34 140 C37 158 42 166 44 170 L56 170 C58 166 63 158 66 140 C70 118 60 96 63 76 C67 52 64 24 64 24 Z',
    oben: 28,
    unten: 169,
  },
  // Kölsch-/Alt-Stange: schlanker gerader Zylinder
  stange: {
    koerper: 'M38 30 L38 168 L62 168 L62 30 Z',
    oben: 34,
    unten: 167,
  },
  // Seidel: gerade, breit, leicht konisch
  humpen: {
    koerper: 'M28 34 L32 168 L68 168 L72 34 Z',
    oben: 38,
    unten: 167,
  },
  // Kelch auf Stiel: bauchige Schale
  kelch: {
    koerper: 'M26 40 C26 40 26 92 40 118 L60 118 C74 92 74 40 74 40 Z',
    fuss: 'M50 118 L50 156 M28 160 L72 160',
    oben: 44,
    unten: 117,
  },
  // Nonic Pint: gerade mit Wulst unterhalb des Randes
  pint: {
    koerper: 'M30 30 L33 62 L29 68 L35 74 L38 168 L62 168 L65 74 L71 68 L67 62 L70 30 Z',
    oben: 34,
    unten: 167,
  },
  // Schwenker: kurzer Stiel, weite Schale
  schwenker: {
    koerper: 'M28 52 C28 52 26 100 44 122 L56 122 C74 100 72 52 72 52 Z',
    fuss: 'M50 122 L50 150 M32 154 L68 154',
    oben: 56,
    unten: 121,
  },
};

/** Baut das SVG für eine Sorte. Gibt ein fertiges Element zurück. */
export function glasZeichnen(sorte: Biersorte): SVGSVGElement {
  const plan = BAUPLAENE[sorte.glas];
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${BREITE} ${HOEHE}`);
  svg.setAttribute('class', 'glas');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${sorte.name}: ${sorte.charakter.split('.')[0]}`);

  // Eindeutige ID je Sorte, damit sich mehrere Gläser auf einer Seite nicht
  // gegenseitig den clipPath wegnehmen.
  const id = `glas-${sorte.name.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;

  const defs = document.createElementNS(ns, 'defs');
  const clip = document.createElementNS(ns, 'clipPath');
  clip.setAttribute('id', id);
  const clipPfad = document.createElementNS(ns, 'path');
  clipPfad.setAttribute('d', plan.koerper);
  clip.append(clipPfad);
  defs.append(clip);
  svg.append(defs);

  const gefuellt = document.createElementNS(ns, 'g');
  gefuellt.setAttribute('clip-path', `url(#${id})`);

  const hoehe = plan.unten - plan.oben;
  const schaumhoehe = hoehe * sorte.schaumanteil;

  // Bier
  const bier = document.createElementNS(ns, 'rect');
  bier.setAttribute('x', '0');
  bier.setAttribute('y', String(plan.oben + schaumhoehe));
  bier.setAttribute('width', String(BREITE));
  bier.setAttribute('height', String(hoehe - schaumhoehe));
  bier.setAttribute('fill', sorte.farbe);
  gefuellt.append(bier);

  // Schaumkrone
  const schaum = document.createElementNS(ns, 'rect');
  schaum.setAttribute('x', '0');
  schaum.setAttribute('y', String(plan.oben));
  schaum.setAttribute('width', String(BREITE));
  schaum.setAttribute('height', String(schaumhoehe));
  schaum.setAttribute('fill', sorte.schaum);
  gefuellt.append(schaum);

  svg.append(gefuellt);

  // Umriss zuletzt, damit er über der Füllung liegt
  const umriss = document.createElementNS(ns, 'path');
  umriss.setAttribute('d', plan.koerper);
  umriss.setAttribute('class', 'glas-umriss');
  svg.append(umriss);

  if (plan.fuss) {
    const fuss = document.createElementNS(ns, 'path');
    fuss.setAttribute('d', plan.fuss);
    fuss.setAttribute('class', 'glas-umriss');
    svg.append(fuss);
  }

  return svg;
}
