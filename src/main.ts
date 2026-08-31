import './style.css';
import { bildAufbereiten, BildFehler, type AufbereitetesBild } from './bild';
import { erweitertLesen, etikettLesen, EtikettFehler, type Auswertung } from './etikett';
import { braumeister } from './braumeister';
import type { Bereich, Erweitert, Etikett, Etikettelement, Vermutung } from './schema';
import { FAMILIEN, SORTEN, type Biersorte, type Familie } from './glossar';
import { glasZeichnen } from './glas';
import { schluesselVergessen } from './schluessel';
import { kameraMoeglich, kameraOeffnen } from './kamera';
import { ausEreignis, ausZwischenablage, ZwischenablageFehler } from './zwischenablage';

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

/* ------------------------------------------------------------------ Zustand */

let aktuellesBild: AufbereitetesBild | null = null;
let laeuft = false;
/** Zählt die Auswertungen mit, damit eine späte Antwort nicht in einen
 *  inzwischen ersetzten Befund schreibt. */
let laufNummer = 0;

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

// Erst die Kamera in der Seite mit ihrem Rahmen versuchen; ohne sie der
// gewohnte Weg über die Kamera des Geräts. Eine Kamera, die sich nicht
// öffnen lässt — abgelehnte Berechtigung, älterer Browser, Schreibtisch
// ohne Webcam —, darf nicht bedeuten, dass gar kein Foto mehr geht.
fotoTaste.addEventListener('click', () => {
  void (async () => {
    if (kameraMoeglich()) {
      const aufnahme = await kameraOeffnen();

      if (aufnahme !== null) {
        await bildAnnehmen(aufnahme);
        return;
      }
    }

    kameraFeld.click();
  })();
});

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

el<HTMLButtonElement>('einfuegen').addEventListener('click', async () => {
  try {
    await bildAnnehmen(await ausZwischenablage());
  } catch (fehler) {
    zeigeFehler(
      fehler instanceof ZwischenablageFehler
        ? fehler.message
        : 'Aus der Zwischenablage ließ sich kein Bild lesen.',
    );
  }
});

document.addEventListener('paste', (e) => {
  void (async () => {
    const datei = await ausEreignis(e);
    if (datei) {
      e.preventDefault();
      await bildAnnehmen(datei);
      return;
    }
    // Nur melden, wenn tatsächlich etwas in der Zwischenablage lag — ein
    // leeres Strg+V soll nicht in einer Fehlermeldung enden.
    if (e.clipboardData?.types.length) {
      zeigeFehler(
        'In der Zwischenablage liegt kein Bild.',
        'Kopiere das Bild selbst, nicht nur den Link darauf. Aus einer Webseite ' +
          'gelingt das meist mit Rechtsklick auf das Bild und „Bild kopieren".',
      );
    }
  })();
});

/* ----------------------------------------------------------- Auswerten */

lesenTaste.addEventListener('click', () => {
  if (!aktuellesBild) return;
  void auswerten(aktuellesBild, 0);
});

/**
 * Ein Auswertelauf.
 *
 * Eigene Funktion und nicht mehr der Rumpf des Klickhandlers, weil es
 * inzwischen einen zweiten Anlass gibt, sie zu starten: Bejaht der Leser
 * eine Rückfrage, läuft dieselbe Auswertung noch einmal — nur diesmal mit
 * der Kennung des bestätigten Biers, und dann endet sie als Treffer statt
 * als Frage.
 */
async function auswerten(bild: AufbereitetesBild, bestaetigtId: number): Promise<void> {
  if (laeuft) return;

  laeuft = true;
  lesenTaste.disabled = true;
  lesenTaste.textContent = 'Wird gelesen …';
  const warten = wartenZeigen();
  const erzaehler = braumeister();

  const lauf = ++laufNummer;

  try {
    const lesung = await etikettLesen(bild, (ereignis) => {
      // Ein überholter Lauf darf die Zeile nicht mehr anfassen: Wer während
      // einer Auswertung ein neues Foto einwirft, bekäme sonst die
      // Zwischenstände der alten zu lesen.
      if (lauf !== laufNummer) return;

      const ansage = erzaehler(ereignis);
      if (ansage.fund !== undefined) warten.fund(ansage.fund);
      if (ansage.zeile !== undefined) warten.satz(ansage.zeile);
    }, bestaetigtId);
    if (lauf !== laufNummer) return;

    // Der Server ist sich nicht sicher. Hier endet der Lauf mit einer Frage
    // statt mit einem Befund — und ohne dass ein bezahlter Aufruf fällig
    // geworden wäre.
    if (lesung.art === 'vermutung') {
      vermutungZeigen(lesung.vermutung, bild);
      return;
    }

    const auswertung = lesung.auswertung;

    // Erst jetzt die erweiterte Sicht anstoßen, nicht schon vorhin daneben.
    //
    // Das war einmal anders: Beide Aufrufe zugleich zu starten hieß, der
    // Leser wartet einmal statt zweimal. Nur bringt das nichts, wenn am
    // anderen Ende ohnehin nur eine Auswertung zur Zeit läuft — gemessen auf
    // dem Rechner mit dem Modell brauchen zwei parallele Aufrufe exakt
    // doppelt so lang wie einer. Nebeneinander gestartet warten sie bloß
    // aufeinander.
    //
    // Nacheinander ist sogar schneller: Der Server weiß dann schon aus dem
    // ersten Aufruf, welches Bier auf dem Foto ist, und spart sich einen
    // ganzen Modellaufruf. Er erkennt es an der Prüfsumme des Bildes wieder.
    const erweitertVersprechen = erweitertLesen(bild).then((a) => a.daten);
    // Fängt die Ablehnung ab, damit sie nicht als unbehandelt gemeldet wird:
    // Ausgewertet wird sie erst in den Reitern, und dorthin sieht womöglich
    // niemand.
    erweitertVersprechen.catch(() => undefined);

    befundZeichnen(auswertung, erweitertVersprechen);
  } catch (fehler) {
    if (lauf !== laufNummer) return;
    // Nur die eigenen Fehler tragen einen Text, der für den Leser gedacht
    // ist. Ein durchgereichter Browser-Fehler tut das nicht: Er stand hier
    // als blosses "Load failed" — englisch, ohne Rat, ohne Zusammenhang.
    // Deshalb wird geprüft und nicht blind gecastet.
    if (fehler instanceof EtikettFehler) {
      zeigeFehler(fehler.message, fehler.rat);
    } else {
      zeigeFehler(
        'Die Auswertung ist unterwegs abgebrochen.',
        'Meist genügt ein zweiter Versuch. Bleibt es dabei, steht in der ' +
          'Entwicklerkonsole des Browsers die genaue Ursache.',
      );
    }
  } finally {
    laeuft = false;
    lesenTaste.disabled = false;
    lesenTaste.textContent = 'Etikett auswerten';
  }
}

/**
 * Die Rückfrage: "Kennen wir das schon?"
 *
 * Der ehrlichste der drei Ausgänge. Der Server hat drei Signale befragt —
 * Farbe, Name, Bildvergleich — und keines reichte allein. Statt zu raten
 * (dann stünde womöglich ein fremdes Bier da, und niemand merkte es) oder
 * blind zu zahlen (dann entstünde ein zweiter Eintrag für dasselbe Bier),
 * wird gefragt.
 *
 * Mit dem Referenzfoto daneben, und das ist der Kern: Der Leser soll
 * vergleichen können statt glauben zu müssen. Zwei Etiketten nebeneinander
 * entscheidet ein Mensch in einer Sekunde sicher — sicherer als jede
 * Rechnung, die hier möglich wäre.
 */
function vermutungZeigen(vermutung: Vermutung, bild: AufbereitetesBild): void {
  abschnittBefund.hidden = false;
  befundZiel.replaceChildren();

  const karte = document.createElement('section');
  karte.className = 'vermutung';

  const titel = document.createElement('h3');
  titel.className = 'vermutung-titel headline-sm';
  titel.textContent = 'Kennen wir das schon?';
  karte.append(titel);

  const reihe = document.createElement('div');
  reihe.className = 'vermutung-reihe';

  if (vermutung.bild !== '') {
    const figur = document.createElement('figure');
    figur.className = 'vermutung-bild';
    const foto = document.createElement('img');
    foto.src = vermutung.bild;
    foto.alt = `Gespeichertes Foto von „${vermutung.name}"`;
    foto.loading = 'lazy';
    figur.append(foto);
    const zettel = document.createElement('figcaption');
    zettel.className = 'label-caps';
    zettel.textContent = 'Gespeichert';
    figur.append(zettel);
    reihe.append(figur);
  }

  const text = document.createElement('div');
  text.className = 'vermutung-text';

  const frage = document.createElement('p');
  frage.className = 'vermutung-frage body-lg';
  // In Stücken zusammengesetzt statt als eine Zeichenkette: Der Name ist
  // Inhalt aus der Datenbank und gehört als Text eingesetzt, nicht als
  // Markup zusammengeklebt.
  frage.append(document.createTextNode('Ist das das '));
  const stark = document.createElement('strong');
  stark.textContent = `„${vermutung.name}"`;
  frage.append(stark);
  if (vermutung.brauerei !== '') {
    frage.append(document.createTextNode(` von ${vermutung.brauerei}`));
  }
  frage.append(document.createTextNode('?'));
  text.append(frage);

  const mass = document.createElement('p');
  mass.className = 'vermutung-mass mono-data';
  mass.textContent = `Übereinstimmung ${Math.round(vermutung.wahrscheinlichkeit * 100)} %`;

  for (const farbe of vermutung.leitfarben) {
    const tupfen = document.createElement('span');
    tupfen.className = 'vermutung-farbe';
    tupfen.style.backgroundColor = farbe;
    mass.append(tupfen);
  }

  text.append(mass);
  reihe.append(text);
  karte.append(reihe);

  const tasten = document.createElement('div');
  tasten.className = 'tastenreihe';

  const ja = document.createElement('button');
  ja.type = 'button';
  ja.className = 'taste taste-primaer';
  ja.textContent = 'Ja, das ist es';
  ja.addEventListener('click', () => void auswerten(bild, vermutung.id));

  // Die Ablehnung geht als -1 mit, nicht als Null: Null hiesse "nicht
  // gefragt worden", und dann käme dieselbe Frage sofort wieder.
  const nein = document.createElement('button');
  nein.type = 'button';
  nein.className = 'taste taste-sekundaer';
  nein.textContent = 'Nein, ein anderes';
  nein.addEventListener('click', () => void auswerten(bild, -1));

  tasten.append(ja, nein);
  karte.append(tasten);

  const hinweis = document.createElement('p');
  hinweis.className = 'vermutung-hinweis body-md';
  hinweis.textContent =
    'Bei „Nein" wird das Etikett neu ausgewertet — das dauert etwas länger.';
  karte.append(hinweis);

  befundZiel.append(karte);
}

/* ------------------------------------------------------------- Darstellung */

function abschnittOeffnen(): HTMLDivElement {
  abschnittBefund.hidden = false;
  befundZiel.replaceChildren();
  return befundZiel;
}

/**
 * Zeigt das Warten an — und gibt zurück, womit sich die Zeile ändern lässt.
 *
 * Der Rückgabewert ist der ganze Unterschied zu vorher: Die Zeile stand
 * früher fest, weil niemand wusste, was der Server gerade tut. Seit er es
 * zeilenweise mitteilt, kann hier stehen, was tatsächlich geschieht.
 */
interface Wartestand {
  /** Die wechselnde Zeile: was gerade geschieht. */
  satz(text: string): void;
  /** Der bleibende Fund: welches Bier erkannt wurde. */
  fund(was: string): void;
}

function wartenZeigen(): Wartestand {
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

  // Damit auch ein Vorleseprogramm mitbekommt, dass sich hier etwas tut —
  // "polite", weil es den Leser nicht unterbrechen soll: Die Zeile ist
  // Begleitung, nicht Meldung.
  text.setAttribute('aria-live', 'polite');

  block.append(mal, text);
  ziel.append(block);
  abschnittBefund.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Der Fund bekommt eine eigene Zeile ÜBER der wechselnden — und sie
  // entsteht erst, wenn es etwas zu melden gibt. Ein leerer Platzhalter
  // liesse den Block von Anfang an höher wirken und beim Auftauchen des
  // Namens nichts geschehen.
  let fundZeile: HTMLParagraphElement | null = null;

  return {
    satz(text_: string): void {
      text.textContent = text_;
    },

    fund(was: string): void {
      if (fundZeile === null) {
        fundZeile = document.createElement('p');
        fundZeile.className = 'title-sm';
        fundZeile.style.margin = '0 0 0.25rem';
        fundZeile.setAttribute('aria-live', 'polite');
        text.before(fundZeile);
      }

      fundZeile.textContent = was;
    },
  };
}

function zeigeFehler(titel: string, rat?: string): void {
  abschnittOeffnen().append(fehlerblock(titel, rat));
}

/** Baut den Befund auf. Durchgehend textContent — kein HTML aus der Modellantwort. */
function befundZeichnen(auswertung: Auswertung<Etikett>, erweitert: Promise<Erweitert>): void {
  const e = auswertung.daten;
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

  blatt.append(abzeichen);

  // Woher die Auskunft stammt, gehört dazu: Eine Zerlegung aus einer
  // früheren Auswertung beschreibt dasselbe Bier, aber nicht dieses Foto.
  // Hat sich das Etikett seither geändert, steht hier der ältere Stand —
  // und der Leser soll das wissen, statt es zu erraten.
  if (auswertung.quelle === 'speicher') {
    const gedaechtnis = document.createElement('span');
    gedaechtnis.className = 'abzeichen abzeichen-speicher label-caps';
    gedaechtnis.title =
      'Dieses Bier wurde schon einmal ausgewertet. Die Zerlegung kommt aus der ' +
      'Datenbank, nur die Markierungen auf der Flasche sind für dieses Foto neu bestimmt.';
    gedaechtnis.textContent = 'Aus dem Gedächtnis';
    blatt.append(gedaechtnis);
  }

  blatt.append(kopf);

  blatt.append(
    tafelBauen([
      ['Gegründet', e.gegruendet],
      ['Stil', e.stil],
      ['Stammwürze', e.stammwuerze],
      ['Alkohol', e.alkohol],
    ]),
  );

  blatt.append(reiterBauen(e, erweitert, laufNummer));

  if (auswertung.bilder.length > 0) {
    blatt.append(galerieBauen(auswertung.bilder, e.name));
  }

  if (e.hinweis.trim()) {
    const hinweis = document.createElement('p');
    hinweis.className = 'chronik-hinweis body-md';
    hinweis.textContent = `Unsicher: ${e.hinweis}`;
    blatt.append(hinweis);
  }

  ziel.append(blatt);
}

/**
 * Die Fotos, die schon einmal von diesem Bier gemacht wurden.
 *
 * Nur was der Server mitschickt — er bewahrt Scanfotos nur auf, wenn er
 * ausdrücklich dazu eingerichtet ist. Kommt nichts, entsteht hier auch
 * keine leere Überschrift.
 */
function galerieBauen(bilder: readonly string[], bier: string): HTMLElement {
  const huelle = document.createElement('section');
  huelle.className = 'galerie';

  const titel = document.createElement('h4');
  titel.className = 'galerie-titel label-caps';
  titel.textContent =
    bilder.length === 1 ? 'Schon einmal fotografiert' : `Schon ${bilder.length} Mal fotografiert`;

  const reihe = document.createElement('div');
  reihe.className = 'galerie-reihe';

  for (const adresse of bilder) {
    const bildchen = document.createElement('img');
    bildchen.className = 'galerie-bild';
    bildchen.src = adresse;
    // Der Name des Biers und nicht "Foto": Ein Vorleseprogramm soll sagen,
    // wovon das Bild ist, nicht dass es eines ist.
    bildchen.alt = `Aufnahme von ${bier}`;
    // Die Galerie steht weit unten im Blatt; sie zu laden, bevor jemand
    // dorthin scrollt, verzögert nur das, was oben steht.
    bildchen.loading = 'lazy';
    bildchen.decoding = 'async';
    // Ein Foto, das nicht mehr da ist, soll keine kaputte Ecke hinterlassen.
    bildchen.addEventListener('error', () => bildchen.remove());
    reihe.append(bildchen);
  }

  huelle.append(titel, reihe);

  return huelle;
}

/* --------------------------------------------------------------- Reiter */

/**
 * Reiter nach ARIA-Muster: eine tablist mit tabs, dazu je ein tabpanel.
 * Pfeiltasten wandern zwischen den Reitern, Pos1/Ende springen an die Enden —
 * so, wie es von einem Reitersatz erwartet wird.
 */
function reiterBauen(e: Etikett, erweitert: Promise<Erweitert>, lauf: number): HTMLElement {
  const huelle = document.createElement('div');
  huelle.className = 'reiter';

  const leiste = document.createElement('div');
  leiste.className = 'reiterleiste';
  leiste.setAttribute('role', 'tablist');
  leiste.setAttribute('aria-label', 'Sicht auf das Bier');

  // Der Etikett-Reiter steht schon; die vier übrigen warten auf den zweiten
  // Aufruf und tragen bis dahin einen Ladehinweis.
  const namen = ['Etikett', 'Brauart', 'Speisen', 'Verkostung', 'Verwandte'] as const;
  const bauer: Array<(d: Erweitert) => HTMLElement> = [
    brauartReiter,
    speisenReiter,
    verkostungReiter,
    verwandteReiter,
  ];

  const tasten: HTMLButtonElement[] = [];
  const felder: HTMLElement[] = [];

  namen.forEach((name, i) => {
    const taste = document.createElement('button');
    taste.type = 'button';
    taste.className = 'reitertaste label-caps';
    taste.id = `reiter-${i}`;
    taste.textContent = name;
    taste.setAttribute('role', 'tab');
    taste.setAttribute('aria-controls', `feld-${i}`);

    const feld = document.createElement('section');
    feld.className = 'reiterfeld';
    feld.id = `feld-${i}`;
    feld.setAttribute('role', 'tabpanel');
    feld.setAttribute('aria-labelledby', `reiter-${i}`);
    feld.setAttribute('tabindex', '0');
    feld.append(i === 0 ? etikettReiter(e) : ladehinweis());

    taste.addEventListener('click', () => waehlen(i));
    tasten.push(taste);
    felder.push(feld);
    leiste.append(taste);
  });

  erweitert
    .then((daten) => {
      if (lauf !== laufNummer) return;
      bauer.forEach((bauen, i) => felder[i + 1]!.replaceChildren(bauen(daten)));
    })
    .catch((fehler: EtikettFehler) => {
      if (lauf !== laufNummer) return;
      for (let i = 1; i < felder.length; i++) {
        felder[i]!.replaceChildren(
          fehlerblock(
            fehler.message ?? 'Die erweiterte Sicht konnte nicht geladen werden.',
            fehler.rat,
          ),
        );
      }
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

function ladehinweis(): HTMLElement {
  const block = document.createElement('div');
  block.className = 'warten';

  const mal = document.createElement('span');
  mal.className = 'warten-mal';
  mal.setAttribute('aria-hidden', 'true');

  const text = document.createElement('p');
  text.className = 'body-md';
  text.style.margin = '0';
  text.textContent = 'Wird noch geladen …';

  block.append(mal, text);
  return block;
}

function fehlerblock(titel: string, rat?: string): HTMLElement {
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
  return block;
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

function brauartReiter(e: Erweitert): HTMLElement {
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

function speisenReiter(e: Erweitert): HTMLElement {
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

function verkostungReiter(e: Erweitert): HTMLElement {
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

function verwandteReiter(e: Erweitert): HTMLElement {
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
    li.append(
      text,
      bildMitMarkierung(bildUrl, element.bereich, element.bezeichnung, element.bild),
    );
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
function bildMitMarkierung(
  bildUrl: string,
  bereich: Bereich,
  name: string,
  ersatzbild = '',
): HTMLElement {
  const figur = document.createElement('figure');
  figur.className = 'element-bild';

  const k = kastenPruefen(bereich);

  // Kein brauchbarer Bereich auf DIESEM Foto — das Element war verdeckt,
  // angeschnitten oder abgewandt. Gibt es dazu eine gespeicherte
  // Einzeichnung, ist sie hier mehr wert als das eigene Foto ohne
  // Markierung: Sie zeigt wenigstens, wovon die Rede ist.
  if (k === null && ersatzbild !== '') {
    const bild = document.createElement('img');
    bild.src = ersatzbild;
    bild.alt = `„${name}" auf einer früheren Aufnahme dieses Biers`;
    bild.loading = 'lazy';
    bild.decoding = 'async';
    figur.append(bild);

    const zettel = document.createElement('figcaption');
    zettel.className = 'element-ersatz label-caps';
    // Ehrlich benennen, was da zu sehen ist. Ohne diesen Satz hielte der
    // Leser eine fremde Flasche für seine eigene.
    zettel.textContent = 'Frühere Aufnahme';
    figur.append(zettel);

    return figur;
  }

  const bild = document.createElement('img');
  bild.src = bildUrl;
  bild.alt = `Fundstelle von „${name}" auf dem Etikett`;
  bild.loading = 'lazy';
  figur.append(bild);

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

/* ==========================================================================
   Sichten — Etikett lesen und Bierglossar
   ==========================================================================
   Zwei Sichten auf einer Seite statt zweier Dokumente: es gibt keinen Server,
   der eine zweite Adresse ausliefern könnte. Der Hash hält die Sicht dennoch
   verlinkbar und lässt den Zurück-Knopf funktionieren.
   ========================================================================== */

const SICHTEN = {
  lesen: {
    titel: 'Das Etikett lesen',
    devise: 'Fotografier das Etikett — und erfahre, was jedes einzelne Element darauf bedeutet.',
  },
  glossar: {
    titel: 'Bierglossar',
    devise: 'Die Sorten und worin sie sich unterscheiden — von Pils bis Lambic.',
  },
} as const;

type SichtName = keyof typeof SICHTEN;

const bannerTitel = el<HTMLHeadingElement>('banner-titel');
const bannerDevise = el<HTMLParagraphElement>('banner-devise');

function istSicht(wert: string): wert is SichtName {
  return wert in SICHTEN;
}

function sichtZeigen(name: SichtName, springen = false): void {
  for (const knoten of document.querySelectorAll<HTMLElement>('.sicht')) {
    knoten.hidden = knoten.id !== `sicht-${name}`;
  }
  for (const punkt of document.querySelectorAll<HTMLAnchorElement>('.menuepunkt')) {
    const aktiv = punkt.dataset['sicht'] === name;
    punkt.classList.toggle('aktiv', aktiv);
    // aria-current sagt Screenreadern, welche Sicht gerade offen ist.
    if (aktiv) punkt.setAttribute('aria-current', 'page');
    else punkt.removeAttribute('aria-current');
  }

  bannerTitel.textContent = SICHTEN[name].titel;
  bannerDevise.textContent = SICHTEN[name].devise;
  document.title = name === 'lesen' ? 'Bier Expert' : `${SICHTEN[name].titel} · Bier Expert`;

  if (springen) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function ausHash(): SichtName {
  const wert = window.location.hash.replace('#', '');
  return istSicht(wert) ? wert : 'lesen';
}

window.addEventListener('hashchange', () => sichtZeigen(ausHash(), true));
sichtZeigen(ausHash());

schluesselVergessen();
