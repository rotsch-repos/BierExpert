import './style.css';
import { bildAufbereiten, BildFehler, type AufbereitetesBild } from './bild';
import { etikettLesen, EtikettFehler } from './etikett';
import type { Etikett, Etikettelement } from './schema';

const SPEICHER_SCHLUESSEL = 'bierexpert.apiSchluessel';

/* ---------------------------------------------------------------- Elemente */

const el = <T extends HTMLElement>(id: string): T => {
  const knoten = document.getElementById(id);
  if (!knoten) throw new Error(`Element #${id} fehlt im Dokument`);
  return knoten as T;
};

const ablage = el<HTMLDivElement>('ablage');
const ablageInhalt = el<HTMLDivElement>('ablage-inhalt');
const dateiFeld = el<HTMLInputElement>('datei');
const kameraFeld = el<HTMLInputElement>('kamera');
const vorschau = el<HTMLImageElement>('vorschau');
const dateizeile = el<HTMLParagraphElement>('dateizeile');
const lesenTaste = el<HTMLButtonElement>('lesen');
const fotoTaste = el<HTMLButtonElement>('fotografieren');
const verwerfenTaste = el<HTMLButtonElement>('verwerfen');
const abschnittBefund = el<HTMLElement>('abschnitt-befund');
const befundZiel = el<HTMLDivElement>('befund');
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

function melden(text: string, art: 'gut' | 'warn' | '' = ''): void {
  kammerStatus.textContent = text;
  kammerStatus.className = `kammer-status body-md ${art}`;
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
  melden('Der Schlüssel wurde getilgt.');
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
    dateizeile.textContent = `${datei.name}${masse} · ${kb} kB`;
    dateizeile.hidden = false;

    lesenTaste.disabled = false;
    verwerfenTaste.hidden = false;
  } catch (fehler) {
    aktuellesBild = null;
    lesenTaste.disabled = true;
    zeigeFehler(
      fehler instanceof BildFehler ? fehler.message : 'Das Bild konnte nicht gelesen werden.',
    );
  }
}

function bildVerwerfen(): void {
  aktuellesBild = null;
  vorschau.hidden = true;
  vorschau.removeAttribute('src');
  ablageInhalt.hidden = false;
  dateizeile.hidden = true;
  dateiFeld.value = '';
  kameraFeld.value = '';
  lesenTaste.disabled = true;
  verwerfenTaste.hidden = true;
  abschnittBefund.hidden = true;
  befundZiel.replaceChildren();
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

// Auf dem Handy öffnet capture="environment" direkt die Kamera.
fotoTaste.addEventListener('click', () => kameraFeld.click());

for (const feld of [dateiFeld, kameraFeld]) {
  feld.addEventListener('change', () => {
    const datei = feld.files?.[0];
    if (datei) void bildAnnehmen(datei);
  });
}

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

/* ----------------------------------------------------------- Auswerten */

lesenTaste.addEventListener('click', async () => {
  if (!aktuellesBild || laeuft) return;

  const schluessel = schluesselFeld.value.trim() || schluesselLesen();
  if (!schluessel) {
    kammer.open = true;
    melden('Ohne Schlüssel geht es nicht weiter.', 'warn');
    kammer.scrollIntoView({ block: 'center' });
    schluesselFeld.focus();
    return;
  }

  laeuft = true;
  lesenTaste.disabled = true;
  lesenTaste.textContent = 'Wird gelesen …';
  wartenZeigen();

  try {
    befundZeichnen(await etikettLesen(schluessel, aktuellesBild));
  } catch (fehler) {
    const f = fehler as EtikettFehler;
    zeigeFehler(f.message ?? 'Unbekannter Fehler', f.rat);
  } finally {
    laeuft = false;
    lesenTaste.disabled = false;
    lesenTaste.textContent = 'Etikett auswerten';
  }
});

/* ------------------------------------------------------------- Darstellung */

function abschnittOeffnen(): HTMLDivElement {
  abschnittBefund.hidden = false;
  befundZiel.replaceChildren();
  return befundZiel;
}

function wartenZeigen(): void {
  const ziel = abschnittOeffnen();
  const block = document.createElement('div');
  block.className = 'warten';

  const mal = document.createElement('span');
  mal.className = 'warten-mal';
  mal.setAttribute('aria-hidden', 'true');

  const text = document.createElement('p');
  text.className = 'body-md';
  text.style.margin = '0';
  text.textContent = 'Das Etikett wird gelesen und in seine Elemente zerlegt …';

  block.append(mal, text);
  ziel.append(block);
  abschnittBefund.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function zeigeFehler(titel: string, rat?: string): void {
  const ziel = abschnittOeffnen();
  const block = document.createElement('div');
  block.className = 'fehler';

  const kopf = document.createElement('strong');
  kopf.className = 'body-lg';
  kopf.textContent = titel;
  block.append(kopf);

  if (rat) {
    const p = document.createElement('p');
    p.className = 'body-md';
    p.textContent = rat;
    block.append(p);
  }

  ziel.append(block);
}

/** Baut den Befund auf. Durchgehend textContent — kein HTML aus der Modellantwort. */
function befundZeichnen(e: Etikett): void {
  const ziel = abschnittOeffnen();
  const blatt = document.createElement('article');
  blatt.className = 'chronik-blatt';

  if (!e.erkannt) {
    const kopf = document.createElement('h3');
    kopf.className = 'chronik-titel headline-md';
    kopf.textContent = 'Kein Etikett erkannt';
    const p = document.createElement('p');
    p.className = 'body-lg';
    p.textContent = e.hinweis || 'Auf diesem Bild ist kein Bieretikett zu erkennen.';
    blatt.append(kopf, p);
    ziel.append(blatt);
    return;
  }

  /* --- Kopf: Serifentitel über Tonblock --- */
  const kopf = document.createElement('div');
  kopf.className = 'chronik-kopf';

  const titel = document.createElement('h3');
  titel.className = 'chronik-titel display-lg';
  titel.textContent = e.name;

  const herkunft = document.createElement('p');
  herkunft.className = 'chronik-herkunft body-lg';
  herkunft.textContent = [e.brauerei, e.ort, e.land]
    .filter((s) => s && s.toLowerCase() !== 'unbekannt')
    .join(' · ');

  kopf.append(titel, herkunft);

  const abzeichen = document.createElement('span');
  abzeichen.className = `abzeichen label-caps${e.sicherheit === 'niedrig' ? ' abzeichen-niedrig' : ''}`;
  abzeichen.textContent = `Zuordnung ${e.sicherheit}`;

  blatt.append(abzeichen, kopf);

  blatt.append(
    tafelBauen([
      ['Gegründet', e.gegruendet],
      ['Stil', e.stil],
      ['Stammwürze', e.stammwuerze],
      ['Alkohol', e.alkohol],
    ]),
  );

  /* --- Kern: die Elemente einzeln --- */
  if (e.elemente.length) {
    blatt.append(elementeBauen(e.elemente));
  }

  blatt.append(textBlock('Farbwahl', e.farbwahl));
  blatt.append(textBlock('Schriftbild', e.schriftbild));
  blatt.append(textBlock('Geschichtlicher Hintergrund', e.hintergrund));

  /* --- Der Zweck der Übung --- */
  if (e.gespraechsstoff.length) {
    const abschnitt = document.createElement('section');
    abschnitt.className = 'chronik-abschnitt';

    const h = document.createElement('h4');
    h.className = 'label-caps';
    h.textContent = 'Für die Runde';
    abschnitt.append(h);

    const liste = document.createElement('ul');
    liste.className = 'merkmale body-lg';
    for (const satz of e.gespraechsstoff) {
      const li = document.createElement('li');
      li.textContent = satz;
      liste.append(li);
    }
    abschnitt.append(liste);
    blatt.append(abschnitt);
  }

  if (e.hinweis.trim()) {
    const hinweis = document.createElement('p');
    hinweis.className = 'chronik-hinweis body-md';
    hinweis.textContent = `Unsicher: ${e.hinweis}`;
    blatt.append(hinweis);
  }

  ziel.append(blatt);
}

function elementeBauen(elemente: readonly Etikettelement[]): HTMLElement {
  const abschnitt = document.createElement('section');
  abschnitt.className = 'chronik-abschnitt';

  const h = document.createElement('h4');
  h.className = 'label-caps';
  h.textContent = `Die Elemente · ${elemente.length}`;
  abschnitt.append(h);

  const liste = document.createElement('ol');
  liste.className = 'elemente';

  elemente.forEach((element, i) => {
    const li = document.createElement('li');
    li.className = 'element';

    const nr = document.createElement('span');
    nr.className = 'element-nr mono-data';
    nr.textContent = String(i + 1).padStart(2, '0');

    const rumpf = document.createElement('div');

    const name = document.createElement('h5');
    name.className = 'element-name headline-sm';
    name.textContent = element.bezeichnung;

    const wo = document.createElement('p');
    wo.className = 'element-wo label-caps';
    wo.textContent = element.position;

    const was = document.createElement('p');
    was.className = 'body-md';
    was.textContent = element.beschreibung;

    const warum = document.createElement('p');
    warum.className = 'element-bedeutung body-md';
    warum.textContent = element.bedeutung;

    rumpf.append(name, wo, was, warum);
    li.append(nr, rumpf);
    liste.append(li);
  });

  abschnitt.append(liste);
  return abschnitt;
}

function tafelBauen(zeilen: ReadonlyArray<readonly [string, string]>): HTMLDListElement {
  const tafel = document.createElement('dl');
  tafel.className = 'tafel';
  for (const [begriff, wert] of zeilen) {
    const zelle = document.createElement('div');
    const dt = document.createElement('dt');
    dt.className = 'label-caps';
    dt.textContent = begriff;
    const dd = document.createElement('dd');
    dd.className = 'mono-data';
    dd.textContent = wert || 'unbekannt';
    zelle.append(dt, dd);
    tafel.append(zelle);
  }
  return tafel;
}

function textBlock(ueberschrift: string, text: string): HTMLElement {
  const abschnitt = document.createElement('section');
  abschnitt.className = 'chronik-abschnitt';

  const h = document.createElement('h4');
  h.className = 'label-caps';
  h.textContent = ueberschrift;
  abschnitt.append(h);

  for (const absatz of text.split(/\n{2,}/).filter((a) => a.trim())) {
    const p = document.createElement('p');
    p.className = 'body-lg';
    p.textContent = absatz.trim();
    abschnitt.append(p);
  }

  return abschnitt;
}

/* ------------------------------------------------------------------- Start */

const vorhanden = schluesselLesen();
if (vorhanden) {
  schluesselFeld.value = vorhanden;
  melden('Ein Schlüssel liegt verwahrt.', 'gut');
}
