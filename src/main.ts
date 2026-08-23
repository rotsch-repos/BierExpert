import './style.css';
import { bildAufbereiten, BildFehler, type AufbereitetesBild } from './bild';
import { chronikBefragen, ChronikFehler } from './chronik';
import type { Chronik } from './schema';

const SPEICHER_SCHLUESSEL = 'bierexpert.apiSchluessel';

/* ---------------------------------------------------------------- Elemente */

const el = <T extends HTMLElement>(id: string): T => {
  const knoten = document.getElementById(id);
  if (!knoten) throw new Error(`Element #${id} fehlt im Dokument`);
  return knoten as T;
};

const ablage = el<HTMLDivElement>('ablage');
const dateiFeld = el<HTMLInputElement>('datei');
const vorschau = el<HTMLImageElement>('vorschau');
const ablageInhalt = ablage.querySelector<HTMLDivElement>('.ablage-inhalt')!;
const dateiname = el<HTMLParagraphElement>('dateiname');
const befragenTaste = el<HTMLButtonElement>('befragen');
const verwerfenTaste = el<HTMLButtonElement>('verwerfen');
const kapitelChronik = el<HTMLElement>('kapitel-chronik');
const chronikZiel = el<HTMLDivElement>('chronik');
const kammer = el<HTMLDetailsElement>('kammer');
const schluesselFeld = el<HTMLInputElement>('schluessel');
const kammerStatus = el<HTMLParagraphElement>('kammer-status');

/* ------------------------------------------------------------------ Zustand */

let aktuellesBild: AufbereitetesBild | null = null;
let laeuft = false;

/* ------------------------------------------------------- Schlüsselkammer */

function schluesselLesen(): string {
  try {
    return localStorage.getItem(SPEICHER_SCHLUESSEL) ?? '';
  } catch {
    // Privater Modus oder blockierte Site-Daten — dann eben ohne Gedächtnis.
    return '';
  }
}

function kammerFuellen(): void {
  const vorhanden = schluesselLesen();
  if (vorhanden) {
    schluesselFeld.value = vorhanden;
    melden('Ein Schlüssel liegt verwahrt.', 'gut');
  }
}

function melden(text: string, art: 'gut' | 'warn' | '' = ''): void {
  kammerStatus.textContent = text;
  kammerStatus.className = `kammer-status ${art}`;
}

el<HTMLButtonElement>('schluessel-speichern').addEventListener('click', () => {
  const wert = schluesselFeld.value.trim();
  if (!wert) {
    melden('Kein Schlüssel eingetragen.', 'warn');
    return;
  }
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, wert);
    melden('Der Schlüssel ist verwahrt.', 'gut');
  } catch {
    melden('Dieser Browser erlaubt kein Speichern. Der Schlüssel gilt nur für diese Sitzung.', 'warn');
  }
});

el<HTMLButtonElement>('schluessel-loeschen').addEventListener('click', () => {
  try {
    localStorage.removeItem(SPEICHER_SCHLUESSEL);
  } catch {
    /* nichts zu tilgen */
  }
  schluesselFeld.value = '';
  melden('Der Schlüssel wurde getilgt.', '');
});

/* ------------------------------------------------------------ Bild annehmen */

async function bildAnnehmen(datei: File): Promise<void> {
  try {
    aktuellesBild = await bildAufbereiten(datei);

    vorschau.src = aktuellesBild.vorschauUrl;
    vorschau.hidden = false;
    ablageInhalt.hidden = true;

    const kb = Math.round((aktuellesBild.base64.length * 0.75) / 1024);
    const masse = aktuellesBild.breite ? ` · ${aktuellesBild.breite}×${aktuellesBild.hoehe} px` : '';
    dateiname.textContent = `${datei.name}${masse} · ${kb} kB`;
    dateiname.hidden = false;

    befragenTaste.disabled = false;
    verwerfenTaste.hidden = false;
  } catch (fehler) {
    aktuellesBild = null;
    befragenTaste.disabled = true;
    zeigeFehler(
      fehler instanceof BildFehler ? fehler.message : 'Das Bildnis konnte nicht gelesen werden.',
    );
  }
}

function bildVerwerfen(): void {
  aktuellesBild = null;
  vorschau.hidden = true;
  vorschau.removeAttribute('src');
  ablageInhalt.hidden = false;
  dateiname.hidden = true;
  dateiFeld.value = '';
  befragenTaste.disabled = true;
  verwerfenTaste.hidden = true;
  kapitelChronik.hidden = true;
  chronikZiel.replaceChildren();
}

verwerfenTaste.addEventListener('click', bildVerwerfen);

/* ------------------------------------------- Ablage: Klick, Drag&Drop, Paste */

ablage.addEventListener('click', () => dateiFeld.click());

ablage.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    dateiFeld.click();
  }
});

dateiFeld.addEventListener('change', () => {
  const datei = dateiFeld.files?.[0];
  if (datei) void bildAnnehmen(datei);
});

for (const art of ['dragenter', 'dragover'] as const) {
  ablage.addEventListener(art, (e) => {
    e.preventDefault();
    ablage.classList.add('bereit');
  });
}

for (const art of ['dragleave', 'drop'] as const) {
  ablage.addEventListener(art, () => ablage.classList.remove('bereit'));
}

ablage.addEventListener('drop', (e) => {
  e.preventDefault();
  const datei = e.dataTransfer?.files?.[0];
  if (datei) void bildAnnehmen(datei);
});

document.addEventListener('paste', (e) => {
  const datei = Array.from(e.clipboardData?.items ?? [])
    .find((eintrag) => eintrag.type.startsWith('image/'))
    ?.getAsFile();
  if (datei) void bildAnnehmen(datei);
});

/* --------------------------------------------------------- Chronik befragen */

befragenTaste.addEventListener('click', async () => {
  if (!aktuellesBild || laeuft) return;

  const schluessel = schluesselFeld.value.trim() || schluesselLesen();
  if (!schluessel) {
    kammer.open = true;
    melden('Ohne Schlüssel bleibt die Chronik verschlossen.', 'warn');
    kammer.scrollIntoView({ block: 'center' });
    schluesselFeld.focus();
    return;
  }

  laeuft = true;
  befragenTaste.disabled = true;
  befragenTaste.textContent = 'Der Chronist blättert …';
  wartenZeigen();

  try {
    const chronik = await chronikBefragen(schluessel, aktuellesBild);
    chronikZeichnen(chronik);
  } catch (fehler) {
    const f = fehler as ChronikFehler;
    zeigeFehler(f.message ?? 'Unbekannter Fehler', f.rat);
  } finally {
    laeuft = false;
    befragenTaste.disabled = false;
    befragenTaste.textContent = 'Die Chronik befragen';
  }
});

/* ------------------------------------------------------------- Darstellung */

function kapitelOeffnen(): HTMLDivElement {
  kapitelChronik.hidden = false;
  chronikZiel.replaceChildren();
  return chronikZiel;
}

function wartenZeigen(): void {
  const ziel = kapitelOeffnen();
  const block = document.createElement('div');
  block.className = 'warten';
  block.innerHTML =
    '<p class="warten-symbol" aria-hidden="true">&#127866;</p>' +
    '<p>Der Chronist prüft das Bildnis und schlägt in den Annalen nach …</p>';
  ziel.append(block);
  kapitelChronik.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function zeigeFehler(titel: string, rat?: string): void {
  const ziel = kapitelOeffnen();
  const block = document.createElement('div');
  block.className = 'fehler';

  const kopf = document.createElement('strong');
  kopf.textContent = titel;
  block.append(kopf);

  if (rat) {
    const p = document.createElement('p');
    p.textContent = rat;
    block.append(p);
  }

  ziel.append(block);
}

/** Baut die Chronik auf. Durchgehend textContent — kein HTML aus der Modellantwort. */
function chronikZeichnen(c: Chronik): void {
  const ziel = kapitelOeffnen();
  const blatt = document.createElement('article');
  blatt.className = 'chronik-blatt';

  if (!c.erkannt) {
    const kopf = document.createElement('h3');
    kopf.className = 'chronik-titel';
    kopf.textContent = 'Kein Bier in Sicht';
    const p = document.createElement('p');
    p.className = 'chronik-brauerei';
    p.textContent = c.hinweis || 'Auf diesem Bildnis ist keine Bierflasche zu erkennen.';
    blatt.append(kopf, p);
    ziel.append(blatt);
    return;
  }

  const siegel = document.createElement('span');
  siegel.className = `siegel siegel-${c.sicherheit}`;
  siegel.textContent = `Zuordnung: ${c.sicherheit}`;
  blatt.append(siegel);

  const titel = document.createElement('h3');
  titel.className = 'chronik-titel';
  titel.textContent = c.name;
  blatt.append(titel);

  const brauerei = document.createElement('p');
  brauerei.className = 'chronik-brauerei';
  brauerei.textContent = [c.brauerei, c.ort, c.land]
    .filter((s) => s && s.toLowerCase() !== 'unbekannt')
    .join(' · ');
  blatt.append(brauerei);

  blatt.append(
    tafelBauen([
      ['Gegründet', c.gegruendet],
      ['Stil', c.stil],
      ['Stammwürze', c.stammwuerze],
      ['Alkohol', c.alkohol],
    ]),
  );

  blatt.append(absatzBlock('Entstehungsgeschichte', c.entstehungsgeschichte, true));
  blatt.append(absatzBlock('Kloster- und Brauhaustradition', c.klosterbezug, false));

  if (c.besonderheiten.length) {
    const abschnitt = document.createElement('section');
    abschnitt.className = 'chronik-abschnitt';
    const h = document.createElement('h4');
    h.textContent = 'Merkwürdigkeiten';
    const liste = document.createElement('ul');
    liste.className = 'merkmale';
    for (const punkt of c.besonderheiten) {
      const li = document.createElement('li');
      li.textContent = punkt;
      liste.append(li);
    }
    abschnitt.append(h, liste);
    blatt.append(abschnitt);
  }

  if (c.hinweis.trim()) {
    const hinweis = document.createElement('p');
    hinweis.className = 'chronik-hinweis';
    hinweis.textContent = `Anmerkung des Chronisten: ${c.hinweis}`;
    blatt.append(hinweis);
  }

  ziel.append(blatt);
}

function tafelBauen(zeilen: ReadonlyArray<readonly [string, string]>): HTMLDListElement {
  const tafel = document.createElement('dl');
  tafel.className = 'tafel';
  for (const [begriff, wert] of zeilen) {
    const zelle = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = begriff;
    const dd = document.createElement('dd');
    dd.textContent = wert || 'unbekannt';
    zelle.append(dt, dd);
    tafel.append(zelle);
  }
  return tafel;
}

function absatzBlock(ueberschrift: string, text: string, initiale: boolean): HTMLElement {
  const abschnitt = document.createElement('section');
  abschnitt.className = 'chronik-abschnitt';

  const h = document.createElement('h4');
  h.textContent = ueberschrift;
  abschnitt.append(h);

  const absaetze = text.split(/\n{2,}/).filter((a) => a.trim());
  absaetze.forEach((absatz, i) => {
    const p = document.createElement('p');
    if (initiale && i === 0) p.className = 'initiale';
    p.textContent = absatz.trim();
    abschnitt.append(p);
  });

  return abschnitt;
}

/* ------------------------------------------------------------------- Start */

kammerFuellen();
