// timing.ee — ABC ajavõtt. Ratas, jooks, triatlon, rulluisk.
//
// Kogu nimekiri on uhel lehel ja HTML on erakordselt korralik:
//
//   <article class="competition" data-competition-date="2026-08-10"
//                                data-is-upcoming="0">
//     <h3 class="competition-title">URUMARJA 38. VELOTUUR</h3>
//     <span class="tag tag-loc">Urumarja</span>
//     <div class="distances">
//       ... public_participants.php?event=131&distance_id=724   (osalejad)
//       ... live_results.php?event=131&distance_id=724          (tulemused)
//       ... official_results_pdf.php?event=131&distance_id=724  (PDF)
//     </div>
//   </article>
//
// Kuupaev on juba ISO-kujul atribuudis — midagi ei ole vaja parsida.
//
// Tulemuste lingiks votame live_results: see on veebileht, mis toimib nii
// voistluse ajal kui parast. PDF on ametlik, aga mobiilis vaevaline.

import * as cheerio from 'cheerio';
import { fetchHtml, absoluteUrl, clean } from '../lib.mjs';

const BASE = 'https://timing.ee';

// Autovoistlused siia lehele ei kuulu.
const DROP = /porsche|võidusõit|ringrada|\bkart\b/i;

export default {
  id: 'timing',
  label: 'timing.ee',
  async fetchEvents() {
    const html = await fetchHtml(`${BASE}/`, 'timing-index');
    const $ = cheerio.load(html);
    const events = [];

    $('article.competition').each((_, el) => {
      const box = $(el);

      const date = clean(box.attr('data-competition-date'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

      const name = clean(box.find('.competition-title').first().text());
      if (!name || name.length < 4 || DROP.test(name)) return;

      const location = clean(box.find('.tag-loc').first().text()) || null;

      // Lingid elavad distantside plokis. Registreerimislink sisaldab samuti
      // "event=", seepArast otsime failinime jargi, mitte parameetri jargi.
      const links = box
        .find('a[href]')
        .map((__, a) => absoluteUrl($(a).attr('href'), BASE))
        .get()
        .filter(Boolean);

      const pick = (file) => links.find((u) => u.includes(file)) || null;
      const results = pick('live_results.php');
      const pdf = pick('official_results_pdf.php');
      const startlist = pick('public_participants.php');

      if (!results && !pdf && !startlist) return;

      const upcoming = box.attr('data-is-upcoming') === '1';
      const isToday = date === new Date().toISOString().slice(0, 10);

      const distances = box
        .find('.distances .distance-title, .distances h4, .distance-name')
        .map((__, d) => clean($(d).text()))
        .get()
        .filter(Boolean)
        .slice(0, 12);

      const eventId = (links.find((u) => /event=\d+/.test(u)) || '').match(/event=(\d+)/);

      events.push({
        source: 'timing',
        sourceId: eventId ? eventId[1] : `${date}-${name.replace(/\W+/g, '-').toLowerCase()}`,
        name,
        date,
        location,
        sport: null,
        distanceCount: new Set(
          links.map((u) => (u.match(/distance_id=(\d+)/) || [])[1]).filter(Boolean)
        ).size || 1,
        distances,
        links: {
          // Tulevasel voistlusel ei ole tulemusi, isegi kui link on olemas.
          results: upcoming ? null : results || pdf,
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
