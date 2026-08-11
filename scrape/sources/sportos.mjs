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
import { loadCache, saveCache, get as cacheGet, put as cachePut } from '../cache.mjs';

const BASE = 'https://www.sportos.eu';

// --deep laeb kogu arhiivi (289 lehekulge, ~11 500 uritust). Seda tehakse
// UKS KORD; edaspidi piisab varskest otsast, sest ulejaanu on vahemalus.
const DEEP = process.argv.includes('--deep');
const PAGES = DEEP ? 300 : 8;

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

    // Sportos naitab nimekirjas ainult paeva ja kuud: "T 11.08".
    // Aasta paneme hiljem paika, jarjekorra pohjal — vaata assignYears().
    const dm = lines[dateIdx].match(ET_DATE);
    const day = Number(dm[2]);
    const month = Number(dm[3]);
    const explicitYear = dm[4] ? Number(dm[4]) : null;
    if (!day || !month || month > 12 || day > 31) return;

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
      day,
      month,
      explicitYear,
      date: null, // taidetakse assignYears() abil
      location,
      sport: sport ? clean(sport) : null,
      distances,
    });
  });

  return events;
}

/**
 * Paneb aastad paika nimekirja jarjekorra pohjal.
 *
 * Sportose tulemuste nimekiri on rangelt uuemast vanemani ja kuupaeval ei ole
 * aastat. Seega: alustame teadaolevast aastast ja iga kord, kui kuupaev huppab
 * jarsult ETTEPOOLE (nt 03.01 -> 28.12), oleme labinud aastavahetuse.
 *
 * Vaike edasiminek (paar paeva) on tavaline mura sama paeva urituste vahel,
 * seepArast noaame vahemalt 45 paeva hupet. Nii ei nihuta uks kohatu rida
 * kogu ulejaanud arhiivi aasta vorra valeks.
 */
function assignYears(rows, startYear) {
  let year = startYear;
  let prev = null; // eelmise rea ligikaudne paev aastas

  for (const row of rows) {
    if (row.explicitYear) {
      year = row.explicitYear;
    } else {
      const doy = row.month * 31 + row.day;
      if (prev !== null && doy > prev + 45) year -= 1;
      prev = doy;
    }
    row.date = `${year}-${String(row.month).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`;
  }
  return rows;
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
    // Arhiiv: leheküljed jarjekorras, uuemast vanemani. Jarjekord ON tahtis —
    // just selle pealt tuletame aastad.
    const archive = [];
    for (let page = 0; page < PAGES; page++) {
      const html = await fetchHtml(`${BASE}/ee/et/tulemused?page=${page}`, `sportos-tulemused-${page}`);
      const found = parseListing(html);
      archive.push(...found);
      if (!found.length) break;
      if (page % 10 === 0 && page) console.log(`    lehekulg ${page}, kokku ${archive.length} kirjet`);
      await sleep(800);
    }
    assignYears(archive, new Date().getFullYear());

    // Kalender on tulevik ja koik kirjed on kaesolevast voi jargmisest aastast.
    // Seda EI TOHI arhiiviga samasse jarjestusse panna — ta laheks vastupidi.
    const upcoming = [];
    try {
      const html = await fetchHtml(`${BASE}/ee/et/voistluskalender`, 'sportos-kalender');
      const rows = parseListing(html);
      const now = new Date();
      for (const row of rows) {
        const guess = new Date(Date.UTC(now.getFullYear(), row.month - 1, row.day));
        // Kui kuupaev jai juba moodunud aastasse, on tegu jargmise aastaga.
        const year = guess < now && (now - guess) / 86400000 > 60
          ? now.getFullYear() + 1
          : now.getFullYear();
        row.date = `${year}-${String(row.month).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`;
        upcoming.push(row);
      }
    } catch (err) {
      console.warn(`  [sportos] kalender ebaonnestus: ${err.message}`);
    }

    const listing = [...archive, ...upcoming];
    const spread = [...new Set(listing.map((e) => e.date.slice(0, 4)))].sort();
    console.log(`  aastad nimekirjas: ${spread[0]} - ${spread[spread.length - 1]}`);

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

    await loadCache();
    console.log(`  ${unique.length} uritust, avan lehed (vahemalus juba olemas: kontrollin)...`);

    const events = [];
    let withResults = 0;
    let fromCache = 0;
    let fetched = 0;

    for (const [i, e] of unique.entries()) {
      const cached = cacheGet(e.pageUrl, e.date);
      let links;

      if (cached) {
        links = cached;
        fromCache++;
      } else {
        try {
          links = await fetchDetail(e.pageUrl, null);
          cachePut(e.pageUrl, links);
          fetched++;
          await sleep(DETAIL_DELAY);
        } catch (err) {
          console.warn(`    ! ${e.name}: ${err.message}`);
          links = { results: null, startlist: null, organiser: null };
        }
      }

      if (links.results) withResults++;
      events.push(toEvent(e, links));

      if ((i + 1) % 250 === 0) {
        console.log(`    ${i + 1}/${unique.length}  (vahemalust ${fromCache}, laetud ${fetched})`);
        await saveCache(); // et pikk jooks ei laheks katkestusel kaotsi
      }
    }

    await saveCache();
    console.log(`  vahemalust ${fromCache}, uusi laetud ${fetched}`);
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
