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
// Tulemuste otselink nouaks competition_id-d, mida sellel lehel ei ole.
// Viitame uldisele tulemuste lehele — see on ikkagi oige viit.

import * as cheerio from 'cheerio';
import { fetchHtml, clean } from '../lib.mjs';

const BASE = 'https://www.estoloppet.ee';

const NUMBER_LINE = /^\d{1,2}\.$/;
const DATE_LINE = /(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/;
const YEAR = /(\d{4})\s*$/;

export default {
  id: 'estoloppet',
  label: 'Estoloppet',
  async fetchEvents() {
    const html = await fetchHtml(`${BASE}/et/etapid`, 'estoloppet-etapid');
    const $ = cheerio.load(html);

    const lines = $('body')
      .text()
      .split('\n')
      .map(clean)
      .filter(Boolean);

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
    return events.filter((e) => !seen.has(e.sourceId) && seen.add(e.sourceId));
  },
};
