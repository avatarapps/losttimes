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
import { loadCache, saveCache, get as cacheGet, put as cachePut } from './cache.mjs';

// AINULT paris ajavotjate domeenid. Varem oli siin ka sona "tulemused",
// mis tahendas, et korraldaja enda uldine /tulemused leht voitis otselinkide
// ule — ja kasutaja sattus etappide nimekirja, mitte oma voistluse tulemustesse.
const TIMER_DOMAINS = /racetecresults\.com|championchip\.ee|sportos\.eu|estoloppet\.ee|antrotsenter\.ee|raceresult\.com|timing\.ee|sporttiming|tulemused\.ee/i;
const RESULT_WORD = /tulemus|result|protokoll/i;
const DATE_TOKEN = /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/g;

// Link peab ka VALJA NAGEMA tulemuste lingina. Ilma selleta nopib resolver
// ules suvalise ajavotja alamdomeeni (nt organizer.sportos.eu) ja paneb selle
// "Results" nupu taha.
const RESULT_URL = /results?|tulemus|protokoll|RId=/i;

// Registreerimis- ja korraldajakeskkonnad EI OLE tulemused.
const NOT_RESULTS = /organizer\.|iseteenindus\.|registreeru|registration|\/shop/i;
const TIMEOUT = 8000;   // aeglane korraldaja leht ei tohi kogu tood kinni panna
const DELAY = 500;

/** "2026-08-13" -> "13.08" */
function dateKey(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}.${String(m).padStart(2, '0')}`;
}

/**
 * Lubatud kuupaevad: pais- ja jarelpaev kaasa.
 * Sportos utleb Filter Temposari 6. etapi kohta 12.08, korraldaja enda leht
 * utleb 13.08. Uks neist eksib, aga meie ei tea kumb — ja etapid on nadalase
 * vahega, nii et uhe paeva luhk ei saa vale etapi peale sattuda.
 */
function dateKeys(iso) {
  const base = new Date(iso + 'T12:00:00');
  return [-1, 0, 1].map((shift) => {
    const d = new Date(base);
    d.setDate(d.getDate() + shift);
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

/**
 * Leiab lingi juurde kuuluva kuupaeva.
 *
 * Korraldajate lehtedel on etapid tuupiliselt sellises pesas:
 *   <div>Tallinn 13.08 <a>Tulemused</a></div>
 * ehk kuupaev ei ole lingi enda sees, vaid uks-kaks taset ulevalpool.
 *
 * Laheme ulespoole seni, kuni leiame taseme, kus on TAPSELT UKS kuupaev.
 * Kui tasemel on mitu kuupaeva, oleme laineud liiga laiaks (naeme juba kogu
 * etappide nimekirja) ja siis me ei tea enam, milline neist selle lingi oma on.
 */
function anchorDate($, el) {
  let node = el;
  for (let level = 0; level < 4; level++) {
    node = node.parent();
    if (!node || !node.length) break;

    const text = clean(node.text());
    const found = [...text.matchAll(DATE_TOKEN)].map(
      (m) => `${Number(m[1])}.${String(Number(m[2])).padStart(2, '0')}`
    );
    const unique = [...new Set(found)];

    if (unique.length === 1) return { date: unique[0], box: node };
    if (unique.length > 1) return { date: null, box: null }; // liiga lai kontekst
  }
  return { date: null, box: null };
}

/**
 * Sama ploki seest, kus oli tulemuste link, otsime ka korraldaja enda
 * etapilehe — nt spordisarjad.ee/temposari/etapp/tallinn. See on tapselt see
 * leht, mida inimene tahab, kui ta voistluse nimele klikib.
 */
function stagePage($, box, pageUrl) {
  if (!box || !box.length) return null;
  const host = new URL(pageUrl).hostname;

  let found = null;
  box.find('a[href]').each((_, a) => {
    if (found) return;
    const href = absoluteUrl($(a).attr('href'), pageUrl);
    if (!href) return;
    try {
      if (new URL(href).hostname !== host) return;
    } catch {
      return;
    }
    if (RESULT_WORD.test(href) || NOT_RESULTS.test(href)) return;
    if (href.replace(/\/$/, '') === pageUrl.replace(/\/$/, '')) return;
    found = href;
  });
  return found;
}

/**
 * Otsib lehelt tulemuste lingi. Votab ainult siis, kui on KINDEL:
 * kas kuupaev klapib, voi lehel on tapselt uks ajavotja link.
 */
function findResultLink(html, pageUrl, event) {
  const $ = cheerio.load(html);
  const want = dateKey(event.date);
  const accepted = dateKeys(event.date);
  const timerLinks = [];

  $('a[href]').each((_, a) => {
    const el = $(a);
    const href = absoluteUrl(el.attr('href'), pageUrl);
    if (!href || /^(mailto|tel|javascript)/i.test(href)) return;
    if (!TIMER_DOMAINS.test(href)) return;
    if (NOT_RESULTS.test(href)) return;
    if (!RESULT_URL.test(href)) return;

    const ctx = anchorDate($, el);

    // Laiem umbrus, et teada saada, MILLISE SARJA all see link on.
    // spordisarjad.ee/tulemused hoiab kuut sarja uhel lehel ja kahel sarjal
    // voib olla etapp samal kuupaeval — ainult kuupaevast ei piisa.
    let wide = el;
    for (let i = 0; i < 6 && wide.parent().length; i++) wide = wide.parent();

    timerLinks.push({
      url: href,
      text: clean(el.text()),
      date: ctx.date,
      stage: stagePage($, ctx.box, pageUrl),
      context: fold(wide.text()),
    });
  });

  if (!timerLinks.length) return null;

  // Voistluse nimest olulised sonad, mille jargi sarju eristada.
  const words = fold(event.name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !/^(etapp|sari|sarja|voistlus|jooks)$/.test(w));
  const sameSeries = (l) => words.length === 0 || words.some((w) => l.context.includes(w));

  // 1. Kuupaev klapib JA sari klapib — kindlaim tabamus.
  const best = timerLinks.find((l) => l.date === want && sameSeries(l));
  if (best) return best;

  // 2. Kuupaev klapib tapselt.
  const exact = timerLinks.find((l) => l.date === want);
  if (exact) return exact;

  // 3. Klapib uhe paeva luhkkiga, sari klapib.
  const nearSeries = timerLinks.find((l) => l.date && accepted.includes(l.date) && sameSeries(l));
  if (nearSeries) return nearSeries;

  // 4. Klapib uhe paeva luhkkiga.
  const near = timerLinks.find((l) => l.date && accepted.includes(l.date));
  if (near) return near;

  // 2. Kuupaeva ei leidnud kuskilt, aga lehel on ainult uks ajavotja link
  //    ja see uritus ei ole sari. Siis on see ilmselt oige.
  const distinct = [...new Set(timerLinks.map((l) => l.url))];
  if (distinct.length === 1 && timerLinks.every((l) => l.date === null)) {
    return timerLinks[0];
  }

  // 3. Mitu linki, kuupaev ei klapi ukskiga — me ei tea. Parem mitte valetada.
  return null;
}

/**
 * Kaib labi voistlused, millel tulemusi ei ole, ja proovib korraldaja lehelt.
 * Muudab events massiivi kohapeal.
 */
export async function resolveMissing(events, { limit = 4000 } = {}) {
  const targets = events.filter(
    (e) => !e.sources.some((s) => s.links.results) && e.sources.some((s) => s.links.organiser)
  );

  await loadCache();
  console.log(`\n[resolve] ${targets.length} voistlust ilma tulemusteta, proovin korraldaja lehti...`);

  let found = 0;
  let fromCache = 0;
  const cache = new Map(); // laetud HTML uhe jooksu jooksul

  for (const [i, event] of targets.slice(0, limit).entries()) {
    const organiser = event.sources.find((s) => s.links.organiser).links.organiser;

    // Facebook ja Instagram ei anna meile midagi.
    if (/facebook\.com|instagram\.com/i.test(organiser)) continue;

    // Kord leitud vastus ei muutu — ka "ei leidnud" on vastus.
    const key = `resolve|${organiser}|${event.date}`;
    const remembered = cacheGet(key, event.date);
    if (remembered) {
      fromCache++;
      if (remembered.url) {
        found++;
        event.sources.push({
          id: 'organiser',
          label: 'Korraldaja kaudu',
          links: {
            results: remembered.url,
            startlist: null,
            live: null,
            organiser,
            info: remembered.stage || null,
          },
          distanceCount: 1,
        });
      }
      continue;
    }

    try {
      // Sama sarja etapid jagavad korraldaja lehte — laeme uks kord.
      // Otselingid elavad harva esilehel — enamasti korraldaja tulemuste alalehel.
      const base = organiser.replace(/\/+$/, '');
      const pages = [`${base}/tulemused`, organiser, `${base}/results`];
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

      // Jatame meelde ka eitava vastuse, et sama lehte uuesti ei kusiks.
      cachePut(key, hit ? { url: hit.url, stage: hit.stage || null } : { url: null });

      if (hit) {
        found++;
        event.sources.push({
          id: 'organiser',
          label: 'Korraldaja kaudu',
          links: {
            results: hit.url,
            startlist: null,
            live: null,
            organiser,
            info: hit.stage || null, // korraldaja etapileht, kui leidsime
          },
          distanceCount: 1,
        });
      }
    } catch {
      // vaikselt edasi — see samm on boonus, mitte kohustus
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${Math.min(targets.length, limit)} (leitud ${found}, vahemalust ${fromCache})`);
      await saveCache();
    }
  }

  await saveCache();
  console.log(`[resolve] leidsin tulemuste lingi ${found} voistlusele (vahemalust ${fromCache})`);
  return found;
}
