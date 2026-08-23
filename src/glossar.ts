/**
 * Bierglossar — statisches Nachschlagewerk der Sorten.
 *
 * Bewusst ohne API-Aufruf: das sind gesicherte Grundlagen, die sich nicht von
 * Foto zu Foto ändern. Die Zahlenangaben sind die üblichen Spannen der jeweiligen
 * Stilbeschreibung, keine Werte eines einzelnen Bieres.
 *
 * Zur Illustration: Fotos echter Markenbiere liegen nicht bei und wären
 * rechtlich heikel. Stattdessen wird jede Sorte im typischen Glas mit der
 * Farbe ihres EBC-Bereichs gezeichnet — Farbe, Schaum und Glasform sind
 * ohnehin die Merkmale, an denen man eine Sorte im Glas erkennt. Das bekannte
 * Beispielbier steht namentlich dabei.
 */

/** Glasformen, als Bauplan für die Zeichnung. */
export type Glasform = 'tulpe' | 'weizen' | 'stange' | 'humpen' | 'kelch' | 'pint' | 'schwenker';

export interface Biersorte {
  name: string;
  familie: Familie;
  herkunft: string;
  /** Farbe des Bieres, abgeleitet aus dem typischen EBC-Bereich. */
  farbe: string;
  /** Farbe der Schaumkrone — dunkle Biere tragen einen getönten Schaum. */
  schaum: string;
  /** Anteil der Glashöhe, den die Schaumkrone einnimmt. */
  schaumanteil: number;
  glas: Glasform;
  stammwuerze: string;
  alkohol: string;
  bittere: string;
  charakter: string;
  /** Der Kern des Glossars: wodurch sich die Sorte von ihren Nachbarn abhebt. */
  unterschied: string;
  beispiel: string;
}

export type Familie = 'untergärig' | 'obergärig' | 'spontan & sauer';

export const FAMILIEN: ReadonlyArray<{ name: Familie; erklaerung: string }> = [
  {
    name: 'untergärig',
    erklaerung:
      'Die Hefe arbeitet kühl bei 4 bis 9 °C und setzt sich am Boden ab. Sie bildet kaum ' +
      'Aromastoffe, weshalb Malz und Hopfen unverstellt durchkommen. Danach folgt eine lange, ' +
      'kalte Reifung — daher der Name Lagerbier.',
  },
  {
    name: 'obergärig',
    erklaerung:
      'Die Hefe arbeitet warm bei 15 bis 24 °C und steigt nach oben. Dabei entstehen Ester und ' +
      'Phenole — jene fruchtigen und würzigen Töne von Banane, Nelke oder Steinobst, die ' +
      'obergärige Biere kennzeichnen. Die Reifung ist meist kürzer.',
  },
  {
    name: 'spontan & sauer',
    erklaerung:
      'Statt zugesetzter Reinzuchthefe arbeiten Milchsäurebakterien mit, teils auch wilde Hefen ' +
      'aus der Luft. Das Ergebnis ist säuerlich bis herb — die älteste Art, Bier zu machen, und ' +
      'lange die einzige.',
  },
];

export const SORTEN: readonly Biersorte[] = [
  /* ---------------------------------------------------------- untergärig */
  {
    name: 'Pils',
    familie: 'untergärig',
    herkunft: 'Pilsen, Böhmen, 1842',
    farbe: '#e8b73a',
    schaum: '#fdfaf0',
    schaumanteil: 0.17,
    glas: 'tulpe',
    stammwuerze: '11–12,5 °P',
    alkohol: '4,4–5,2 % vol',
    bittere: '25–45 IBU',
    charakter:
      'Strohgelb bis goldfarben, sehr klar, mit fester weißer Krone. Schlank im Körper, trocken im ' +
      'Abgang, getragen von einer deutlichen Hopfenbittere und einem blumig-krautigen Hopfenduft.',
    unterschied:
      'Gegenüber dem Hellen ist das Pils merklich bitterer und trockener — der Hopfen führt, nicht das Malz. ' +
      'Gegenüber dem Export ist es schlanker und weniger malzsüß.',
    beispiel: 'Pilsner Urquell (Plzeň) · Jever · Rothaus Tannenzäpfle',
  },
  {
    name: 'Helles',
    familie: 'untergärig',
    herkunft: 'München, 1894',
    farbe: '#efc350',
    schaum: '#fdfaf0',
    schaumanteil: 0.14,
    glas: 'humpen',
    stammwuerze: '11–12,5 °P',
    alkohol: '4,7–5,4 % vol',
    bittere: '16–22 IBU',
    charakter:
      'Hellgolden, weich und rund. Der Ton ist malzig-brotig mit dezenter Süße; der Hopfen hält sich ' +
      'zurück und setzt nur einen Schlusspunkt. Gemacht zum Trinken in Mengen, nicht zum Analysieren.',
    unterschied:
      'Das Gegenstück zum Pils: gleiche Stammwürze, aber halb so viel Bittere. Wo das Pils schneidet, trägt das Helle.',
    beispiel: 'Augustiner Lagerbier Hell · Weihenstephaner Original',
  },
  {
    name: 'Export',
    familie: 'untergärig',
    herkunft: 'Dortmund, 19. Jahrhundert',
    farbe: '#e3ac2e',
    schaum: '#fdfaf0',
    schaumanteil: 0.15,
    glas: 'humpen',
    stammwuerze: '12–14 °P',
    alkohol: '5,0–6,0 % vol',
    bittere: '20–30 IBU',
    charakter:
      'Kräftiger als Helles und Pils, goldgelb, mit vollerem Malzkörper. Der Name stammt aus der Zeit, ' +
      'als stärker eingebraut wurde, damit das Bier den Transport überstand.',
    unterschied:
      'Liegt genau zwischen Hell und Pils: mehr Stammwürze als beide, mehr Bittere als das Helle, weniger als das Pils.',
    beispiel: 'DAB Original · Dortmunder Union',
  },
  {
    name: 'Märzen / Festbier',
    familie: 'untergärig',
    herkunft: 'Bayern, vor 1850',
    farbe: '#c8801f',
    schaum: '#fbf3e0',
    schaumanteil: 0.15,
    glas: 'humpen',
    stammwuerze: '13–14 °P',
    alkohol: '5,4–6,2 % vol',
    bittere: '18–25 IBU',
    charakter:
      'Bernsteinfarben bis kupfrig, mit deutlicher Malzsüße und Noten von Brotkruste und Karamell. ' +
      'Vollmundig, aber nicht schwer.',
    unterschied:
      'Dunkler und malziger als das Export, aber deutlich schlanker als ein Bock. Der Name kommt vom letzten ' +
      'Sudmonat vor dem sommerlichen Brauverbot.',
    beispiel: 'Ayinger Oktoberfest-Märzen · Paulaner Oktoberfestbier',
  },
  {
    name: 'Bock & Doppelbock',
    familie: 'untergärig',
    herkunft: 'Einbeck, später München',
    farbe: '#6b2f10',
    schaum: '#e6cfa8',
    schaumanteil: 0.13,
    glas: 'kelch',
    stammwuerze: '16–22 °P',
    alkohol: '6,5–9,0 % vol',
    bittere: '20–30 IBU',
    charakter:
      'Dunkles Kupfer bis Mahagoni, dickflüssig, mit wuchtiger Malzsüße: Dörrobst, Rosinen, Lebkuchen. ' +
      'Der Alkohol wärmt spürbar.',
    unterschied:
      'Die stärkste untergärige Familie. Doppelbock-Namen enden traditionell auf »-ator« — eine Verbeugung ' +
      'vor dem Salvator der Münchner Paulaner.',
    beispiel: 'Paulaner Salvator · Ayinger Celebrator',
  },
  {
    name: 'Schwarzbier',
    familie: 'untergärig',
    herkunft: 'Thüringen und Sachsen',
    farbe: '#26140a',
    schaum: '#d3b489',
    schaumanteil: 0.15,
    glas: 'humpen',
    stammwuerze: '11–12,5 °P',
    alkohol: '4,5–5,2 % vol',
    bittere: '20–30 IBU',
    charakter:
      'Tiefschwarz mit rotbraunen Reflexen, doch überraschend schlank. Röstmalz bringt Kaffee und ' +
      'Bitterschokolade, ohne dass das Bier schwer wird.',
    unterschied:
      'Sieht aus wie ein Stout, trinkt sich aber wie ein Lager: untergärig, wenig Restsüße, kein sämiger ' +
      'Körper. Genau darin liegt der Reiz.',
    beispiel: 'Köstritzer Schwarzbier · Kulmbacher Mönchshof Schwarzbier',
  },

  /* ----------------------------------------------------------- obergärig */
  {
    name: 'Hefeweizen',
    familie: 'obergärig',
    herkunft: 'Bayern',
    farbe: '#e5b552',
    schaum: '#fefcf5',
    schaumanteil: 0.26,
    glas: 'weizen',
    stammwuerze: '11–13,5 °P',
    alkohol: '4,9–5,6 % vol',
    bittere: '10–15 IBU',
    charakter:
      'Trüb, mit üppiger, sehr standfester Krone. Die Weizenhefe liefert das Erkennungszeichen: Banane ' +
      '(Ester) und Nelke (Phenole). Spritzig durch hohe Kohlensäure, kaum bitter.',
    unterschied:
      'Mindestens die Hälfte des Getreides ist Weizenmalz statt Gerste — daher der schlanke Körper trotz ' +
      'Trübung. Das Aroma kommt fast vollständig von der Hefe, nicht vom Hopfen.',
    beispiel: 'Schneider Weisse Original · Weihenstephaner Hefeweissbier',
  },
  {
    name: 'Kölsch',
    familie: 'obergärig',
    herkunft: 'Köln, geschützte Herkunft',
    farbe: '#eecb52',
    schaum: '#fdfaf0',
    schaumanteil: 0.16,
    glas: 'stange',
    stammwuerze: '11–12 °P',
    alkohol: '4,4–5,2 % vol',
    bittere: '18–28 IBU',
    charakter:
      'Blank hellgelb, sehr schlank, dezent fruchtig mit einem trockenen, leicht weinigen Abgang. ' +
      'Wird traditionell in der 0,2-l-Stange gereicht.',
    unterschied:
      'Ein Zwitter: obergärig vergoren wie ein Ale, danach kalt gelagert wie ein Lager. Deshalb schmeckt es ' +
      'fast so klar wie ein Pils, mit nur einem Hauch Fruchtigkeit.',
    beispiel: 'Früh Kölsch · Gaffel Kölsch',
  },
  {
    name: 'Altbier',
    familie: 'obergärig',
    herkunft: 'Düsseldorf und Niederrhein',
    farbe: '#96380f',
    schaum: '#f0dcbb',
    schaumanteil: 0.16,
    glas: 'stange',
    stammwuerze: '11–12,5 °P',
    alkohol: '4,5–5,2 % vol',
    bittere: '25–45 IBU',
    charakter:
      'Kupferbraun, mit nussig-brotiger Malzbasis und spürbarer Hopfenbittere im Abgang. Schlank trotz ' +
      'der dunklen Farbe.',
    unterschied:
      'Wie Kölsch obergärig-und-kalt-gereift, aber mit dunklerem Malz und deutlich mehr Bittere. Das rheinische ' +
      'Gegenstück — und der Anlass einer jahrhundertealten Rivalität.',
    beispiel: 'Uerige Alt · Füchschen Alt',
  },
  {
    name: 'Pale Ale',
    familie: 'obergärig',
    herkunft: 'England, 18. Jahrhundert',
    farbe: '#d4901f',
    schaum: '#fbf5e6',
    schaumanteil: 0.15,
    glas: 'pint',
    stammwuerze: '11–13 °P',
    alkohol: '4,5–5,6 % vol',
    bittere: '30–45 IBU',
    charakter:
      'Goldgelb bis bernsteinfarben, mit einer Karamellmalz-Basis, über der der Hopfen blumig, krautig ' +
      'oder zitrusartig sitzt. Ausgewogen zwischen Malz und Hopfen.',
    unterschied:
      'Die zahmere Schwester des IPA: gleicher Bauplan, aber weniger Hopfen, weniger Alkohol und mehr ' +
      'Malzgegengewicht. Wo das IPA zuspitzt, hält das Pale Ale die Waage.',
    beispiel: 'Sierra Nevada Pale Ale · Fuller’s London Pride',
  },
  {
    name: 'IPA',
    familie: 'obergärig',
    herkunft: 'England, für die Fahrt nach Indien',
    farbe: '#dd9526',
    schaum: '#fbf3e2',
    schaumanteil: 0.16,
    glas: 'tulpe',
    stammwuerze: '13–17 °P',
    alkohol: '5,5–7,5 % vol',
    bittere: '40–70 IBU',
    charakter:
      'Von golden bis kupfern, mit wuchtigem Hopfenaroma: Grapefruit, Mango, Harz, Kiefer. Die Bittere ist ' +
      'markant und hält lange an.',
    unterschied:
      'Definiert sich über den Hopfen — sowohl in der Menge als auch im späten Zusatz (Kalthopfung), der Aroma ' +
      'ohne zusätzliche Bittere bringt. Die Erzählung vom haltbaren Bier für Indien ist zwar hübsch, aber ' +
      'historisch nur die halbe Wahrheit.',
    beispiel: 'BrewDog Punk IPA · Stone IPA',
  },
  {
    name: 'Red Ale',
    familie: 'obergärig',
    herkunft: 'Irland, auch als American Amber',
    farbe: '#a33a12',
    schaum: '#f2ddbd',
    schaumanteil: 0.15,
    glas: 'pint',
    stammwuerze: '11–13 °P',
    alkohol: '4,0–5,5 % vol',
    bittere: '18–28 IBU',
    charakter:
      'Rotbraun bis kupferrot durch Röstgerste und Karamellmalz. Weich, leicht süßlich, mit einem trockenen, ' +
      'schwach röstigen Abgang.',
    unterschied:
      'Malzbetonter und weicher als ein Pale Ale bei ähnlicher Stärke — die Farbe kommt vom Karamellmalz, ' +
      'nicht von mehr Alkohol. Die amerikanische Amber-Variante ist deutlich hopfiger.',
    beispiel: 'Smithwick’s · Kilkenny',
  },
  {
    name: 'Porter',
    familie: 'obergärig',
    herkunft: 'London, 18. Jahrhundert',
    farbe: '#2e1408',
    schaum: '#cfa974',
    schaumanteil: 0.16,
    glas: 'pint',
    stammwuerze: '12–15 °P',
    alkohol: '4,5–6,5 % vol',
    bittere: '20–35 IBU',
    charakter:
      'Dunkelbraun bis fast schwarz, mit Schokolade, Karamell und einem Hauch Lakritz. Weniger scharf ' +
      'geröstet als ein Stout, dafür runder und süßlicher.',
    unterschied:
      'Der Vorläufer des Stouts. Porter nutzt Schokoladenmalz, Stout ungemälzte Röstgerste — daher der ' +
      'kaffeeartige Biss beim Stout und der weichere Ton beim Porter.',
    beispiel: 'Fuller’s London Porter · Anchor Porter',
  },
  {
    name: 'Stout',
    familie: 'obergärig',
    herkunft: 'Irland und England',
    farbe: '#190c05',
    schaum: '#c9a06a',
    schaumanteil: 0.2,
    glas: 'pint',
    stammwuerze: '10–13 °P',
    alkohol: '4,0–6,0 % vol',
    bittere: '30–45 IBU',
    charakter:
      'Undurchsichtig schwarz mit dichter, cremefarbener Krone. Espresso, dunkle Schokolade, trockener ' +
      'Röstbiss im Abgang. Das Dry Stout ist trotz der Farbe erstaunlich leicht.',
    unterschied:
      'Die Röstgerste ist ungemälzt — das trennt es vom Porter. Und anders als das ebenso schwarze Schwarzbier ' +
      'ist es obergärig, mit cremigerem Mundgefühl.',
    beispiel: 'Guinness Draught · Murphy’s Irish Stout',
  },
  {
    name: 'Saison',
    familie: 'obergärig',
    herkunft: 'Wallonien, Belgien',
    farbe: '#e0a93a',
    schaum: '#fefbf3',
    schaumanteil: 0.22,
    glas: 'kelch',
    stammwuerze: '11–16 °P',
    alkohol: '5,0–8,0 % vol',
    bittere: '20–35 IBU',
    charakter:
      'Goldgelb, trüb, sehr spritzig und knochentrocken. Die Hefe bringt Pfeffer, Zitrusschale und ' +
      'Heunoten. Wurde früher im Winter für die Erntearbeiter gebraut.',
    unterschied:
      'Die Hefe führt Regie, nicht Malz oder Hopfen — sie vergärt so gründlich, dass fast keine Restsüße ' +
      'bleibt. Daher die Trockenheit trotz oft hohem Alkoholgehalt.',
    beispiel: 'Saison Dupont · Brasserie de la Senne Taras Boulba',
  },
  {
    name: 'Trappist / Belgisch Stark',
    familie: 'obergärig',
    herkunft: 'Belgische und niederländische Klöster',
    farbe: '#7a3410',
    schaum: '#efd6ae',
    schaumanteil: 0.2,
    glas: 'kelch',
    stammwuerze: '15–24 °P',
    alkohol: '6,0–11,0 % vol',
    bittere: '20–35 IBU',
    charakter:
      'Von bernsteinfarben bis dunkelbraun, flaschengereift, mit Dörrpflaume, Feige, Karamell und ' +
      'kräftiger Hefewürze. Trotz hoher Stärke oft überraschend spritzig.',
    unterschied:
      'Der Kandiszucker im Sud ist der Kniff: er hebt den Alkohol, ohne den Körper schwer zu machen — deshalb ' +
      'trinkt sich ein Neunprozenter hier leichter als ein Doppelbock gleicher Stärke.',
    beispiel: 'Chimay Bleue · Westmalle Dubbel · Rochefort 10',
  },

  /* ------------------------------------------------------ spontan & sauer */
  {
    name: 'Berliner Weisse',
    familie: 'spontan & sauer',
    herkunft: 'Berlin',
    farbe: '#f2dd8e',
    schaum: '#fefdf8',
    schaumanteil: 0.2,
    glas: 'kelch',
    stammwuerze: '7–9 °P',
    alkohol: '2,8–3,8 % vol',
    bittere: '3–8 IBU',
    charakter:
      'Sehr blass, trüb, spritzig und deutlich sauer. Kaum Bittere, wenig Alkohol. Traditionell mit ' +
      'Waldmeister- oder Himbeersirup gereicht, um die Säure zu brechen.',
    unterschied:
      'Milchsäurebakterien vergären mit — daher die Säure, die kein anderes deutsches Bier hat. Napoleons ' +
      'Truppen nannten sie den »Champagner des Nordens«.',
    beispiel: 'Berliner Kindl Weisse · Schneeeule Marlene',
  },
  {
    name: 'Gose',
    familie: 'spontan & sauer',
    herkunft: 'Goslar, später Leipzig',
    farbe: '#eeda76',
    schaum: '#fefcf6',
    schaumanteil: 0.18,
    glas: 'kelch',
    stammwuerze: '9–12 °P',
    alkohol: '4,0–5,0 % vol',
    bittere: '5–12 IBU',
    charakter:
      'Trüb strohgelb, säuerlich, mit Koriander und — als einzige deutsche Sorte — zugesetztem Salz. ' +
      'Erfrischend und ungewöhnlich herzhaft.',
    unterschied:
      'Salz und Koriander verstoßen gegen das Reinheitsgebot; die Gose überlebte nur, weil sie als regionale ' +
      'Altbekanntheit Bestandsschutz genießt.',
    beispiel: 'Bayerischer Bahnhof Leipziger Gose · Ritterguts Gose',
  },
  {
    name: 'Lambic & Geuze',
    familie: 'spontan & sauer',
    herkunft: 'Payottenland bei Brüssel',
    farbe: '#d99c3e',
    schaum: '#fdf8ec',
    schaumanteil: 0.12,
    glas: 'schwenker',
    stammwuerze: '11–14 °P',
    alkohol: '5,0–8,0 % vol',
    bittere: '0–10 IBU',
    charakter:
      'Trüb goldfarben, knochentrocken, stark säuerlich, mit Leder-, Heu- und Apfelnoten. Geuze ist ein ' +
      'Verschnitt junger und alter Lambics, der in der Flasche nachgärt.',
    unterschied:
      'Es wird keine Hefe zugesetzt — die Würze kühlt offen aus, und was aus der Luft hineinfällt, vergärt sie. ' +
      'Die Reifung dauert ein bis drei Jahre. Näher am Wein als am Bier.',
    beispiel: 'Cantillon Gueuze · 3 Fonteinen Oude Geuze',
  },
];
