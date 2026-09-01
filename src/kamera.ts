/**
 * Die Kamera in der Seite — mit einem Rahmen, in den die Flasche gehört.
 *
 * Warum nicht die Kamera des Geräts: Ein `<input capture>` öffnet auf dem
 * Handy die native Kameraansicht, und in die lässt sich nichts einblenden.
 * Ein Rahmen als Anhalt braucht ein Videobild in der Seite selbst.
 *
 * Warum überhaupt ein Rahmen — der Grund ist nicht Ordnungsliebe, sondern
 * Auflösung. Am 31.08. an zwei echten Aufnahmen derselben Sol-Flasche
 * gemessen: Die Bildregistrierung ordnete sie mit 0,991 Vertrauen einander
 * zu, tadellos. Trotzdem sassen die Markierungen daneben — nicht wegen der
 * Zuordnung, sondern weil schon die gespeicherten Rahmen ungenau waren. Und
 * die sind es, weil das Etikett in einem hochkant fotografierten
 * Flaschenbild nur etwa ein Drittel der Höhe einnimmt. Ein Modell soll darin
 * Kästen auf ein Prozent genau setzen; das ist zu viel verlangt.
 *
 * Füllt die Flasche dagegen einen festen Rahmen, wird das Etikett im
 * zugeschnittenen Bild rund dreimal so gross. Derselbe relative Fehler des
 * Modells ist dann absolut ein Drittel so gross. Der Rahmen verbessert also
 * nicht die Zuordnung — die war nie das Problem —, sondern das, was
 * zugeordnet wird.
 *
 * Zugeschnitten wird auf genau den Rahmen, den der Leser gesehen hat. Was er
 * hineinstellt, ist das Bild; alles daneben war ohnehin Tisch und Wand.
 */

/** Seitenverhältnis des Rahmens (Breite zu Höhe) — eine stehende Flasche. */
const RAHMEN_VERHAELTNIS = 1 / 2.4;

/** Anteil der Videohöhe, den der Rahmen einnimmt. */
const RAHMEN_ANTEIL = 0.74;

/**
 * Ab wann das Bild als hell genug gilt (mittlere Helligkeit, 0 bis 1).
 *
 * Bewusst niedrig: Ein Etikett ist bedruckt und braucht kein Tageslicht.
 * Unterhalb davon rauscht die Aufnahme aber so stark, dass die
 * Merkmalspunkte der Registrierung darin untergehen — und dann wird das
 * Bier beim nächsten Mal nicht wiedererkannt.
 */
const HELL_MIN = 0.26;

/**
 * Ab wann es scharf genug ist — gemessen an der Steilheit des Umrisses.
 *
 * Nicht an der mittleren Kantenstärke im Bild, und das ist eine Korrektur:
 * Eine einfarbige Dose hat kaum Textur und lag mit 0,0117 unter jeder
 * brauchbaren Schwelle, obwohl sie gestochen scharf war. Schlimmer noch,
 * der Wert blieb bei zunehmender Unschärfe exakt gleich — er mass gar nicht
 * die Schärfe, sondern wie gemustert der Gegenstand ist.
 *
 * Der Übergang vom Gegenstand zum Hintergrund dagegen ist bei jedem Körper
 * vorhanden und wird durch Verwacklung zuverlässig weicher. Gemessen am
 * 01.09. an beiden Formen, scharf bis stark verwackelt:
 *
 *   Flasche  0,389 → 0,307 → 0,203 → 0,126
 *   Dose     0,465 → 0,389 → 0,274 → 0,184
 *
 * Die Schwelle lässt leichte Unschärfe durch — ein Etikett bleibt dabei
 * lesbar — und weist ab, was darunter liegt.
 */
const UMRISS_MIN = 0.26;

/**
 * Wie voll das umschliessende Rechteck des Gegenstands sein muss.
 *
 * Eine Flasche kommt nur auf 0,417, weil ihr schmaler Hals das Rechteck
 * oben leer lässt; eine Dose auf 0,998. Ein unaufgeräumter Tisch liegt bei
 * 0,248. Die Schwelle trennt den Körper vom Durcheinander und muss deshalb
 * unter dem Flaschenwert liegen — 0,5 wies am 01.09. jede Flasche ab.
 */
const DICHTE_MIN = 0.33;


/** Wie das Bild im Rahmen gerade dasteht. */
interface Befinden {
  gut: boolean;
  satz: string;
  /** Ist es so dunkel, dass Licht helfen würde? */
  dunkel: boolean;
}

/** Kann dieses Gerät überhaupt eine Kamera in der Seite zeigen? */
export function kameraMoeglich(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices !== undefined &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * Öffnet die Kamera und gibt das zugeschnittene Bild zurück.
 *
 * null heisst: abgebrochen, abgelehnt oder keine Kamera vorhanden. Der
 * Aufrufer fällt dann auf den gewohnten Weg über die Dateiauswahl zurück —
 * eine Kamera, die sich nicht öffnen lässt, darf nicht bedeuten, dass gar
 * kein Foto mehr geht.
 */
export async function kameraOeffnen(): Promise<File | null> {
  if (!kameraMoeglich()) return null;

  let strom: MediaStream;

  try {
    strom = await navigator.mediaDevices.getUserMedia({
      // Die rückwärtige Kamera, und lieber hoch aufgelöst: Was hier an
      // Bildpunkten fehlt, fehlt nachher im Etikett.
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch {
    return null;
  }

  return new Promise<File | null>((fertig) => {
    const buehne = document.createElement('div');
    buehne.className = 'kamera';
    buehne.setAttribute('role', 'dialog');
    buehne.setAttribute('aria-modal', 'true');
    buehne.setAttribute('aria-label', 'Foto aufnehmen');

    const video = document.createElement('video');
    video.className = 'kamera-bild';
    video.playsInline = true;
    video.muted = true;
    video.srcObject = strom;

    const rahmen = document.createElement('div');
    rahmen.className = 'kamera-rahmen';
    rahmen.style.aspectRatio = String(RAHMEN_VERHAELTNIS);
    rahmen.style.height = `${RAHMEN_ANTEIL * 100}%`;
    // Die Umrisslinie einer Flasche statt eines Kastens. Sie sagt ohne ein
    // Wort, wie herum und wie gross die Flasche stehen soll — und eine Dose
    // passt in denselben Umriss, sie füllt nur den Hals nicht aus.
    rahmen.innerHTML =
      '<svg class="kamera-umriss" viewBox="0 0 100 240" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M40 4 L40 52 C40 68 14 78 14 104 L14 226 Q14 236 24 236 ' +
      'L76 236 Q86 236 86 226 L86 104 C86 78 60 68 60 52 L60 4 ' +
      'Q60 2 58 2 L42 2 Q40 2 40 4 Z" /></svg>';

    const anleitung = document.createElement('p');
    anleitung.className = 'kamera-anleitung body-md';
    anleitung.textContent = 'Die Flasche in den Rahmen stellen — das Etikett gut sichtbar.';

    const tasten = document.createElement('div');
    tasten.className = 'kamera-tasten';

    const ausloeser = document.createElement('button');
    ausloeser.type = 'button';
    ausloeser.className = 'taste taste-primaer';
    ausloeser.textContent = 'Aufnehmen';

    const abbrechen = document.createElement('button');
    abbrechen.type = 'button';
    abbrechen.className = 'taste taste-sekundaer';
    abbrechen.textContent = 'Abbrechen';

    // Die Taschenlampe — nur, wenn dieses Gerät sie über das Web wirklich
    // schalten kann. Auf dem iPhone kann es das nicht: WebKit gibt den
    // torch-Schalter nicht heraus. Eine Taste anzubieten, die dort nichts
    // tut, wäre schlimmer als keine — deshalb entscheidet die Fähigkeit der
    // Spur und nicht die Hoffnung.
    const spur = strom.getVideoTracks()[0];
    const kann = spur?.getCapabilities?.() as { torch?: boolean } | undefined;

    const licht = document.createElement('button');
    licht.type = 'button';
    licht.className = 'taste taste-sekundaer kamera-licht';
    licht.textContent = 'Licht an';
    licht.hidden = kann?.torch !== true;

    let leuchtet = false;

    licht.addEventListener('click', () => {
      void (async () => {
        leuchtet = !leuchtet;
        try {
          // torch steht nicht in den Typdefinitionen des DOM, weil es nicht
          // Teil des Standards ist — die Browser, die es können, kennen es
          // trotzdem. Deshalb hier vorbei an den Typen und dafür oben
          // gefragt, ob dieses Gerät es überhaupt anbietet.
          await spur?.applyConstraints({
            advanced: [{ torch: leuchtet }],
          } as unknown as MediaTrackConstraints);
          licht.textContent = leuchtet ? 'Licht aus' : 'Licht an';
        } catch {
          // Abgelehnt: Die Taste verschwindet, statt weiter etwas zu
          // versprechen, das dieses Gerät nicht hält.
          licht.hidden = true;
        }
      })();
    });

    tasten.append(ausloeser, licht, abbrechen);
    buehne.append(video, rahmen, anleitung, tasten);
    document.body.append(buehne);

    // Mehrmals je Sekunde nachsehen, was im Rahmen steht. 250 ms sind schnell
    // genug, dass der Hinweis der Bewegung folgt, und langsam genug, dass die
    // Sätze nicht flackern, während der Leser das Handy ausrichtet.
    const uhr = window.setInterval(() => {
      const bild = vorschauLesen(video);
      if (bild === null) return;

      const befinden = befindenPruefen(bild);

      anleitung.textContent = befinden.satz;
      rahmen.classList.toggle('gut', befinden.gut);
      buehne.classList.toggle('kamera-dunkel', befinden.dunkel);
    }, 250);

    /** Räumt Kamera und Bühne ab — jeder Ausgang führt hier durch. */
    const schliessen = (ergebnis: File | null): void => {
      window.clearInterval(uhr);
      for (const spur of strom.getTracks()) spur.stop();
      document.removeEventListener('keydown', beiTaste);
      buehne.remove();
      fertig(ergebnis);
    };

    function beiTaste(e: KeyboardEvent): void {
      if (e.key === 'Escape') schliessen(null);
    }

    document.addEventListener('keydown', beiTaste);
    abbrechen.addEventListener('click', () => schliessen(null));

    ausloeser.addEventListener('click', () => {
      const datei = ausschnittNehmen(video);
      // Misslingt der Schnitt, bleibt die Kamera offen: Ein stiller
      // Rücksprung ohne Bild sähe für den Leser aus wie ein verschluckter
      // Auslöser.
      if (datei !== null) schliessen(datei);
    });

    void video.play().catch(() => schliessen(null));
  });
}

/**
 * Schneidet aus dem laufenden Videobild genau den Rahmen heraus.
 *
 * Der Rahmen auf dem Schirm und der Schnitt im Bild müssen dasselbe
 * meinen. Das Video wird mit `object-fit: cover` gezeigt — es füllt die
 * Fläche und wird dabei angeschnitten. Diese Rechnung bildet denselben
 * Anschnitt nach; ohne sie läge der Schnitt daneben, und zwar genau um den
 * Betrag, den der Leser nie zu sehen bekam.
 */
function rahmenImVideo(
  video: HTMLVideoElement,
): { links: number; oben: number; breite: number; hoehe: number } | null {
  const vb = video.videoWidth;
  const vh = video.videoHeight;

  if (vb === 0 || vh === 0) return null;

  const flaeche = video.getBoundingClientRect();
  if (flaeche.width === 0 || flaeche.height === 0) return null;

  // Der Massstab, mit dem "cover" das Video auf die Fläche zieht.
  const massstab = Math.max(flaeche.width / vb, flaeche.height / vh);

  // Der Rahmen in Bildschirmpunkten, wie ihn das CSS aufspannt.
  const rahmenHoehe = flaeche.height * RAHMEN_ANTEIL;
  const rahmenBreite = rahmenHoehe * RAHMEN_VERHAELTNIS;

  // Und dasselbe Rechteck in Bildpunkten des Videos.
  const breite = Math.round(rahmenBreite / massstab);
  const hoehe = Math.round(rahmenHoehe / massstab);

  return {
    breite,
    hoehe,
    links: Math.round((vb - breite) / 2),
    oben: Math.round((vh - hoehe) / 2),
  };
}

/** Holt den Rahmeninhalt stark verkleinert — genug fürs Beurteilen. */
function vorschauLesen(video: HTMLVideoElement): ImageData | null {
  const r = rahmenImVideo(video);
  if (r === null) return null;

  const breite = 48;
  const hoehe = Math.max(1, Math.round(breite / RAHMEN_VERHAELTNIS));

  const leinwand = document.createElement('canvas');
  leinwand.width = breite;
  leinwand.height = hoehe;

  const stift = leinwand.getContext('2d', { willReadFrequently: true });
  if (stift === null) return null;

  stift.drawImage(video, r.links, r.oben, r.breite, r.hoehe, 0, 0, breite, hoehe);

  try {
    return stift.getImageData(0, 0, breite, hoehe);
  } catch {
    // Manche Browser sperren getImageData, wenn die Quelle als fremd gilt.
    // Dann eben ohne Beurteilung — aufnehmen lässt sich trotzdem.
    return null;
  }
}

function ausschnittNehmen(video: HTMLVideoElement): File | null {
  const r = rahmenImVideo(video);
  if (r === null) return null;

  const { links, oben, breite, hoehe } = r;

  const leinwand = document.createElement('canvas');
  leinwand.width = breite;
  leinwand.height = hoehe;

  const stift = leinwand.getContext('2d');
  if (stift === null) return null;

  stift.drawImage(video, links, oben, breite, hoehe, 0, 0, breite, hoehe);

  const daten = leinwand.toDataURL('image/jpeg', 0.9);
  const trenner = daten.indexOf(',');
  if (trenner < 0) return null;

  const roh = atob(daten.slice(trenner + 1));
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);

  return new File([bytes], 'aufnahme.jpg', { type: 'image/jpeg' });
}

/**
 * Beurteilt, was gerade im Rahmen steht.
 *
 * Drei Fragen, in der Reihenfolge, in der sie sich beheben lassen: Ist es
 * hell genug, ist es scharf, und füllt die Flasche den Rahmen? Genannt wird
 * immer nur die erste, die noch nicht stimmt — drei Anweisungen auf einmal
 * sind keine Anleitung, sondern eine Liste.
 *
 * Gerechnet wird auf einem stark verkleinerten Ausschnitt: Für Helligkeit,
 * Kantenstärke und Flächenanteil genügen ein paar tausend Bildpunkte, und
 * das muss mehrmals je Sekunde durchlaufen, ohne die Vorschau zu bremsen.
 */
function befindenPruefen(bild: ImageData): Befinden {
  const { data, width, height } = bild;
  const grau = new Float32Array(width * height);

  let summe = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Wahrgenommene Helligkeit, nicht der schlichte Mittelwert: Grün wiegt
    // fürs Auge weit schwerer als Blau.
    const y = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
    grau[p] = y;
    summe += y;
  }

  const helligkeit = summe / grau.length;

  if (helligkeit < HELL_MIN) {
    return { gut: false, satz: 'Zu dunkel — mehr Licht wäre besser.', dunkel: true };
  }

  // Steht da wirklich eine Flasche?
  //
  // Der Hintergrund wird nicht gesucht, sondern am Rand abgelesen: Die
  // äussersten Spalten zeigen fast immer Tisch oder Wand. Alles, was sich
  // davon deutlich unterscheidet, gilt als Gegenstand.
  const rand: number[] = [];
  const randBreite = Math.max(1, Math.round(width * 0.08));

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < randBreite; x += 1) {
      rand.push(grau[y * width + x]!);
      rand.push(grau[y * width + (width - 1 - x)]!);
    }
  }

  rand.sort((a, b) => a - b);
  const hintergrund = rand[Math.floor(rand.length / 2)] ?? 0;

  // Je Zeile: wie breit ist der Gegenstand, und wo steht er.
  const breiten = new Int32Array(height);
  const links = new Int32Array(height).fill(width);
  const rechts = new Int32Array(height).fill(-1);
  let punkte = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.abs(grau[y * width + x]! - hintergrund) <= 0.14) continue;
      breiten[y] = breiten[y]! + 1;
      punkte += 1;
      if (x < links[y]!) links[y] = x;
      if (x > rechts[y]!) rechts[y] = x;
    }
  }

  // Nur Zeilen mit etwas Substanz zählen — ein einzelner Punkt ist Rauschen.
  const belegt = (y: number): boolean => breiten[y]! >= Math.max(2, width * 0.06);

  let oben = -1;
  let unten = -1;

  for (let y = 0; y < height; y += 1) {
    if (!belegt(y)) continue;
    if (oben < 0) oben = y;
    unten = y;
  }

  if (oben < 0) {
    return { gut: false, satz: 'Nichts im Rahmen — die Flasche hineinstellen.', dunkel: false };
  }

  const hoeheAnteil = (unten - oben + 1) / height;

  if (hoeheAnteil < 0.55) {
    return { gut: false, satz: 'Näher heran — die Flasche soll den Rahmen füllen.', dunkel: false };
  }

  // Oben oder unten angeschnitten: Dann fehlt Hals oder Boden, und genau
  // das soll der Rahmen verhindern. Eine halbe Flasche ist als Referenzfoto
  // wertlos — die Registrierung braucht die ganze Gestalt.
  if (oben === 0 || unten === height - 1) {
    return {
      gut: false,
      satz: 'Etwas weiter weg — die ganze Flasche muss hineinpassen.',
      dunkel: false,
    };
  }

  let maxBreite = 0;
  let randBeruehrt = false;

  for (let y = oben; y <= unten; y += 1) {
    if (breiten[y]! > maxBreite) maxBreite = breiten[y]!;
    if (belegt(y) && (links[y] === 0 || rechts[y] === width - 1)) randBeruehrt = true;
  }

  if (randBeruehrt) {
    return {
      gut: false,
      satz: 'Etwas weiter weg — die ganze Flasche muss hineinpassen.',
      dunkel: false,
    };
  }

  // Die Gestalt: Eine Flasche ist oben schmal und unten breit, eine Dose
  // durchgehend gleich breit. Beides ist recht; was ausgeschlossen wird,
  // ist das Gegenteil — oben breiter als in der Mitte — und alles, was gar
  // keine zusammenhängende Säule ist.
  const mittel = (von: number, bis: number): number => {
    let summe = 0;
    let n = 0;
    for (let y = von; y <= bis; y += 1) {
      summe += breiten[y]!;
      n += 1;
    }
    return n > 0 ? summe / n : 0;
  };

  const gestalt = unten - oben;
  const kopf = mittel(oben, oben + Math.round(gestalt * 0.22));
  const bauch = mittel(oben + Math.round(gestalt * 0.45), oben + Math.round(gestalt * 0.85));

  if (bauch <= 0 || kopf / bauch > 1.15) {
    return { gut: false, satz: 'Keine Flasche zu erkennen — hochkant hineinstellen.', dunkel: false };
  }

  // Wie voll das umschliessende Rechteck ist. Eine Flasche oder Dose ist ein
  // geschlossener Körper; eine Hand, ein Stapel Deckel oder ein
  // unaufgeräumter Tisch sind es nicht und fallen hier durch.
  const dichte = punkte / (maxBreite * (unten - oben + 1));

  if (dichte < DICHTE_MIN) {
    return { gut: false, satz: 'Keine Flasche zu erkennen — hochkant hineinstellen.', dunkel: false };
  }

  // Die Schärfe zuletzt, und erst jetzt überhaupt möglich: Gemessen wird
  // die Steilheit des Übergangs am Umriss, und dafür muss der Umriss erst
  // bekannt sein. Je Zeile der steilste Sprung, davon der mittlere Wert —
  // der Median und nicht der Mittelwert, damit ein einzelner Glanzpunkt das
  // Urteil nicht trägt.
  const spruenge: number[] = [];

  for (let y = oben; y <= unten; y += 1) {
    if (breiten[y]! < 3) continue;

    let steilster = 0;

    for (let x = 0; x < width - 1; x += 1) {
      const sprung = Math.abs(grau[y * width + x]! - grau[y * width + x + 1]!);
      if (sprung > steilster) steilster = sprung;
    }

    spruenge.push(steilster);
  }

  spruenge.sort((a, b) => a - b);
  const umriss = spruenge[Math.floor(spruenge.length / 2)] ?? 0;

  if (umriss < UMRISS_MIN) {
    return { gut: false, satz: 'Noch unscharf — einen Moment stillhalten.', dunkel: false };
  }

  return { gut: true, satz: 'Gut so — jetzt aufnehmen.', dunkel: false };
}
