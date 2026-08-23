import './style.css';
import { bildAufbereiten, BildFehler, type AufbereitetesBild } from './bild';
import { etikettLesen, EtikettFehler } from './etikett';
import type { Bereich, Etikett, Etikettelement } from './schema';
import { FAMILIEN, SORTEN, type Biersorte, type Familie } from './glossar';
import { glasZeichnen } from './glas';

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

  blatt.append(reiterBauen(e));

  if (e.hinweis.trim()) {
    const hinweis = document.createElement('p');
    hinweis.className = 'chronik-hinweis body-md';
    hinweis.textContent = `Unsicher: ${e.hinweis}`;
    blatt.append(hinweis);
  }

  ziel.append(blatt);
}

/* --------------------------------------------------------------- Reiter */

interface Reiter {
  name: string;
  bauen: () => HTMLElement;
}

/**
 * Reiter nach ARIA-Muster: eine tablist mit tabs, dazu je ein tabpanel.
 * Pfeiltasten wandern zwischen den Reitern, Pos1/Ende springen an die Enden —
 * so, wie es von einem Reitersatz erwartet wird.
 */
function reiterBauen(e: Etikett): HTMLElement {
  const reiter: Reiter[] = [
    { name: 'Etikett', bauen: () => etikettReiter(e) },
    { name: 'Brauart', bauen: () => brauartReiter(e) },
    { name: 'Speisen', bauen: () => speisenReiter(e) },
    { name: 'Verkostung', bauen: () => verkostungReiter(e) },
    { name: 'Verwandte', bauen: () => verwandteReiter(e) },
  ];

  const huelle = document.createElement('div');
  huelle.className = 'reiter';

  const leiste = document.createElement('div');
  leiste.className = 'reiterleiste';
  leiste.setAttribute('role', 'tablist');
  leiste.setAttribute('aria-label', 'Sicht auf das Bier');

  const tasten: HTMLButtonElement[] = [];
  const felder: HTMLElement[] = [];

  reiter.forEach((r, i) => {
    const taste = document.createElement('button');
    taste.type = 'button';
    taste.className = 'reitertaste label-caps';
    taste.id = `reiter-${i}`;
    taste.textContent = r.name;
    taste.setAttribute('role', 'tab');
    taste.setAttribute('aria-controls', `feld-${i}`);

    const feld = document.createElement('section');
    feld.className = 'reiterfeld';
    feld.id = `feld-${i}`;
    feld.setAttribute('role', 'tabpanel');
    feld.setAttribute('aria-labelledby', `reiter-${i}`);
    feld.setAttribute('tabindex', '0');
    feld.append(r.bauen());

    taste.addEventListener('click', () => waehlen(i));
    tasten.push(taste);
    felder.push(feld);
    leiste.append(taste);
  });

  function waehlen(i: number, fokus = false): void {
    tasten.forEach((taste, j) => {
      const aktiv = i === j;
      taste.setAttribute('aria-selected', String(aktiv));
      // Nur der aktive Reiter ist per Tabulator erreichbar; zwischen den
      // Reitern wandert man mit den Pfeiltasten.
      taste.tabIndex = aktiv ? 0 : -1;
      taste.classList.toggle('aktiv', aktiv);
      felder[j]!.hidden = !aktiv;
    });
    if (fokus) tasten[i]!.focus();
  }

  leiste.addEventListener('keydown', (ev) => {
    const jetzt = tasten.findIndex((taste) => taste.getAttribute('aria-selected') === 'true');
    const letzter = tasten.length - 1;
    const ziel =
      ev.key === 'ArrowRight' ? (jetzt + 1) % tasten.length
      : ev.key === 'ArrowLeft' ? (jetzt - 1 + tasten.length) % tasten.length
      : ev.key === 'Home' ? 0
      : ev.key === 'End' ? letzter
      : -1;
    if (ziel < 0) return;
    ev.preventDefault();
    waehlen(ziel, true);
  });

  huelle.append(leiste, ...felder);
  waehlen(0);
  return huelle;
}

function etikettReiter(e: Etikett): HTMLElement {
  const huelle = document.createElement('div');

  if (e.elemente.length && aktuellesBild) {
    huelle.append(elementeBauen(e.elemente, aktuellesBild.vorschauUrl));
  }
  huelle.append(textBlock('Farbwahl', e.farbwahl));
  huelle.append(textBlock('Schriftbild', e.schriftbild));
  huelle.append(textBlock('Geschichtlicher Hintergrund', e.hintergrund));

  if (e.gespraechsstoff.length) {
    huelle.append(strichliste('Für die Runde', e.gespraechsstoff));
  }
  return huelle;
}

function brauartReiter(e: Etikett): HTMLElement {
  const huelle = document.createElement('div');
  huelle.append(textBlock('Das Verfahren', e.brauart.verfahren));

  const zutaten = document.createElement('section');
  zutaten.className = 'chronik-abschnitt';
  const h = document.createElement('h4');
  h.className = 'label-caps';
  h.textContent = 'Zutaten und ihre Rolle';
  zutaten.append(h);

  const liste = document.createElement('dl');
  liste.className = 'rollenliste';
  for (const z of e.brauart.zutaten) {
    const zeile = document.createElement('div');
    const dt = document.createElement('dt');
    dt.className = 'headline-sm';
    dt.textContent = z.was;
    const dd = document.createElement('dd');
    dd.className = 'body-md';
    dd.textContent = z.rolle;
    zeile.append(dt, dd);
    liste.append(zeile);
  }
  zutaten.append(liste);
  huelle.append(zutaten);

  huelle.append(textBlock('Gärführung', e.brauart.gaerung));
  huelle.append(textBlock('Was es hier ausmacht', e.brauart.besonderheit));
  return huelle;
}

function speisenReiter(e: Etikett): HTMLElement {
  const huelle = document.createElement('div');
  huelle.append(textBlock('Der Grundsatz', e.speisen.grundsatz));

  const paare = document.createElement('section');
  paare.className = 'chronik-abschnitt';
  const h = document.createElement('h4');
  h.className = 'label-caps';
  h.textContent = 'Das passt';
  paare.append(h);

  const liste = document.createElement('dl');
  liste.className = 'rollenliste';
  for (const paar of e.speisen.paare) {
    const zeile = document.createElement('div');
    const dt = document.createElement('dt');
    dt.className = 'headline-sm';
    dt.textContent = paar.gericht;
    const dd = document.createElement('dd');
    dd.className = 'body-md';
    dd.textContent = paar.warum;
    zeile.append(dt, dd);
    liste.append(zeile);
  }
  paare.append(liste);
  huelle.append(paare);

  huelle.append(textBlock('Besser nicht', e.speisen.meiden));
  return huelle;
}

function verkostungReiter(e: Etikett): HTMLElement {
  const huelle = document.createElement('div');

  // Temperatur und Glas sind die zwei Angaben, die man vor dem Einschenken
  // braucht — sie stehen deshalb zusammen und herausgehoben ganz oben,
  // die Begründungen folgen darunter im Fließtext.
  const servier = document.createElement('div');
  servier.className = 'servier';

  for (const [marke, wert, gross] of [
    ['Beste Trinktemperatur', e.verkostung.temperatur, true],
    ['Glas', e.verkostung.glas, false],
  ] as const) {
    const feld = document.createElement('div');

    const m = document.createElement('p');
    m.className = 'servier-marke label-caps';
    m.textContent = marke;

    const w = document.createElement('p');
    w.className = `servier-wert ${gross ? 'display-lg' : 'headline-sm'}`;
    w.textContent = wert;

    feld.append(m, w);
    servier.append(feld);
  }

  huelle.append(servier);
  huelle.append(textBlock('Warum diese Spanne', e.verkostung.temperatur_warum));
  huelle.append(textBlock('Warum dieses Glas', e.verkostung.glas_warum));
  huelle.append(textBlock('Einschenken', e.verkostung.einschenken));

  const schritte = document.createElement('section');
  schritte.className = 'chronik-abschnitt';
  const h = document.createElement('h4');
  h.className = 'label-caps';
  h.textContent = 'Schritt für Schritt';
  schritte.append(h);

  const liste = document.createElement('ol');
  liste.className = 'schrittliste';
  for (const s of e.verkostung.schritte) {
    const li = document.createElement('li');
    const name = document.createElement('p');
    name.className = 'schritt-name headline-sm';
    name.textContent = s.schritt;
    const was = document.createElement('p');
    was.className = 'body-md';
    was.textContent = s.was;
    li.append(name, was);
    liste.append(li);
  }
  schritte.append(liste);
  huelle.append(schritte);
  return huelle;
}

function verwandteReiter(e: Etikett): HTMLElement {
  const huelle = document.createElement('div');
  const abschnitt = document.createElement('section');
  abschnitt.className = 'chronik-abschnitt';

  const h = document.createElement('h4');
  h.className = 'label-caps';
  h.textContent = `Ähnlich gebraut, ähnlich im Geschmack · ${e.verwandte.length}`;
  abschnitt.append(h);

  const liste = document.createElement('ul');
  liste.className = 'verwandte';

  for (const v of e.verwandte) {
    const li = document.createElement('li');
    li.className = 'verwandtes';

    const name = document.createElement('p');
    name.className = 'verwandtes-name headline-sm';
    name.textContent = v.name;

    const her = document.createElement('p');
    her.className = 'verwandtes-herkunft label-caps';
    her.textContent = [v.brauerei, v.land].filter(Boolean).join(' · ');

    const warum = document.createElement('p');
    warum.className = 'body-md';
    warum.textContent = v.warum;

    const anders = document.createElement('p');
    anders.className = 'verwandtes-anders body-md';
    anders.textContent = `Anders: ${v.unterschied}`;

    li.append(name, her, warum, anders);
    liste.append(li);
  }

  abschnitt.append(liste);
  huelle.append(abschnitt);
  return huelle;
}

function strichliste(ueberschrift: string, saetze: readonly string[]): HTMLElement {
  const abschnitt = document.createElement('section');
  abschnitt.className = 'chronik-abschnitt';
  const h = document.createElement('h4');
  h.className = 'label-caps';
  h.textContent = ueberschrift;
  const liste = document.createElement('ul');
  liste.className = 'merkmale body-lg';
  for (const satz of saetze) {
    const li = document.createElement('li');
    li.textContent = satz;
    liste.append(li);
  }
  abschnitt.append(h, liste);
  return abschnitt;
}

function elementeBauen(
  elemente: readonly Etikettelement[],
  bildUrl: string,
): HTMLElement {
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

    /* --- links: der Text --- */
    const text = document.createElement('div');
    text.className = 'element-text';

    const kopf = document.createElement('div');
    kopf.className = 'element-kopf';

    const nr = document.createElement('span');
    nr.className = 'element-nr mono-data';
    nr.textContent = String(i + 1).padStart(2, '0');

    const name = document.createElement('h5');
    name.className = 'element-name headline-sm';
    name.textContent = element.bezeichnung;

    kopf.append(nr, name);

    const wo = document.createElement('p');
    wo.className = 'element-wo label-caps';
    wo.textContent = element.position;

    const was = document.createElement('p');
    was.className = 'body-md';
    was.textContent = element.beschreibung;

    const warum = document.createElement('p');
    warum.className = 'element-bedeutung body-md';
    warum.textContent = element.bedeutung;

    text.append(kopf, wo, was, warum);

    /* --- rechts: das Foto mit Markierung --- */
    li.append(text, bildMitMarkierung(bildUrl, element.bereich, element.bezeichnung));
    liste.append(li);
  });

  abschnitt.append(liste);
  return abschnitt;
}

/**
 * Zeigt das hochgeladene Foto und legt einen Rahmen auf den Bereich des
 * Elements. Alles außerhalb wird abgedunkelt — der Blick geht damit sofort
 * an die richtige Stelle.
 */
function bildMitMarkierung(bildUrl: string, bereich: Bereich, name: string): HTMLElement {
  const figur = document.createElement('figure');
  figur.className = 'element-bild';

  const bild = document.createElement('img');
  bild.src = bildUrl;
  bild.alt = `Fundstelle von „${name}" auf dem Etikett`;
  bild.loading = 'lazy';
  figur.append(bild);

  const k = kastenPruefen(bereich);
  if (k) {
    const marke = document.createElement('span');
    marke.className = 'element-marke';
    marke.style.left = `${k.x * 100}%`;
    marke.style.top = `${k.y * 100}%`;
    marke.style.width = `${k.breite * 100}%`;
    marke.style.height = `${k.hoehe * 100}%`;
    figur.append(marke);
  } else {
    // Ohne brauchbaren Bereich lieber gar keine Markierung als eine falsche.
    figur.classList.add('ohne-marke');
  }

  return figur;
}

/**
 * Klemmt den Bereich ins Bild und verwirft Unbrauchbares. Das Modell schätzt
 * die Koordinaten — ein Rahmen mit Breite 0 oder außerhalb des Bildes würde
 * sonst als Markierung an falscher Stelle erscheinen.
 */
function kastenPruefen(b: Bereich): Bereich | null {
  const zahl = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);

  const x = zahl(b.x);
  const y = zahl(b.y);
  if (x === null || y === null) return null;

  const breite = zahl(b.breite);
  const hoehe = zahl(b.hoehe);
  if (breite === null || hoehe === null) return null;

  // Praktisch das ganze Bild markieren sagt nichts aus.
  if (breite > 0.98 && hoehe > 0.98) return null;

  // Erst ins Bild klemmen, dann auf Mindestgröße prüfen: ein Kasten, der
  // rechts oder unten aus dem Bild ragt, schrumpft beim Klemmen und würde
  // sonst als entarteter Strich am Rand erscheinen.
  const breiteImBild = Math.min(breite, 1 - x);
  const hoeheImBild = Math.min(hoehe, 1 - y);
  if (breiteImBild < 0.01 || hoeheImBild < 0.01) return null;

  return { x, y, breite: breiteImBild, hoehe: hoeheImBild };
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

/* ==========================================================================
   Bierglossar — statisch, ohne API-Aufruf
   ========================================================================== */

const glossarZiel = el<HTMLDivElement>('glossar');
const familienwahl = el<HTMLDivElement>('familienwahl');

let familienfilter: Familie | 'alle' = 'alle';

function glossarZeichnen(): void {
  const sichtbar =
    familienfilter === 'alle' ? SORTEN : SORTEN.filter((s) => s.familie === familienfilter);

  glossarZiel.replaceChildren();

  for (const { name, erklaerung } of FAMILIEN) {
    const dieser = sichtbar.filter((s) => s.familie === name);
    if (!dieser.length) continue;

    const gruppe = document.createElement('section');
    gruppe.className = 'familie';

    const kopf = document.createElement('div');
    kopf.className = 'familie-kopf';

    const h = document.createElement('h3');
    h.className = 'headline-sm';
    h.textContent = name;

    const wie = document.createElement('p');
    wie.className = 'body-md';
    wie.textContent = erklaerung;

    kopf.append(h, wie);
    gruppe.append(kopf);

    const gitter = document.createElement('div');
    gitter.className = 'sorten';
    for (const sorte of dieser) gitter.append(sorteBauen(sorte));
    gruppe.append(gitter);

    glossarZiel.append(gruppe);
  }
}

function sorteBauen(sorte: Biersorte): HTMLElement {
  const karte = document.createElement('article');
  karte.className = 'sorte';

  const bild = document.createElement('div');
  bild.className = 'sorte-glas';
  bild.append(glasZeichnen(sorte));

  const rumpf = document.createElement('div');
  rumpf.className = 'sorte-rumpf';

  const name = document.createElement('h4');
  name.className = 'sorte-name headline-sm';
  name.textContent = sorte.name;

  const herkunft = document.createElement('p');
  herkunft.className = 'sorte-herkunft label-caps';
  herkunft.textContent = sorte.herkunft;

  const zahlen = document.createElement('dl');
  zahlen.className = 'sorte-zahlen';
  for (const [begriff, wert] of [
    ['Stammwürze', sorte.stammwuerze],
    ['Alkohol', sorte.alkohol],
    ['Bittere', sorte.bittere],
  ] as const) {
    const zelle = document.createElement('div');
    const dt = document.createElement('dt');
    dt.className = 'label-caps';
    dt.textContent = begriff;
    const dd = document.createElement('dd');
    dd.className = 'mono-data';
    dd.textContent = wert;
    zelle.append(dt, dd);
    zahlen.append(zelle);
  }

  const charakter = document.createElement('p');
  charakter.className = 'body-md';
  charakter.textContent = sorte.charakter;

  const unterschied = document.createElement('p');
  unterschied.className = 'sorte-unterschied body-md';
  unterschied.textContent = sorte.unterschied;

  const beispiel = document.createElement('p');
  beispiel.className = 'sorte-beispiel mono-data';
  beispiel.textContent = `Bekannt: ${sorte.beispiel}`;

  rumpf.append(name, herkunft, zahlen, charakter, unterschied, beispiel);
  karte.append(bild, rumpf);
  return karte;
}

function familienwahlBauen(): void {
  const wahlen: ReadonlyArray<{ wert: Familie | 'alle'; name: string }> = [
    { wert: 'alle', name: `Alle · ${SORTEN.length}` },
    ...FAMILIEN.map((f) => ({
      wert: f.name,
      name: `${f.name} · ${SORTEN.filter((s) => s.familie === f.name).length}`,
    })),
  ];

  for (const wahl of wahlen) {
    const taste = document.createElement('button');
    taste.type = 'button';
    taste.className = 'familientaste label-caps';
    taste.textContent = wahl.name;
    taste.setAttribute('aria-pressed', String(familienfilter === wahl.wert));
    taste.addEventListener('click', () => {
      familienfilter = wahl.wert;
      for (const andere of familienwahl.querySelectorAll('button')) {
        andere.setAttribute('aria-pressed', String(andere === taste));
      }
      glossarZeichnen();
    });
    familienwahl.append(taste);
  }
}

familienwahlBauen();
glossarZeichnen();
