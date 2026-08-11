// ChampionChip Eesti — championchip.ee
// Ainus allikas, mis annab eraldi lingid stardinimekirjale, tulemustele JA live'ile.
//
// HTML on ilusti struktureeritud, seega kasutame klassinimesid, mitte regexit:
//
//   .event                        <- uks voistlus
//     .date                       <- "10. AUG 2026"
//     .name a                     <- voistluse nimi + korraldaja link
//     .info                       <- "19:00 (Kuusalu, Lauritsa palliplats)"
//     .distance                   <- uks distants (neid voib olla mitu)
//       .distance-name            <- "5,2 km"
//       .icon-participants a      <- stardinimekiri
//       .icon-results a           <- tulemused
//       .icon-live a              <- live; klass "inactive" kui ei kai
//
// NB: lingid on kujul championchip.ee/results/3451 — ILMA /et/ osata.

import * as cheerio from 'cheerio';
import { fetchHtml, absoluteUrl, clean, parseTextDate, sleep } from '../lib.mjs';

const BASE = 'https://www.championchip.ee';
const PAGES = 4; // 4 x 25 = 100 viimast kirjet

// Voistlused, mis ei toimu Eestis, jaavad valja.
const FOREIGN = /jyväskylä|jyvaskyla|kalevan kisat|helsinki|riga|vilnius/i;

function parsePage(html) {
  const $ = cheerio.load(html);
  const events = [];

  $('.event').each((_, el) => {
    const box = $(el);

    const date = parseTextDate(clean(box.find('.date').first().text()));
    if (!date) return;

    const nameLink = box.find('.name a').first();
    const name = clean(nameLink.text()) || clean(box.find('.name').first().text());
    if (!name || name.length < 3) return;
    if (FOREIGN.test(name)) return;

    const info = clean(box.find('.info').first().text());
    const locMatch = info.match(/\(([^)]{2,80})\)/);

    // Iga distants annab oma lingikomplekti. Votame esimese, millel
    // tulemused olemas — see on urituse "peamine" distants.
    const distances = [];
    let primary = null;

    box.find('.distance').each((__, d) => {
      const dist = $(d);
      const dName = clean(dist.find('.distance-name').first().text());

      const resultsA = dist.find('.icon-results a[href]').first();
      const startA = dist.find('.icon-participants a[href]').first();
      const liveA = dist.find('.icon-live a[href]').first();

      // "Osalejaid ei ole veel lisatud" tahendab, et nimekirja pole.
      const startTitle = startA.attr('title') || '';
      const hasStart = startA.length && !/ei ole|pole/i.test(startTitle);

      // Live on aktiivne ainult siis, kui klassis pole "inactive".
      const liveClass = liveA.attr('class') || '';
      const liveActive = liveA.length && !/inactive/.test(liveClass);

      const links = {
        results: resultsA.length ? absoluteUrl(resultsA.attr('href'), BASE) : null,
        startlist: hasStart ? absoluteUrl(startA.attr('href'), BASE) : null,
        live: liveActive ? absoluteUrl(liveA.attr('href'), BASE) : null,
      };

      if (dName) distances.push(dName);
      if (!primary && links.results) primary = links;
      // Kui mone distantsi live kaib, siis see voidab.
      if (primary && !primary.live && links.live) primary.live = links.live;
      if (primary && !primary.startlist && links.startlist) primary.startlist = links.startlist;
    });

    if (!primary) return;

    events.push({
      source: 'championchip',
      sourceId: (primary.results.match(/(\d+)\s*$/) || [])[1] || primary.results,
      name,
      date,
      location: locMatch ? clean(locMatch[1]) : null,
      sport: null,
      distanceCount: distances.length || 1,
      distances: distances.slice(0, 12),
      links: {
        results: primary.results,
        startlist: primary.startlist,
        live: primary.live,
        organiser: nameLink.length ? absoluteUrl(nameLink.attr('href'), BASE) : null,
      },
    });
  });

  return events;
}

export default {
  id: 'championchip',
  label: 'ChampionChip',
  async fetchEvents() {
    const all = [];

    for (let page = 1; page <= PAGES; page++) {
      const html = await fetchHtml(`${BASE}/et/results?page=${page}&per-page=25`, `championchip-results-${page}`);
      const found = parsePage(html);
      all.push(...found);
      if (!found.length) break;
      await sleep(800);
    }

    try {
      const html = await fetchHtml(`${BASE}/et/calendar`, 'championchip-calendar');
      all.push(...parsePage(html));
    } catch (err) {
      console.warn(`  [championchip] kalender ebaonnestus: ${err.message}`);
    }

    const seen = new Set();
    return all.filter((e) => !seen.has(e.sourceId) && seen.add(e.sourceId));
  },
};

export { parsePage };
