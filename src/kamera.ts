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

    tasten.append(ausloeser, abbrechen);
    buehne.append(video, rahmen, anleitung, tasten);
    document.body.append(buehne);

    /** Räumt Kamera und Bühne ab — jeder Ausgang führt hier durch. */
    const schliessen = (ergebnis: File | null): void => {
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
function ausschnittNehmen(video: HTMLVideoElement): File | null {
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
  const links = Math.round((vb - breite) / 2);
  const oben = Math.round((vh - hoehe) / 2);

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
