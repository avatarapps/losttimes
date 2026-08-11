// Teine samm: korraldaja lehelt tulemuste lingi otsimine.
//
// MIKS: Sportos teab, et voistlus toimus, aga hoiab tulemusi ainult nende
// urituste kohta, mida ta ise ajastab (~26%). Ulejaanud ajastas keegi teine —
// enamasti TolkNet (racetecresults.com), mis on botikaitse taga ja mida me
// ise lugeda ei saa ega tohi.
//
// Aga korraldaja enda leht EI OLE kaitstud, ja seal on tulemuste link olemas.
// Nait. spordisarjad.ee/temposari/tulemused loetleb koik etapid:
//   "VIIMSI 5.08 — Tulemused"  ->  racetecresults.com/results.aspx?CId=..&RId=..
//
// Nii et me ei loe racetecresultsi kunagi ise. Me leiame ainult lingi.
//
// See ei tooeta koigi puhul: osa korraldajaid on Facebooki grupid, osa laadib
// sisu JavaScriptiga. Ebaonnestumine on ohutu — jaab endine korraldaja nupp.

import * as cheerio from 'cheerio';
import { fetchHtml, absoluteUrl, clean, sleep } from './lib.mjs';

const TIMER_DOMAINS = /racetecresults\.com|championchip\.ee|sportos\.eu|estoloppet\.ee|antrotsenter\.ee|my\.raceresult\.com|tulemused/i;
const RESULT_WORD = /tulemus|result|protokoll/i;
const TIMEOUT = 8000;   // aeglane korraldaja leht ei tohi kogu tood kinni panna
const DELAY = 500;

/** "2026-08-05" -> ["5.08", "05.08", "5.8", "05.8", "5. august"] */
function dateNeedles(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return [`${d}.${mm}`, `${dd}.${mm}`, `${d}.${m}`, `${dd}.${mm}.${y}`, `${d}.${m}.${y}`];
}

/**
 * Otsib lehelt tulemuste linki. Kui lehel on mitu etappi, valib selle,
 * mille lahedal on meie voistluse kuupaev.
 */
function findResultLink(html, pageUrl, event) {
  const $ = cheerio.load(html);
  const needles = dateNeedles(event.date);
  const candidates = [];

  $('a[href]').each((_, a) => {
    const el = $(a);
    const href = absoluteUrl(el.attr('href'), pageUrl);
    if (!href || /^(mailto|tel|javascript)/i.test(href)) return;

    const text = clean(el.text());
    const isTimerLink = TIMER_DOMAINS.test(href);
    const saysResults = RESULT_WORD.test(text) || RESULT_WORD.test(href);
    if (!isTimerLink && !saysResults) return;

    // Kontekst = lingi enda tekst + vanemelemendi tekst, kust leiame kuupaeva.
    const context = clean(text + ' ' + el.parent().text() + ' ' + el.parent().parent().text());
    const dateMatch = needles.some((n) => context.includes(n));

    candidates.push({
      url: href,
      text,
      score: (isTimerLink ? 2 : 0) + (dateMatch ? 4 : 0) + (saysResults ? 1 : 0),
    });
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);

  // Skoor alla 3 tahendab "leidsin sona tulemused, aga ei tea kas oige oma".
  // Sellisel juhul parem mitte valetada.
  return candidates[0].score >= 3 ? candidates[0] : null;
}

/**
 * Kaib labi voistlused, millel tulemusi ei ole, ja proovib korraldaja lehelt.
 * Muudab events massiivi kohapeal.
 */
export async function resolveMissing(events, { limit = 120 } = {}) {
  const targets = events.filter(
    (e) => !e.sources.some((s) => s.links.results) && e.sources.some((s) => s.links.organiser)
  );

  console.log(`\n[resolve] ${targets.length} voistlust ilma tulemusteta, proovin korraldaja lehti...`);

  let found = 0;
  const cache = new Map();

  for (const [i, event] of targets.slice(0, limit).entries()) {
    const organiser = event.sources.find((s) => s.links.organiser).links.organiser;

    // Facebook ja Instagram ei anna meile midagi.
    if (/facebook\.com|instagram\.com/i.test(organiser)) continue;

    try {
      // Sama sarja etapid jagavad korraldaja lehte — laeme uks kord.
      const pages = [organiser, organiser.replace(/\/?$/, '/tulemused')];
      let hit = null;

      for (const url of pages) {
        let html = cache.get(url);
        if (html === undefined) {
          html = await fetchHtml(url, null, { timeoutMs: TIMEOUT }).catch(() => null);
          cache.set(url, html);
          await sleep(DELAY);
        }
        if (!html) continue;

        hit = findResultLink(html, url, event);
        if (hit) break;
      }

      if (hit) {
        found++;
        event.sources.push({
          id: 'organiser',
          label: 'Korraldaja kaudu',
          links: { results: hit.url, startlist: null, live: null, organiser },
          distanceCount: 1,
        });
      }
    } catch {
      // vaikselt edasi — see samm on boonus, mitte kohustus
    }

    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${Math.min(targets.length, limit)} (leitud ${found})`);
  }

  console.log(`[resolve] leidsin tulemuste lingi ${found} voistlusele`);
  return found;
}
