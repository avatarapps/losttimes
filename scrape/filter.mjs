// Mis kuulub sellele lehele ja mis mitte.
//
// Leht on kestvusalade harrastajale: jooks, suusa, ratas, triatlon ja sugulased.
// Allikad (eriti Sportos) sisaldavad ka discgolfi nadalamange, maleturniire,
// kergejoustiku heiteseriaale ja kulaspordipaevi. Need ainult segavad.
//
// KAKS REEGLIT:
//   1. Kui allikas utles ala (Sportos utleb), otsustab ala.
//   2. Kui ala ei ole teada, otsustab nimi — viskame valja ainult selle,
//      mis on kindlalt vale. Kahtluse korral JATAME SISSE, sest puuduv
//      voistlus on hullem viga kui uleliigne.

// Sportose alade nimed, mis meile sobivad.
const KEEP_SPORTS = [
  'jooksmine', 'kepikõnd', 'käimine',
  'jalgrattasport', 'maanteerattasõit', 'maastikurattasõit', 'tsüklokross', 'gravel',
  'rulluisutamine', 'rullsuusatamine', 'suusatamine', 'uisutamine', 'kiiruisutamine',
  'triatlon', 'triatlon/duatlon', 'duatlon', 'akvatlon',
  'ujumine', 'orienteerumine', 'seiklussport', 'sõudmine', 'aerutamine',
];

// Nimemustrid, mis tahendavad kindlalt "mitte meile".
const DROP_NAME = new RegExp(
  [
    'discgolf', 'disc golf', 'frisbee',
    '\\bmales\\b', 'maleturniir', 'malefestival', '\\bkabe\\b', '\\bbridž',
    'heiteseriaal', 'heitjate', '\\bheited\\b', 'kuulitõuge', 'kettaheit', 'odavise',
    'kergejõustikuvõistlus', 'kergejõustikuõhtu', 'mitmevõistlus', 'mitmevõistlused',
    'spordipäev', 'suvemängud', 'talimängud', 'külamängud',
    // Treening, laager voi koolitus ei ole voistlus — seal ei ole tulemusi,
    // mida keegi hiljem otsiks.
    // "laager" ilma sonapiirita, sest kirjas on "kevadlaager", "suvelaager".
    'treening', '\\btrenn', 'koolitus', 'laager', 'laagri', 'õpituba',
    'workshop', 'tutvustus', 'proovitund', 'kontsert', 'näidis',
    // Kergejoustik ja koolispordi sarjad ei ole kestvusalad.
    'kergejõustik', 'olümpiastarti', 'koolinoorte', 'võimlemis', 'võimlejate',
    'hüppevõistlus', 'teatevõistlus',
    // Matkad ja elamusretked ei ole voistlused — seal ei ole aegu ega kohti.
    'elamusretk', '\\bmatka', '\\bmatk\\b', 'rahvamatk', 'seiklusretk',
    'tennis', 'sulgpall', 'lauatennis', 'korvpall', 'jalgpall', 'võrkpall', 'käsipall',
    'petank', 'mälumäng', 'motokross', 'kardi', 'rally', 'ralli\\b',
  ].join('|'),
  'i'
);

// Erand: "Tartu Rattaralli" ja "Rattaralli" on ratas, mitte autoralli.
const RALLI_OK = /rattaralli|jalgrattaralli/i;

export function isRelevant(event) {
  const name = event.name || '';

  if (RALLI_OK.test(name)) return true;
  if (DROP_NAME.test(name)) return false;

  const sport = (event.sport || '').toLowerCase().trim();
  if (sport) {
    return KEEP_SPORTS.some((s) => sport.includes(s) || s.includes(sport));
  }

  // Ala teadmata ja nimi ei ole kahtlane — jatame sisse.
  return true;
}

export function explainFilter(events) {
  const kept = events.filter(isRelevant);
  const dropped = events.filter((e) => !isRelevant(e));
  return { kept, dropped };
}
