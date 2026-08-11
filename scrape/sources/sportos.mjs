// Sportos.eu — suurim katvus (jooks, maantee, maastik, gravel, triatlon,
// rulluisk, kepikõnd, orienteerumine).
//
// TAHTIS: /ee/et/tulemused EI OLE tulemuste nimekiri, vaid sundmuste nimekiri.
// Osal uritustel on Sportoses tulemused olemas, osal mitte (need ajastas keegi
// teine). Seda naeb ainult urituse enda lehelt, kus on sakid:
//
//   Uldinfo | Juhend | Registreerunud | Stardinimekirjad | Tulemused | ...
//
// Sakid on olemas ainult siis, kui sisu on olemas. Seega kaime iga urituse
// lehe eraldi labi ja votame sealt paris lingid:
//
//   {slug}/tulemused/          <- tulemused
//   {slug}/stardinimekirjad/   <- stardinimekiri
//
// Kui tulemuste sakki ei ole, EI PANE me tulemuste nuppu. Vale link on halvem
// kui puuduv link — just seda lehte me siin parandama tulimegi.

import * as cheerio from 'cheerio';
import { fetchHtml, absoluteUrl, clean, parseNumericDate, sleep } from '../lib.mjs';

const BASE = 'https://www.sportos.eu';
const PAGES = 3;                        // 3 x 40 = 120 viimast kirjet
const SKIP_DETAILS = process.argv.includes('--no-details');
const DETAIL_DELAY = 600;               // ms paringute vahel — ara kiirenda

// Sportos sisaldab ka asju, mis siia lehele ei kuulu. Muuda vabalt.
const DROP = /discgolf|males?\b|malefestival|heiteseriaal|heitjate/i;

const ET_DATE = /\b([ETKNRLP])\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/;

function parseListing(html) {
  const $ = cheerio.load(html);
  const events = [];

  $('h1, h2, h3, h4').each((_, el) => {
    const heading = $(el);
    const link = heading.find('a[href]').first();
    if (!link.length) return;

    const name = clean(heading.text());
    const href = absoluteUrl(link.attr('href'), BASE);
    if (!name || !href || !/\/ee\/(et|en)\//.test(href)) return;
    if (/uudised|tagasiside|ostutingimused/.test(href)) return;
    if (DROP.test(name)) return;

    let box = heading.closest('li');
    if (!box.length) box = heading.parent();
    for (let up = 0; up < 3 && !ET_DATE.test(box.text()); up++) box = box.parent();

    const lines = box.text().split('\n').map(clean).filter(Boolean);
    const dateIdx = lines.findIndex((l) => ET_DATE.test(l));
    if (dateIdx === -1) return;

    const date = parseNumericDate(lines[dateIdx].match(ET_DATE).slice(2).join('.'));
    if (!date) return;

    const nameIdx = lines.findIndex((l) => l === name);
    const location = nameIdx > dateIdx + 1 ? lines[dateIdx + 1] : null;
    const distances =
      nameIdx !== -1 && lines.length > nameIdx + 1
        ? lines.slice(nameIdx + 1).join(', ').split(',').map(clean)
            .filter((d) => d && d.length < 60 && d !== name)
            .slice(0, 12)
        : [];

    const sport =
      box.find('img[title]').first().attr('title') ||
      box.find('img[alt]').first().attr('alt') || null;

    events.push({
      pageUrl: href.endsWith('/') ? href : href + '/',
      name,
      date,
      location,
      sport: sport ? clean(sport) : null,
      distances,
    });
  });

  return events;
}

/**
 * Avab urituse lehe ja vaatab, millised sakid tal tegelikult on.
 * Tagastab { results, startlist, organiser } — puuduvad on null.
 */
async function fetchDetail(pageUrl, fixtureName) {
  const html = await fetchHtml(pageUrl, fixtureName);
  const $ = cheerio.load(html);

  const hrefs = [...new Set(
    $('a[href]').map((_, a) => absoluteUrl($(a).attr('href'), BASE)).get().filter(Boolean)
  )];

  // Sakk peab algama urituse enda aadressiga — muidu tabaks uldist
  // /ee/et/tulemused menuulinki, mis ei vii kuhugi konkreetsesse kohta.
  const tab = (suffix) =>
    hrefs.find((h) => h.startsWith(pageUrl) && new RegExp(`/${suffix}/?$`).test(h)) || null;

  const organiser =
    hrefs.find(
      (h) =>
        !h.includes('sportos.eu') &&
        !h.includes('facebook.com') &&
        !h.startsWith('mailto:') &&
        /^https?:/.test(h)
    ) || null;

  return { results: tab('tulemused'), startlist: tab('stardinimekirjad'), organiser };
}

export default {
  id: 'sportos',
  label: 'Sportos',
  async fetchEvents() {
    const listing = [];

    for (let page = 0; page < PAGES; page++) {
      const html = await fetchHtml(`${BASE}/ee/et/tulemused?page=${page}`, `sportos-tulemused-${page}`);
      const found = parseListing(html);
      listing.push(...found);
      if (!found.length) break;
      await sleep(800);
    }

    try {
      const html = await fetchHtml(`${BASE}/ee/et/voistluskalender`, 'sportos-kalender');
      listing.push(...parseListing(html));
    } catch (err) {
      console.warn(`  [sportos] kalender ebaonnestus: ${err.message}`);
    }

    // Duplikaadid ara, enne kui hakkame lehti avama.
    const seen = new Set();
    const unique = listing.filter((e) => {
      const key = `${e.pageUrl}|${e.date}`;
      return !seen.has(key) && seen.add(key);
    });

    if (SKIP_DETAILS) {
      console.log(`  (--no-details: ${unique.length} kirjet ilma tulemuste linkideta)`);
      return unique.map((e) => toEvent(e, { results: null, startlist: null, organiser: null }));
    }

    console.log(`  ${unique.length} uritust, avan igauhe lehe...`);
    const events = [];
    let withResults = 0;

    for (const [i, e] of unique.entries()) {
      try {
        const links = await fetchDetail(e.pageUrl, i < 2 ? `sportos-detail-${i}` : null);
        if (links.results) withResults++;
        events.push(toEvent(e, links));
      } catch (err) {
        console.warn(`    ! ${e.name}: ${err.message}`);
        events.push(toEvent(e, { results: null, startlist: null, organiser: null }));
      }
      if ((i + 1) % 25 === 0) console.log(`    ${i + 1}/${unique.length}`);
      await sleep(DETAIL_DELAY);
    }

    console.log(`  tulemused olemas: ${withResults}/${events.length}`);
    return events;
  },
};

function toEvent(e, links) {
  return {
    source: 'sportos',
    sourceId: e.pageUrl.replace(/\/$/, '').split('/').pop(),
    name: e.name,
    date: e.date,
    location: e.location,
    sport: e.sport,
    distanceCount: e.distances.length || 1,
    distances: e.distances,
    links: {
      results: links.results,
      startlist: links.startlist,
      live: null,
      organiser: links.organiser,
      info: e.pageUrl,
    },
  };
}
