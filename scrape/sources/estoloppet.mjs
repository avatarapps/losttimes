// Estoloppet — Eesti rahvasuusatajate sari. Vaike, aga katab suurimad
// suusamaratonid: Tartu, Haanja, Alutaguse, Viru, Neeruti.
//
// Terve hooaeg on uhel staatilisel lehel, nummerdatud plokkidena:
//
//   1.
//   L 17.01.2026
//   40. Viru Maraton
//   Maraton, Poolmaraton, Farmi lastesõit 1,5 km
//
//   3.
//   L 07.02 - P 08.02.2026        <- MITMEPAEVANE
//   48. Alutaguse Maraton
//
// Just see mitmepaevane kuju murdis varasema parseri: ta votis kuupaevaks
// viimase arvu ja tekitas kahe paeva peale kaks kirjet. Nuud votame ALGUSE
// paeva ja aasta rea lopust — nii saab ka "L 14.02 - E 16.03.2026" oigesti.
//
// IGAL ETAPIL ON OMA LEHT
// Varem viitasime koigil etappidel sarja uldisele tulemuste lehele. See oli
// pool vastust: kasutaja joudis lehele, kus on koik hooajad korraga, ja pidi
// oma voistluse sealt ules otsima. Igal etapil on tegelikult oma aadress:
//
//   leht        /et/etapid?competition_id=458
//   tulemused   /et/etapid?competition_id=458&action=results
//   stardinim.  /et/etapid?competition_id=458&action=registered
//
// KUIDAS ID ETAPIGA SEOTAKSE
// Ei jarjekorra jargi. Iga id-ga leht avatakse ja sealt loetakse voistluse
// NIMI — sobitame selle jargi. Nii ei saa 458 sattuda vale maratoni kulge
// ka siis, kui leht oma jarjekorda muudab. Boonusena tuleb etapi lehelt
// kaasa ASUKOHT, mida nimekirjas ei ole.
//
// Kui etapi lehte ei saa kaette, jaab see etapp sarja uldiste linkidega —
// vahem tapne, aga mitte katki.

import * as cheerio from 'cheerio';
import { fetchHtml, clean } from '../lib.mjs';

const BASE = 'https://www.estoloppet.ee';

const NUMBER_LINE = /^\d{1,2}\.$/;
const DATE_LINE = /(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/;
const YEAR = /(\d{4})\s*$/;

const fold = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Uhe etapi leht -> nimi ja asukoht. Nimi on see, mille jargi seome.
async function stagePage(id) {
  const url = `${BASE}/et/etapid?competition_id=${id}`;
  const $ = cheerio.load(await fetchHtml(url, `estoloppet-${id}`, { timeoutMs: 20000, tries: 2 }));
  const name = clean($('h1').first().text());
  if (!name) return null;

  // "Toimumise asukoht" jargneb sildile omaette tekstiplokis.
  let location = null;
  const lines = $('body').text().split('\n').map(clean).filter(Boolean);
  const i = lines.findIndex((l) => /^toimumise asukoht$/i.test(l));
  if (i >= 0 && lines[i + 1] && lines[i + 1].length < 80) location = lines[i + 1];

  return { id, name, location };
}

export default {
  id: 'estoloppet',
  label: 'Estoloppet',
  async fetchEvents() {
    const html = await fetchHtml(`${BASE}/et/etapid`, 'estoloppet-etapid');
    const $ = cheerio.load(html);

    const lines = $('body').text().split('\n').map(clean).filter(Boolean);

    const events = [];

    for (let i = 0; i < lines.length; i++) {
      if (!NUMBER_LINE.test(lines[i])) continue;

      const dateLine = lines[i + 1] || '';
      const name = clean(lines[i + 2] || '');
      if (!DATE_LINE.test(dateLine) || !/maraton|sõit|jooks/i.test(name)) continue;

      const d = dateLine.match(DATE_LINE);
      const y = dateLine.match(YEAR);
      const day = Number(d[1]);
      const month = Number(d[2]);
      const year = Number(d[3] || (y && y[1]));
      if (!day || !month || !year || month > 12 || day > 31) continue;

      const distances = clean(lines[i + 3] || '')
        .split(',')
        .map(clean)
        .filter((x) => x && x.length < 60)
        .slice(0, 12);

      events.push({
        source: 'estoloppet',
        sourceId: `${year}-${name.replace(/\W+/g, '-').toLowerCase()}`.slice(0, 80),
        name,
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        location: null,
        sport: 'Suusatamine',
        distanceCount: distances.length || 1,
        distances,
        links: {
          results: `${BASE}/et/tulemused`,
          startlist: `${BASE}/et/registreerumine`,
          live: null,
          organiser: `${BASE}/et/etapid`,
          info: `${BASE}/et/etapid`,
        },
      });
    }

    const seen = new Set();
    const uniq = events.filter((e) => !seen.has(e.sourceId) && seen.add(e.sourceId));

    // --- etapi omad aadressid ---
    const ids = [...new Set(
      $('a[href*="competition_id="]')
        .map((_, a) => ($(a).attr('href') || '').match(/competition_id=(\d+)/)?.[1])
        .get()
        .filter(Boolean)
    )];

    if (!ids.length) {
      console.warn('  [estoloppet] lehelt ei leidnud ühtegi competition_id-d, jään üldiste linkide juurde');
      return uniq;
    }

    const kaart = new Map();
    for (const id of ids) {
      try {
        const info = await stagePage(id);
        if (info) kaart.set(fold(info.name), info);
      } catch (err) {
        console.warn(`  [estoloppet] etapp ${id}: ${err.message}`);
      }
    }

    let seotud = 0;
    for (const e of uniq) {
      const info = kaart.get(fold(e.name));
      if (!info) continue;
      const leht = `${BASE}/et/etapid?competition_id=${info.id}`;
      e.links = {
        results: `${leht}&action=results`,
        startlist: `${leht}&action=registered`,
        live: null,
        organiser: leht,
        info: leht,
      };
      if (info.location) e.location = info.location;
      seotud++;
    }
    console.log(`  [estoloppet] ${seotud}/${uniq.length} etappi sai oma lehe ja otselingid`);

    return uniq;
  },
};
