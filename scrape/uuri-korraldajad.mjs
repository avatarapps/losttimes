// MÕÕTMINE: kas korraldaja lehelt leiab tulemused lingi teksti järgi?
//
// MIKS
// 2026. aastal on toimunud 397 võistlust, millest 159-l ei ole tulemuste
// linki. Korraldajaid on 67 ja ühtki suurt kobarat ei ole — suurim on
// laanesport.ee 11 võistlusega.
//
// Praegune resolver proovib ära arvata kolme aadressi:
//     <domeen>/tulemused   <domeen>   <domeen>/results
// Tulemus: 12 103 katset, 133 leidu. Edukus 1,1%.
//
// Läänela tulemused elavad aadressil /ala/koik-alad/ ja /voistlus/ — ükski
// kolmest ei taba. Hüpotees on, et enamikul on tulemuste leht OLEMAS, aga
// omal aadressil, ja et esilehelt viib sinna link, mille TEKSTIS seisab
// "tulemused" või "protokollid". Nii teeks inimene.
//
// SEE SKRIPT EI MUUDA MIDAGI. Ta ainult loeb ja loendab. Vastuse põhjal
// otsustame, kas resolverit tasub ümber ehitada.
//
// KASUTUS:  node scrape/uuri-korraldajad.mjs
//
// Kestab paar minutit — 67 päringut, sekund vahet, et korraldajate
// servereid mitte koormata.

import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { fetchHtml, sleep } from './lib.mjs';

const VIIDE = /tulemus|protokoll|result|edetabel/i;
const PAUS = 1000;

const oma = (u) => !u || u.includes('losttimes.ee') || u.startsWith('/');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

// --- 1. Millistel võistlustel tulemused puuduvad? -------------------------

const meta = JSON.parse(fs.readFileSync('site/index.json', 'utf8'));
const koik = [];
for (const y of meta.years.map((x) => x.year)) {
  koik.push(...JSON.parse(fs.readFileSync(`site/events-${y}.json`, 'utf8')));
}

const tana = new Date().toISOString().slice(0, 10);
const aasta = String(new Date().getFullYear());
const puudu = koik.filter((e) =>
  e.date.startsWith(aasta) && e.date <= tana &&
  !e.sources.some((s) => !oma(s.links.results)));

// Domeen -> võistlused
const domeenid = new Map();
for (const e of puudu) {
  const o = e.sources.map((s) => s.links.organiser).find((x) => !oma(x));
  if (!o) continue;
  const h = host(o);
  if (!h) continue;
  if (!domeenid.has(h)) domeenid.set(h, { url: o, sündmused: [] });
  domeenid.get(h).sündmused.push(e);
}

const jarjestus = [...domeenid.entries()].sort((a, b) => b[1].sündmused.length - a[1].sündmused.length);

console.log(`${puudu.length} võistlust ilma tulemusteta, ${jarjestus.length} korraldajat\n`);
console.log('domeen                          võistlusi  tulemuste link esilehelt');
console.log('─'.repeat(78));

// --- 2. Iga domeeni esilehelt otsime tulemuste-linki ----------------------

let leitud = 0, katmata = 0, katki = 0;
const raport = [];

for (const [domeen, info] of jarjestus) {
  const n = info.sündmused.length;
  let rida;

  try {
    const html = await fetchHtml(`https://${domeen}/`, null, { timeoutMs: 15000, tries: 1 });
    const $ = cheerio.load(html);

    // Kõik lingid, mille NÄHTAVAS tekstis on tulemustele viitav sõna.
    // Teksti järgi, mitte aadressi järgi: aadress võib olla ükskõik mis
    // (/ala/koik-alad/), aga link, millele inimene vajutaks, kannab silti.
    const kandidaadid = [];
    $('a').each((_, a) => {
      const tekst = $(a).text().replace(/\s+/g, ' ').trim();
      const href = $(a).attr('href');
      if (!href || !tekst || tekst.length > 60) return;
      if (!VIIDE.test(tekst)) return;
      try { kandidaadid.push({ tekst, url: new URL(href, `https://${domeen}/`).href }); } catch {}
    });

    // Eelistame lühemat silti — "Tulemused" on täpsem kui
    // "Võistluste juhendid ja tulemused ning muu info".
    kandidaadid.sort((a, b) => a.tekst.length - b.tekst.length);
    const parim = kandidaadid[0];

    if (parim) {
      leitud++;
      rida = `JAH  "${parim.tekst}" → ${parim.url}`;
      raport.push({ domeen, n, staatus: 'leitud', link: parim.url, silt: parim.tekst });
    } else {
      katmata++;
      rida = 'ei leidnud tulemustele viitavat linki';
      raport.push({ domeen, n, staatus: 'puudub' });
    }
  } catch (err) {
    katki++;
    rida = `LEHT EI VASTA (${err.message.slice(0, 30)})`;
    raport.push({ domeen, n, staatus: 'katki' });
  }

  console.log(`${domeen.slice(0, 30).padEnd(32)}${String(n).padStart(5)}     ${rida}`);
  await sleep(PAUS);
}

// --- 3. Kokkuvõte --------------------------------------------------------

const kokku = jarjestus.length;
const kaetud = raport.filter((r) => r.staatus === 'leitud').reduce((s, r) => s + r.n, 0);

console.log('\n' + '─'.repeat(78));
console.log(`korraldajaid                    ${kokku}`);
console.log(`  tulemuste link leitud         ${leitud}  (${Math.round(leitud / kokku * 100)}%)`);
console.log(`  linki ei leidnud              ${katmata}`);
console.log(`  leht ei vastanud              ${katki}`);
console.log('');
console.log(`võistlusi, mille korraldajal on tulemuste leht: ${kaetud} / ${puudu.length}` +
  `  (${Math.round(kaetud / puudu.length * 100)}%)`);
console.log('');
console.log('OTSUS: kui see protsent on üle 50, tasub resolver ümber ehitada');
console.log('       lingi teksti järgi otsivaks. Kui alla, siis mitte.');

fs.writeFileSync('data/korraldajad-raport.json', JSON.stringify(raport, null, 1));
console.log('\nTäpsem raport: data/korraldajad-raport.json');
