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
 * Ab wann es scharf genug ist (mittlere Kantenstärke, 0 bis 1).
 *
 * Verwackelt ist die häufigste Ursache für ein unbrauchbares Etikettfoto,
 * und die einzige, die der Leser sofort beheben kann — er muss nur wissen,
 * dass es daran liegt.
 */
const SCHARF_MIN = 0.018;

/** Wie viel des Rahmens die Flasche füllen soll. */
const FUELLUNG_MIN = 0.28;
const FUELLUNG_MAX = 0.92;

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

  // Kantenstärke als Mass für Schärfe: Ein verwackeltes Bild hat weiche
  // Übergänge, ein scharfes harte. Der Vergleich mit dem rechten und dem
  // unteren Nachbarn genügt dafür.
  let kanten = 0;
  let zaehler = 0;

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const p = y * width + x;
      kanten += Math.abs(grau[p]! - grau[p + 1]!) + Math.abs(grau[p]! - grau[p + width]!);
      zaehler += 2;
    }
  }

  const schaerfe = zaehler > 0 ? kanten / zaehler : 0;

  // Wie viel des Rahmens die Flasche einnimmt.
  //
  // Der Hintergrund wird nicht gesucht, sondern am Rand abgelesen: Die
  // äussersten Spalten zeigen fast immer Tisch oder Wand. Alles, was sich
  // davon deutlich unterscheidet, gilt als Flasche. Das ist grob und für
  // diese Frage genau richtig — gebraucht wird "ungefähr wie viel", nicht
  // eine Freistellung.
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

  let anders = 0;

  for (const y of grau) {
    if (Math.abs(y - hintergrund) > 0.14) anders += 1;
  }

  const fuellung = anders / grau.length;

  if (fuellung < FUELLUNG_MIN) {
    return { gut: false, satz: 'Näher heran — die Flasche soll den Rahmen füllen.', dunkel: false };
  }

  if (fuellung > FUELLUNG_MAX) {
    return { gut: false, satz: 'Etwas weiter weg — die Flasche ganz in den Rahmen.', dunkel: false };
  }

  // Die Schärfe zuletzt, und das ist kein Geschmack, sondern eine Messung:
  // Ein fast leerer Rahmen hat von sich aus kaum Kanten. Gemessen am 31.08.
  // ergab eine gestochen scharfe, aber zu kleine Flasche 0,010 — weniger
  // als jede verwackelte Aufnahme, die den Rahmen füllt. Stünde die
  // Schärfeprüfung vorn, hiesse es "noch unscharf", wo "näher heran" die
  // richtige Anweisung ist. Erst wenn genug im Bild ist, lässt sich über
  // seine Schärfe überhaupt etwas sagen.
  if (schaerfe < SCHARF_MIN) {
    return { gut: false, satz: 'Noch unscharf — einen Moment stillhalten.', dunkel: false };
  }

  return { gut: true, satz: 'Gut so — jetzt aufnehmen.', dunkel: false };
}
