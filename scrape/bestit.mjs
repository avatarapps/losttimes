// BestIT võistlussüsteem — stamina.ee, tartumaraton.ee, estoloppet.ee
//
// MIKS UKS MOODUL, MITTE KOLM
// Need lehed on ehitanud sama tegija ja neil on tapselt sama aadressimuster:
//
//   nimekiri    /et/<sari>/voistlused
//   voistlus    /et/<sari>/voistlused?competition_id=297
//   tulemused   ...?competition_id=297&action=results
//   stardinim.  ...?competition_id=297&action=registered
//
// Ilma selleta viitasime koigil sarja voistlustel sarja ULDLEHELE. Kasutaja
// joudis nimekirja, kus on koik voistlused korraga, ja pidi oma oma sealt
// ules otsima — see on pool tood, mille me lubasime ara teha.
//
// KUIDAS VOISTLUS SEOTAKSE
// KUUPAEVA jargi, mitte nime ega jarjekorra jargi. Voistluse leht utleb oma
// toimumisaja ise ("L 30.01.2027") ja kuupaev on ainus tunnus, mis on molemas
// susteemis tapselt sama. Nimed lahevad lahku: meil "Tallinna Vee 54. jooks
// umber Ulemiste jarve", korraldajal voib olla "54. Ulemiste jarve jooks".
//
// Kui uhel kuupaeval on meil selle sarja all mitu voistlust, jaab sidumata
// ja logi utleb seda. Vale link on halvem kui puuduv.

import * as cheerio from 'cheerio';
import { fetchHtml, clean } from './lib.mjs';

// Sari -> milliste meie voistlustega ta uldse voib seotud olla.
// `match` on kaitsevoo: ilma selleta voiks juhuslikult sama kuupaeva
// voistlus teisest sarjast lingi endale saada.
const SERIES = [
  {
    id: 'maru',
    label: 'Stamina',
    base: 'https://stamina.ee/et/jarvejooks/voistlused',
    match: /jooks|maraton|kross|triatlon/i,
  },
  {
    id: 'oojooks',
    label: 'Eesti Maraton',
    base: 'https://eestimaraton.ee/et/sundmused',
    // Nimekirja asukoht ei ole neil lehtedel uhtne. Proovime jarjest ja
    // votame esimese, mis competition_id-sid annab.
    list: ['https://eestimaraton.ee/et/sundmused', 'https://eestimaraton.ee/et/avaleht',
           'https://eestimaraton.ee/et/tulemused'],
    match: /jooks|maraton/i,
  },
];

// Kuupaev voib olla vahemik: "R 14.08 - L 15.08.2026".
// Votame ALGUSE paeva ja kuu ning aasta rea lopust. Uhepaevasel
// ("L 30.01.2027") annab sama reegel sama tulemuse.
//
// See ei ole ilustus: Ulemiste Ooejooks kestab kaks paeva ja meie kirje on
// 14. augustil. Lopu kuupaeva vottes ei oleks link kunagi kohale joudnud.
function parseDate(txt) {
  const dm = (txt || '').match(/(\d{1,2})\.(\d{1,2})/);
  const yy = (txt || '').match(/((?:19|20)\d{2})/g);
  if (!dm || !yy) return null;
  const d = Number(dm[1]), m = Number(dm[2]);
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  return `${yy[yy.length - 1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Nimedest jaavad alles ainult eristavad sonad: pikad, ilma diakriitikuta,
// ilma aastaarvu ja uldsonadeta. "Tallinna Vee 54. jooks umber Ulemiste
// jarve" -> tallinna, ulemiste. Just "ulemiste" on see, mis kahes susteemis
// kokku langeb, kui nimed muidu lahku lahevad.
const ULDSONAD = new Set([
  'jooks','jooksu','maraton','poolmaraton','kross','triatlon','etapp','sari',
  'sarja','voistlus','voistlused','rahvajooks','linnajooks','umber','jarve',
]);

function tunnussonad(nimi) {
  return new Set(
    (nimi || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((w) => w.length >= 5 && !/^\d+$/.test(w) && !ULDSONAD.has(w))
  );
}

function kattub(a, b) {
  const A = tunnussonad(a);
  for (const w of tunnussonad(b)) if (A.has(w)) return true;
  return false;
}

// Voistluse leht -> kuupaev, nimi, asukoht
function parseStage(html) {
  const $ = cheerio.load(html);
  const name = clean($('h1').first().text());
  if (!name) return null;

  const lines = $('body').text().split('\n').map(clean).filter(Boolean);

  const val = (silt) => {
    const i = lines.findIndex((l) => new RegExp(`^${silt}$`, 'i').test(l));
    return i >= 0 ? lines[i + 1] || '' : '';
  };

  const date = parseDate(val('Toimumisaeg'));
  if (!date) return null;

  const koht = val('Toimumise asukoht');
  return { name, date, location: koht && koht.length < 80 ? koht : null };
}

function isDeadEnd(url) {
  // Sarja uldleht ei ole vastus — ta on koht, kust kasutaja peab edasi otsima.
  return !url || url.includes('losttimes.ee') || url.startsWith('/') ||
    /sportos\.eu/i.test(url) ||
    /\/(voistlused|sundmused|tulemused|avaleht)\/?$/.test(url);
}

export async function applyBestIt(events) {
  let seotud = 0;

  for (const sari of SERIES) {
    let ids = [];
    for (const [n, listUrl] of (sari.list || [sari.base]).entries()) {
      try {
        const $ = cheerio.load(await fetchHtml(listUrl, `bestit-${sari.id}-list${n}`, { timeoutMs: 20000, tries: 2 }));
        ids = [...new Set(
          $('a[href*="competition_id="]')
            .map((_, a) => ($(a).attr('href') || '').match(/competition_id=(\d+)/)?.[1])
            .get().filter(Boolean)
        )];
      } catch (err) {
        console.warn(`  [bestit] ${sari.id} ${listUrl}: ${err.message}`);
      }
      if (ids.length) break;
    }
    if (!ids.length) {
      console.warn(`  [bestit] ${sari.id}: nimekirjast ei leidnud ühtegi competition_id-d`);
      continue;
    }

    for (const id of ids) {
      const leht = `${sari.base}?competition_id=${id}`;
      let info;
      try {
        info = parseStage(await fetchHtml(leht, `bestit-${sari.id}-${id}`, { timeoutMs: 20000, tries: 2 }));
      } catch (err) {
        console.warn(`  [bestit] ${sari.id} ${id}: ${err.message}`);
        continue;
      }
      if (!info) continue;

      // Esmalt kuupaev. Suvisel laupaeval on neid mitu, siis kitsendame
      // nime jargi — piisab uhest eristavast sonast, mis molemas nimes on.
      let kandidaadid = events.filter((e) => e.date === info.date && sari.match.test(e.name));
      if (kandidaadid.length > 1) {
        kandidaadid = kandidaadid.filter((e) => kattub(e.name, info.name));
      }
      if (kandidaadid.length !== 1) {
        if (kandidaadid.length > 1) {
          console.warn(`  [bestit] ${sari.id} ${info.date} "${info.name}": ${kandidaadid.length} kandidaati, jätan sidumata`);
        }
        continue;
      }

      const e = kandidaadid[0];
      const olemas = e.sources.map((s) => s.links.results).find(Boolean);
      if (!isDeadEnd(olemas)) continue;   // toimivat linki ei puutu

      e.sources.unshift({
        id: 'bestit',
        label: sari.label,
        links: {
          results: `${leht}&action=results`,
          startlist: `${leht}&action=registered`,
          live: null,
          organiser: leht,
        },
        distanceCount: 0,
      });
      if (!e.location && info.location) e.location = info.location;
      seotud++;
    }
  }

  if (seotud) console.log(`[bestit] sidusin ${seotud} võistlust otse tulemuste ja stardinimekirjaga`);
  return events;
}
