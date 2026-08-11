// Estoloppet — Eesti rahvasuusatajate sari. Vaike, aga katab suurimad
// suusamaratonid (Tartu, Haanja, Alutaguse, Viru, Neeruti).
//
// Terve hooaeg on uhel staatilisel lehel:
//   1.
//   L 17.01.2026
//   ## 40. Viru Maraton
//   Maraton, Poolmaraton, Farmi lastesõit 1,5 km
//
// Tulemuste otselink nouaks competition_id-d, mida sellel lehel ei ole.
// Viitame uldisele tulemuste lehele — see on ikkagi oige viit.

import * as cheerio from 'cheerio';
import { fetchHtml, clean, parseNumericDate } from '../lib.mjs';

const BASE = 'https://www.estoloppet.ee';
const DATE = /\b([ETKNRLP])\s+(\d{1,2})\.(\d{1,2})(?:\s*-\s*[ETKNRLP]?\s*[\d.]+)?\.?(\d{4})?\b/;

export default {
  id: 'estoloppet',
  label: 'Estoloppet',
  async fetchEvents() {
    const html = await fetchHtml(`${BASE}/et/etapid`, 'estoloppet-etapid');
    const $ = cheerio.load(html);
    const events = [];

    $('h2, h3').each((_, el) => {
      const heading = $(el);
      const name = clean(heading.text());
      if (!name || name.length < 5 || !/maraton/i.test(name)) return;

      // Kuupaev on pealkirja ees samas plokis.
      let box = heading.parent();
      for (let up = 0; up < 3 && !DATE.test(box.text()); up++) box = box.parent();
      const m = box.text().match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (!m) return;

      const date = parseNumericDate(`${m[1]}.${m[2]}.${m[3]}`);
      if (!date) return;

      const distances = clean(heading.next().text())
        .split(',')
        .map(clean)
        .filter((d) => d && d.length < 60);

      events.push({
        source: 'estoloppet',
        sourceId: `${date}-${name.replace(/\W+/g, '-').toLowerCase()}`,
        name,
        date,
        location: null,
        sport: 'Suusatamine',
        distanceCount: distances.length || 1,
        links: {
          results: `${BASE}/et/tulemused`,
          startlist: `${BASE}/et/registreerumine`,
          live: null,
          organiser: `${BASE}/et/etapid`,
        },
        distances,
      });
    });

    const seen = new Set();
    return events.filter((e) => !seen.has(e.sourceId) && seen.add(e.sourceId));
  },
};
