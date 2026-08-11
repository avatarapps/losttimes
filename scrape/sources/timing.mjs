// timing.ee — ABC ajavõtt. Ratas, jooks, triatlon, rulluisk.
//
// Kogu nimekiri on uhel lehel ja struktuur on selge:
//
//   <h3>URUMARJA 38. VELOTUUR</h3>
//   10.08.2026 Urumarja
//   1. etapp Grupisõit ...
//     [Osavõtjad]      public_participants.php?event=131&distance_id=724
//     [Live tulemused] live_results.php?event=131&distance_id=724
//     [PDF tulemused]  official_results_pdf.php?event=131&distance_id=724
//
// Tulemuste lingiks votame live_results — see on veebileht, mis toimib nii
// voistluse ajal kui parast. PDF on ametlik, aga mobiilis vaevaline.

import * as cheerio from 'cheerio';
import { fetchHtml, absoluteUrl, clean, parseNumericDate } from '../lib.mjs';

const BASE = 'https://timing.ee';
const DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;

// Autovoistlused siia lehele ei kuulu.
const DROP = /porsche|võidusõit|ringrada|kart/i;

export default {
  id: 'timing',
  label: 'timing.ee',
  async fetchEvents() {
    const html = await fetchHtml(`${BASE}/`, 'timing-index');
    const $ = cheerio.load(html);
    const events = [];

    $('h1, h2, h3, h4').each((_, el) => {
      const heading = $(el);
      const name = clean(heading.text());
      if (!name || name.length < 4) return;
      if (/võistlused|fotofiniš|kontakt|registreer/i.test(name)) return;
      if (DROP.test(name)) return;

      // Plokk = koik kuni jargmise sama tasemega pealkirjani. Kui pealkiri ei
      // ole sisuga ode-vend, votame vanemelemendi.
      let block = heading.nextUntil(el.tagName);
      if (!block.find('a[href*="event="]').length) {
        block = heading.parent();
      }

      const links = block
        .find('a[href*="event="]')
        .map((__, a) => absoluteUrl($(a).attr('href'), BASE))
        .get();
      if (!links.length) return;

      const text = clean(block.text());
      const m = text.match(DATE);
      if (!m) return;
      const date = parseNumericDate(m[0]);
      if (!date) return;

      // Asukoht on kuupaeva jarel samas reas: "10.08.2026 Urumarja"
      const after = text.slice(text.indexOf(m[0]) + m[0].length).trim();
      const location = clean(after.split(/\s{2,}|\n|Juhend|Registreerimine/)[0]).slice(0, 60) || null;

      const pick = (needle) => links.find((u) => u.includes(needle)) || null;
      const results = pick('live_results.php');
      const pdf = pick('official_results_pdf.php');
      const startlist = pick('public_participants.php');

      if (!results && !pdf && !startlist) return;

      const eventId = (links[0].match(/event=(\d+)/) || [])[1] || name;
      const isToday = date === new Date().toISOString().slice(0, 10);

      events.push({
        source: 'timing',
        sourceId: eventId,
        name,
        date,
        location,
        sport: null,
        distanceCount: new Set(links.map((u) => (u.match(/distance_id=(\d+)/) || [])[1])).size || 1,
        distances: [],
        links: {
          results: results || pdf,
          startlist,
          live: isToday ? results : null,
          organiser: null,
          info: `${BASE}/`,
        },
      });
    });

    const seen = new Set();
    return events.filter((e) => !seen.has(e.sourceId) && seen.add(e.sourceId));
  },
};
