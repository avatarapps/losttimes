// spordisarjad.ee tulemuste lehed
//
// MIKS SEE OLEMAS ON
// Filter Temposari, Tour de Tallinn ja Rull de Tallinn ajavotja on TolkNet,
// kelle tulemused elavad racetecresults.com-is. See domeen on Cloudflare'i
// botikaitse taga ja sealt me linke ei korja — ega hakka ka moodahiilima.
//
// Aga korraldaja enda leht spordisarjad.ee/<sari>/tulemused loetleb koik
// hooajad ja iga etapi juures on OTSELINK racetecresultsi. See leht on
// tavaline staatiline HTML. Uks paring annab ~14 hooaega korraga.
//
// Ilma selleta naitas leht neil voistlustel Sportose "tulemused" aadressi,
// mis on tuhi kest: link oli olemas, aga ots oli umbes. See on halvem kui
// puuduv link — kasutaja arvab, et ta on kohal.
//
// KUIDAS ETAPP VOISTLUSEGA SEOTAKSE
// Kaks juhtu, sest leht ise on kahes vormis:
//
//  1. Pealkirjas ON kuupaev ("IV etapp 14.06.2017", "Tallinn 13.08")
//     -> seome kuupaeva jargi. Tapne, eeldusi ei ole.
//
//  2. Pealkirjas on AINULT koht ("Jüri •Eraldistart 10.3/22 km")
//     -> seome JARJEKORRA jargi: hooaja esimesena loetletud etapp on
//        meie 1. etapp jne. See on eeldus. Kontrollitud kaesitsi 2025.
//        hooajal (1. etapp = Jüri) ja 2024. hooaja RId-numbrid kasvavad
//        loetelu jarjekorras, mis toetab sama.
//
// Kui parsimine ei anna midagi, EI MUUDA me mitte midagi. Katkine parser
// ei tohi ara votta linke, mis juba tootavad.

import * as cheerio from 'cheerio';
import { fetchHtml } from './lib.mjs';

const SITE = 'https://spordisarjad.ee';

// Sari -> millise nimega voistlused meie andmetes talle vastavad.
const SERIES = [
  { slug: 'temposari', match: /^filter\s+tempos[aä]ri/i },
  { slug: 'tourdetallinn', match: /^filter\s+tour\s+de\s+tallinn/i },
];

// Link, mille me valime, kui etapil on neid mitu. Jarjekord on tahtlik:
// koigi osalejate uldprotokoll enne meeste/naiste eraldi omi.
const EELISTUS = [
  /tulemused/i,
  /absoluut/i,
  /k[oõ]ik\s+koos/i,
  /^ratas$/i,
];

function bestLink(links) {
  const rtr = links.filter((l) => /racetecresults\.com/i.test(l.href));
  for (const re of EELISTUS) {
    const hit = rtr.find((l) => re.test(l.text));
    if (hit) return hit.href;
  }
  if (rtr.length) return rtr[0].href;
  // Varuvariant: TolkNeti PDF. Vahem mugav kui tabel, aga on tulemused.
  const pdf = links.find((l) => /tolknet\.ee/i.test(l.href) && /\.pdf$/i.test(l.href));
  return pdf ? pdf.href : null;
}

// "14.06.2017" -> 2017-06-14 · "13.08" + hooaeg -> 2026-08-13
//
// Kaks louksu, molemad paris andmetest:
//  - "Jüri •Eraldistart 10.3/22 km" — "10.3" ON kujult kuupaev (10. marts),
//    aga on tegelikult distants. Seetottu vaatame ainult pealkirja OSA ENNE
//    esimest tapikest: kuupaev on seal, distantsid tulevad parast.
//  - "17 km" vms ei tohi jarelejaanud osas kuupaevaks saada, seega
//    number ei tohi olla jargneva kaldkriipsu ega numbri kulges.
function headingDate(text, year) {
  const enne = text.split(/[•·]/)[0];
  const m = enne.match(/\b(\d{1,2})\.(\d{1,2})(?:\.((?:19|20)\d{2}))?(?![\d,\/])/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dd = Number(d), mm = Number(mo);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  return `${y || year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// Uhe sarja leht -> { '2025': [{date|null, url}, ...], ... }
// Massiiv on lehe jarjekorras. Kui kuupaevi ei ole, ongi see jarjekord ainus,
// mille kaudu etappi tunda.
export function parseSeries(html) {
  const $ = cheerio.load(html);
  const hooajad = new Map();

  let year = null;
  let stage = null;

  const lisa = () => {
    if (!stage || !year) return;
    const url = bestLink(stage.links);
    if (!url) return;
    if (!hooajad.has(year)) hooajad.set(year, []);
    hooajad.get(year).push({ date: headingDate(stage.title, year), url });
  };

  // Kaime dokumendi labi jarjekorras. EI toetu klassinimedele ega
  // konkreetsele pealkirjatasemele — leht voib neid muuta, meie loogika
  // pusib niikaua, kui pealkirjad on pealkirjad ja lingid on lingid.
  $('h1, h2, h3, h4, h5, h6, a').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    if (tag === 'a') {
      const href = $(el).attr('href');
      if (stage && href) stage.links.push({ text, href: new URL(href, SITE).href });
      return;
    }

    const hooaeg = text.match(/Hooaeg\s+((?:19|20)\d{2})/i);
    if (hooaeg) {
      lisa();
      year = hooaeg[1];
      stage = null;
      return;
    }

    lisa();
    // Koondarvestus ei ole etapp — see on kogu sarja tabel.
    stage = /koondarvestus|kokkuv[oõ]te/i.test(text) || !year
      ? null
      : { title: text, links: [] };
  });
  lisa();

  return hooajad;
}

function isDeadEnd(url) {
  // Sportose "tulemused" leht on neil voistlustel tuhi kest, mitte tulemused.
  return !url || url.includes('losttimes.ee') || url.startsWith('/') ||
    /sportos\.eu/i.test(url);
}

export async function applySpordisarjad(events) {
  let seotud = 0;

  for (const sari of SERIES) {
    const url = `${SITE}/${sari.slug}/tulemused`;
    let hooajad;
    try {
      const html = await fetchHtml(url, `spordisarjad-${sari.slug}`, { timeoutMs: 20000, tries: 2 });
      hooajad = parseSeries(html);
    } catch (err) {
      console.warn(`  [spordisarjad] ${sari.slug}: ${err.message}`);
      continue;
    }
    if (!hooajad.size) {
      console.warn(`  [spordisarjad] ${sari.slug}: lehelt ei leidnud ühtegi hooaega, jätan puutumata`);
      continue;
    }

    // Meie voistlused sarja ja aasta kaupa, kuupaeva jargi kasvavalt —
    // sama jarjekord, mida leht kasutab.
    const meie = new Map();
    for (const e of events) {
      if (!sari.match.test(e.name)) continue;
      const y = e.date.slice(0, 4);
      if (!meie.has(y)) meie.set(y, []);
      meie.get(y).push(e);
    }
    for (const rows of meie.values()) rows.sort((a, b) => a.date.localeCompare(b.date));

    for (const [year, etapid] of hooajad) {
      const rows = meie.get(year);
      if (!rows) continue;

      // Kuupaevaga etapid seome tapselt; ulejaanud jarjekorra jargi.
      const kuupaevaga = etapid.filter((x) => x.date);
      const paar = kuupaevaga.length === etapid.length
        ? etapid.map((x) => [rows.find((e) => e.date === x.date), x.url])
        : etapid.map((x, i) => [rows[i], x.url]);

      // Jarjekorrasidumine on lubatud AINULT siis, kui etappide arv klapib.
      // Kui leht loetleb 6 ja meil on 5, ei tea me, milline puudu on, ja
      // vale link on halvem kui puuduv.
      if (kuupaevaga.length !== etapid.length && etapid.length !== rows.length) {
        console.warn(`  [spordisarjad] ${sari.slug} ${year}: leht annab ${etapid.length} etappi, meil on ${rows.length} — jätan sidumata`);
        continue;
      }

      for (const [e, link] of paar) {
        if (!e || !link) continue;
        const olemas = e.sources.map((s) => s.links.results).find(Boolean);
        if (!isDeadEnd(olemas)) continue;   // toimivat linki ei puutu

        e.sources.unshift({
          id: 'spordisarjad',
          label: 'TolkNet',
          links: { results: link, startlist: null, live: null, organiser: url },
          distanceCount: 0,
        });
        seotud++;
      }
    }
  }

  if (seotud) console.log(`[spordisarjad] sidusin ${seotud} võistlust otse tulemustega`);
  return events;
}
