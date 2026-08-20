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

// "Pühajärve" -> "puhajarve". Ilma selleta ei klapiks eestikeelsed nimed
// kunagi lehtedel, kus tapitahed on teisiti kodeeritud.
const fold = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Link peab ka VALJA NAGEMA tulemuste lingina. Ilma selleta nopib resolver
// ules suvalise ajavotja alamdomeeni (nt organizer.sportos.eu) ja paneb selle
// "Results" nupu taha.
const RESULT_URL = /results?|tulemus|protokoll|RId=/i;

// Registreerimis- ja korraldajakeskkonnad EI OLE tulemused.
const NOT_RESULTS = /organizer\.|iseteenindus\.|registreeri|registreeru|registration|\/shop/i;
// Korraldaja leht on BOONUS, mitte allikas. Siin on ebaonnestumine tavaline —
// pooled lingid on surnud kodulehed voi Facebooki grupid. Kolm katset x 30 s
// tahendaks, et uks surnud leht sooks poolteist minutit; sadade kaupa laheks
// see tundideks. Allikatele jaab korduskatse alles, siia mitte.
const TIMEOUT = 12000;
const TRIES = 1;
const DELAY = 500;

// Tosta seda numbrit, kui findResultLink() loogika muutub.
// v2: sarjade eristamine nime jargi + noue, et link naeks valja tulemuste lingina
// v3: pikem timeout + kordusparing + sarja tuvastus lahima pealkirja jargi
// v4: PARANDUS — fold() oli kasutusel, aga defineerimata. Iga findResultLink()
//     kutse viskas ReferenceErrori, mille try/catch vaikselt alla neelas.
//     Seetottu leidis resolver alates v2-st peaaegu mitte midagi.
// v5: ei arva enam aadressi ara, vaid JARGIB LINKI, mille tekstis seisab
//     "tulemused" / "protokollid" / "edetabelid". Lisaks votame vastu ka
//     korraldaja enda lehel oleva protokolli, kui kuupaev klapib.
const RESOLVER_VERSION = 5;

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

// SILT, MILLE TAHA KORRALDAJA TULEMUSED PEIDAB
//
// Moodetud 20.08.2026: 68 korraldajast 32-l on esilehel link, mille NAHTAVAS
// tekstis seisab uks neist sonadest. Aadressid ise on igauhel omad —
// laanesport.ee peidab protokollid /ala/koik-alad/ taha, mida ukski
// aramismise-reegel ei taba. Aga link, millele INIMENE vajutaks, kannab silti.
const RESULT_LABEL = /tulemus|protokoll|result|edetabel/i;

// Mitu sellist lehte uhe korraldaja kohta labi kaime. Rohkem ei tasu: iga
// leht on eraldi paring ja korraldajaid on sadu.
const MAX_JARGI = 3;

/**
 * Lehelt lingid, mille TEKST lubab tulemusi. Luhem silt enne — "Tulemused"
 * on tapsem kui "Voistluste juhendid ja tulemused ning muu info".
 */
function tulemusteLehed(html, pageUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href]').each((_, a) => {
    const el = $(a);
    const tekst = clean(el.text());
    if (!tekst || tekst.length > 60 || !RESULT_LABEL.test(tekst)) return;
    const href = absoluteUrl(el.attr('href'), pageUrl);
    if (!href || /^(mailto|tel|javascript)/i.test(href)) return;
    if (NOT_RESULTS.test(href)) return;
    out.push({ tekst, url: href });
  });
  out.sort((a, b) => a.tekst.length - b.tekst.length);
  const nahtud = new Set();
  return out.filter((x) => !nahtud.has(x.url) && nahtud.add(x.url)).slice(0, MAX_JARGI);
}

/**
 * KORRALDAJA ENDA LEHEL OLEV PROTOKOLL.
 *
 * findResultLink() votab vastu ainult ajavotjate domeene. See on oige, kui
 * tulemused ON ajavotja juures — aga Laanela, Kohila ja veel kolmkummend
 * korraldajat hoiavad protokolle oma lehel, sageli PDF-ina. Neid ei tohi
 * pimesi vastu votta: leht on protokolle tais ja vale aasta oma on halvem
 * kui puuduv link.
 *
 * Seetottu on nou range: lingi tekst voi tema lahim pealkiri peab sisaldama
 * voistluse KUUPAEVA. Nime jargi uksi me ei votagi — "Haapsalu sork" esineb
 * seal kahekumnel real, igauhel oma kuupaev.
 */
function findOwnResults(html, pageUrl, event) {
  const $ = cheerio.load(html);
  const accepted = dateKeys(event.date);
  const aasta = event.date.slice(0, 4);
  const leiud = [];

  $('a[href]').each((_, a) => {
    const el = $(a);
    const href = absoluteUrl(el.attr('href'), pageUrl);
    if (!href || /^(mailto|tel|javascript)/i.test(href)) return;
    if (NOT_RESULTS.test(href)) return;

    const tekst = clean(el.text());
    const ymbrus = `${tekst} ${nearestHeading($, el)}`;

    // AASTA VETO. Kui tekstis on aastaarv ja see EI OLE meie oma, siis see
    // link kuulub teisele hooajale — ukskoik kui hasti paev ja kuu klapivad.
    // Ilma selleta oleks "Haapsalu sork #6 04.01.2026" lainud 2025. aasta
    // voistluse kulge, sest "4.01" klappis. Just seda viga me mujal parasid.
    const aastad = ymbrus.match(/\b(?:19|20)\d{2}\b/g) || [];
    if (aastad.length && !aastad.includes(aasta)) return;

    const ctx = anchorDate($, el);
    const kp = Boolean(ctx.date && accepted.includes(ctx.date));
    const meieAasta = aastad.includes(aasta);
    if (!kp && !meieAasta) return;

    leiud.push({ url: href, text: tekst, date: ctx.date || null, stage: null,
      context: ymbrus, kp });
  });

  if (!leiud.length) return null;

  // Kuupaevaga tabamus voidab. Kui neid on tapselt uks, on ta meie oma.
  const tapsed = leiud.filter((l) => l.kp);
  if (tapsed.length === 1) return tapsed[0];
  if (tapsed.length > 1) return null;      // mitu sama kuupaevaga = ei tea

  // Kuupaeva ei olnud kuskil, aga aasta klappis ja kandidaate on tapselt uks.
  return leiud.length === 1 ? leiud[0] : null;
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
 * Millise SARJA all see link seisab.
 *
 * Varem votsin lihtsalt kuue taseme jagu umbritsevat teksti — aga
 * spordisarjad.ee hoiab kuut sarja uhel lehel ja lai tekst laks naabersarja
 * peale ule. Nuud otsime lahima EELNEVA pealkirja dokumendi jarjekorras:
 * see on tapselt see sari, mille alla link kuulub.
 */
function nearestHeading($, el) {
  let node = el;
  for (let up = 0; up < 8; up++) {
    const h = node.prevAll('h1,h2,h3,h4,h5').first();
    if (h && h.length) return fold(clean(h.text()));
    node = node.parent();
    if (!node || !node.length || node.is('body')) break;
  }
  return '';
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

    timerLinks.push({
      url: href,
      text: clean(el.text()),
      date: ctx.date,
      stage: stagePage($, ctx.box, pageUrl),
      context: nearestHeading($, el),
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
// AJAEELARVE
//
// Resolver kusib korraldajate lehti ukshaaval, iga paring kuni 12 sekundit
// pluss viivitus. Kui RESOLVER_VERSION touseb, muutuvad koik vanad vastused
// kehtetuks — 20.08.2026 tahendas see 4400 uuesti kusimist ehk ligi KAKS
// TUNDI. Ma ei arvestanud sellega ja Eva joosk seisis tunni.
//
// Nuud on seatud eelarve. Kui aeg saab tais, lopetame korralikult: seni
// leitu jaab alles, vahemalu salvestatakse ja ulejaanud proovitakse
// JARGMISEL JOOKSUL. Vastused kogunevad ooude kaupa ja uhelgi ool ei
// pea keegi tundi ootama — ei meie ega korraldajate serverid.
//
// --resolve-koik votab eelarve maha, kui tahad korraga labi kaia.
const EELARVE_MS = process.argv.includes('--resolve-koik')
  ? Infinity
  : Number(process.env.RESOLVE_EELARVE_MIN || 10) * 60000;

export async function resolveMissing(events, { limit = 4000 } = {}) {
  const targets = events.filter(
    (e) => !e.sources.some((s) => s.links.results) && e.sources.some((s) => s.links.organiser)
  );

  await loadCache();
  console.log(`\n[resolve] ${targets.length} voistlust ilma tulemusteta, proovin korraldaja lehti...`);

  let found = 0;
  let fromCache = 0;
  const cache = new Map(); // laetud HTML uhe jooksu jooksul

  const algus = Date.now();
  let poolik = 0;

  for (const [i, event] of targets.slice(0, limit).entries()) {
    if (Date.now() - algus > EELARVE_MS) {
      poolik = Math.min(targets.length, limit) - i;
      console.log(`[resolve] ajaeelarve täis — ${poolik} võistlust jääb järgmisele jooksule`);
      break;
    }
    const organiser = event.sources.find((s) => s.links.organiser).links.organiser;

    // Facebook ja Instagram ei anna meile midagi.
    if (/facebook\.com|instagram\.com/i.test(organiser)) continue;

    // Kord leitud vastus ei muutu — ka "ei leidnud" on vastus.
    //
    // NB: votmes on VERSIOONINUMBER. Kui ma resolveri loogikat parandan,
    // tostan seda numbrit ja koik vanad vastused — sh eitavad — muutuvad
    // kehtetuks. Ilma selleta ei jouaks parandus kunagi nende voistlusteni,
    // mille kohta vana loogika juba "ei leidnud" utles.
    const key = `resolve${RESOLVER_VERSION}|${organiser}|${event.date}`;
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
      // KAKS ASTET.
      //
      // 1. Arvatavad aadressid — kiire ja tootab seal, kus korraldaja on
      //    tavaline. Jaab alles, sest ta ei maksa midagi.
      // 2. Kui need ei anna midagi, JARGIME LINKI lingi teksti jargi.
      //    Just siin oli senine kood pime: laanesport.ee peidab protokollid
      //    /ala/koik-alad/ taha, kohilasport.ee omal aadressil jne. Iga
      //    korraldaja on eri moodi ja ara arvata ei saa — aga silt on sama.
      const base = organiser.replace(/\/+$/, '');
      let hit = null;

      const lae = async (url) => {
        let html = cache.get(url);
        if (html === undefined) {
          html = await fetchHtml(url, null, { timeoutMs: TIMEOUT, tries: TRIES })
            .catch(() => null);
          cache.set(url, html);
          await sleep(DELAY);
        }
        return html;
      };

      const avaHtml = await lae(organiser);

      for (const url of [`${base}/tulemused`, organiser, `${base}/results`]) {
        const html = url === organiser ? avaHtml : await lae(url);
        if (!html) continue;
        hit = findResultLink(html, url, event);
        if (hit) break;
      }

      // 2. aste: jargi silti.
      if (!hit && avaHtml) {
        for (const kandidaat of tulemusteLehed(avaHtml, organiser)) {
          const html = await lae(kandidaat.url);
          if (!html) continue;

          // Esmalt ajavotja link — see on alati parem, sest viib
          // protokollini, mida keegi teine haldab ja mis ei kolli.
          hit = findResultLink(html, kandidaat.url, event);
          if (hit) break;

          // Alles siis korraldaja enda protokoll, ja ainult siis, kui
          // kuupaev klapib. Vt findOwnResults() kommentaari.
          hit = findOwnResults(html, kandidaat.url, event);
          if (hit) break;
        }
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
    } catch (err) {
      // Vaikne allaneelamine peitis pikalt paris vea (fold defineerimata).
      // Nuud kaib teade valja — uks kord, et logi ule ei ujutaks.
      if (!resolveMissing._warned) {
        console.warn(`  [resolve] VIGA: ${err.message}`);
        resolveMissing._warned = true;
      }
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${Math.min(targets.length, limit)} (leitud ${found}, vahemalust ${fromCache})`);
      await saveCache();
    }
  }

  await saveCache();
  console.log(`[resolve] leidsin tulemuste lingi ${found} voistlusele (vahemalust ${fromCache})` +
    (poolik ? `, ${poolik} jäi järgmisele jooksule` : ''));
  return found;
}
