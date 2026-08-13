// BestIT võistlussüsteem — eestimaraton.ee, stamina.ee, estoloppet.ee, tartumaraton.ee
//
// Need lehed on ehitanud sama tegija ja neil on tapselt sama aadressimuster:
//
//   nimekiri    /et/avaleht  voi  /et/sundmused  voi  /et/<sari>/voistlused
//   voistlus    ...?competition_id=53
//   tulemused   ...?competition_id=53&action=results
//   stardinim.  ...?competition_id=53&action=registered
//
// SEE ON ALLIKAS, MITTE LINGIPARANDAJA
// Esimene katse oli moodul, mis ainult parandas olemasolevate voistluste
// linke. See oli vale mudel: eestimaraton.ee uheksast voistlusest oli meil
// olemas kaks. Ulejaanud seitset — Maardu City Run, Baltic Beach Run,
// Noblessner, Ulemiste Grit, Rakvere Oojooks, kaks Sudasuve Challenge'i —
// ei olnud kusagilt tulnud, sest neid ei registreerita Sportoses.
//
// Allikana tulevad nad sisse nagu iga teine voistlus ja labivad tavalise
// tee: merge liidab Sportose kirjega kokku, kui see olemas on, filter
// kontrollib ala, slug ja leht tekivad ise.
//
// NIMEKIRJA ASUKOHT EI OLE UHTNE
// Staminal on see /voistlused, eestimaratonil /avaleht, ja /sundmused ilma
// parameetrita naitab ainult uht voistlust. Seetottu kaime LABI KOIK
// kandidaadid ja liidame leitud id-d kokku. Varasem "vota esimene, mis
// midagi annab" oleks eestimaratonilt toonud uheainsa voistluse.

import * as cheerio from 'cheerio';
import { fetchHtml, clean } from '../lib.mjs';

// Kuupaev voib olla vahemik: "R 14.08 - L 15.08.2026".
// Votame ALGUSE paeva ja kuu ning aasta rea lopust — Ulemiste Oojooks
// kestab kaks paeva ja tema kirje kaib alguspaeva alla.
function parseDate(txt) {
  const dm = (txt || '').match(/(\d{1,2})\.(\d{1,2})/);
  const yy = (txt || '').match(/((?:19|20)\d{2})/g);
  if (!dm || !yy) return null;
  const d = Number(dm[1]);
  const m = Number(dm[2]);
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  return `${yy[yy.length - 1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseStage(html) {
  const $ = cheerio.load(html);
  const name = clean($('h1').first().text());
  if (!name) return null;

  const lines = $('body').text().split('\n').map(clean).filter(Boolean);
  const val = (silt) => {
    const i = lines.findIndex((l) => new RegExp(`^${silt}$`, 'i').test(l));
    return i >= 0 ? clean(lines[i + 1] || '') : '';
  };

  const date = parseDate(val('Toimumisaeg'));
  if (!date) return null;

  const koht = val('Toimumise asukoht');

  // Distantsid on tabelis, iga rida "14.08 Neptunas 10 km". Jatame kuupaeva
  // eest ara ja hoiame rea luhikesena — see laheb voistluse lehele.
  const distances = $('table td').map((_, td) => clean($(td).text())).get()
    .map((t) => t.replace(/^\d{1,2}\.\d{1,2}\s*(\d{1,2}[:.]\d{2})?\s*/, ''))
    .filter((t) => t && t.length > 2 && t.length < 60)
    .slice(0, 14);

  return {
    name,
    date,
    location: koht && koht.length < 80 ? koht : null,
    distances: [...new Set(distances)],
  };
}

export function bestItSource({ id, label, base, list, sport = null }) {
  return {
    id,
    label,
    // Uks katkine korraldaja leht ei tohi kogu ood labi kukutada.
    optional: true,
    async fetchEvents() {
      // KOIK kandidaadid labi, mitte esimene toimiv.
      const ids = new Set();
      for (const [n, listUrl] of (list || [base]).entries()) {
        try {
          const $ = cheerio.load(await fetchHtml(listUrl, `${id}-list${n}`, { timeoutMs: 20000, tries: 2 }));
          $('a[href*="competition_id="]').each((_, a) => {
            const m = ($(a).attr('href') || '').match(/competition_id=(\d+)/);
            if (m) ids.add(m[1]);
          });
        } catch (err) {
          console.warn(`  [${id}] ${listUrl}: ${err.message}`);
        }
      }
      if (!ids.size) {
        console.warn(`  [${id}] ühtegi competition_id-d ei leidnud`);
        return [];
      }

      const events = [];
      for (const cid of ids) {
        const leht = `${base}?competition_id=${cid}`;
        let info;
        try {
          info = parseStage(await fetchHtml(leht, `${id}-${cid}`, { timeoutMs: 20000, tries: 2 }));
        } catch (err) {
          console.warn(`  [${id}] ${cid}: ${err.message}`);
          continue;
        }
        if (!info) continue;

        events.push({
          source: id,
          sourceId: `${id}-${cid}`,
          name: info.name,
          date: info.date,
          location: info.location,
          sport,
          distanceCount: info.distances.length || 1,
          distances: info.distances,
          links: {
            results: `${leht}&action=results`,
            startlist: `${leht}&action=registered`,
            live: null,
            organiser: leht,
            info: leht,
          },
        });
      }
      return events;
    },
  };
}

export const eestimaraton = bestItSource({
  id: 'eestimaraton',
  label: 'Eesti Maraton',
  base: 'https://eestimaraton.ee/et/sundmused',
  list: [
    'https://eestimaraton.ee/et/avaleht',    // tulevased
    'https://eestimaraton.ee/et/tulemused',  // toimunud
    'https://eestimaraton.ee/et/sundmused',
  ],
  sport: 'Jooksmine',
});

export const rattamaratonid = bestItSource({
  id: 'rattamaratonid',
  label: 'Eesti Maastikurattasari',
  base: 'https://www.rattamaratonid.ee/et/etapid',
  list: [
    'https://www.rattamaratonid.ee/et/etapid',     // kaesolev hooaeg
    'https://www.rattamaratonid.ee/et/tulemused',  // toimunud
    'https://www.rattamaratonid.ee/',              // avaleht, sama nimekiri
  ],
  sport: 'Jalgrattasport',
});

export const maru = bestItSource({
  id: 'maru',
  label: 'Stamina',
  base: 'https://stamina.ee/et/jarvejooks/voistlused',
  list: [
    'https://stamina.ee/et/jarvejooks/voistlused',
    'https://stamina.ee/et/jarvejooks/tulemused',
  ],
  sport: 'Jooksmine',
});
