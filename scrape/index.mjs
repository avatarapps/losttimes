// Kaivitab koik allikad, liidab tulemused kokku ja kirjutab site/ kausta.
//
//   node scrape/index.mjs                  -- tavajooks (varske ots)
//   node scrape/index.mjs --deep           -- kogu arhiiv, 1-2 tundi, uks kord
//   node scrape/index.mjs --from-raw       -- kasutab eelmise jooksu toorandmeid
//   node scrape/index.mjs --only=sportos   -- uks allikas korraga (silumiseks)
//   node scrape/index.mjs --no-resolve     -- jatab korraldaja lehed vahele
//   node scrape/index.mjs --no-details     -- Sportos ilma urituselehtedeta
//   node scrape/index.mjs --save-fixtures  -- salvestab toor-HTML-i fixtures/
//
// Valjub koodiga 1, kui moni scraper tagastas 0 kirjet. GitHub Actions
// saadab siis kirja — see on kogu monitooring, mida sul vaja on.

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error(
    `\nSinu Node.js on versioon ${process.versions.node} — see on liiga vana.\n` +
      `Vaja on vähemalt versiooni 18 (praegune LTS on veel uuem).\n\n` +
      `Lae alla: https://nodejs.org  ->  suur roheline "LTS" nupp\n` +
      `Installi ära, SULGE terminal, ava uuesti ja proovi sama käsku.\n`
  );
  process.exit(1);
}

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { normalizeName } from './lib.mjs';
import { explainFilter } from './filter.mjs';
import { resolveMissing } from './resolve.mjs';
import { buildPages } from './pages.mjs';
import { applyOverrides } from './overrides.mjs';
import { applySpordisarjad } from './spordisarjad.mjs';
import { applyRegaLinks } from './regalink.mjs';

import sportos from './sources/sportos.mjs';
import championchip from './sources/championchip.mjs';
import estoloppet from './sources/estoloppet.mjs';
import antrotsenter from './sources/antrotsenter.mjs';
import timing from './sources/timing.mjs';
import manual from './sources/manual.mjs';
import { eestimaraton, maru, rattamaratonid } from './sources/bestit.mjs';

// Jarjekord loeb: merge jatab esimesena tulnud allika lingi peale.
// Korraldaja enda susteem (BestIT) on ees, sest Sportose "tulemused"
// aadress on neil voistlustel sageli tuhi kest — link on olemas, aga
// ots on umbes.
const ALL_SOURCES = [eestimaraton, maru, rattamaratonid, sportos, championchip, estoloppet, antrotsenter, timing, manual];

// Uhe allika kaupa testimiseks:  node scrape/index.mjs --only=sportos
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : null;
const SOURCES = only ? ALL_SOURCES.filter((s) => only.split(',').includes(s.id)) : ALL_SOURCES;

if (!SOURCES.length) {
  console.error(`Tundmatu allikas: ${only}. Valikus: ${ALL_SOURCES.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

// --no-resolve jatab korraldaja lehtede kulastamise vahele (kiirem testimine).
const SKIP_RESOLVE = process.argv.includes('--no-resolve');

// --from-raw kasutab eelmise kaivituse toorandmeid ja jatab allikate
// kulastamise vahele. Kokkuliitmise silumiseks — sekundiga, mitte kahe minutiga.
const FROM_RAW = process.argv.includes('--from-raw');

// --rebuild jatab olemasoleva arhiivi arvestamata. Vaja siis, kui vanad
// kirjed on VALED (nt vale aastaga) — muidu jaaksid nad kumulatiivse
// liitmise tottu igavesti alles ja tekiksid duplikaadid.
const REBUILD = process.argv.includes('--rebuild');

// Arhiivi ei karbita — kogu ajalugu jaab alles, aastate kaupa failides.

async function main() {
  let collected = [];
  let health = [];

  if (FROM_RAW) {
    const raw = JSON.parse(await readFile('data/raw.json', 'utf8'));
    collected = raw.collected;
    health = raw.health;
    console.log(`(--from-raw: ${collected.length} toorkirjet failist data/raw.json)`);
    return finish(collected, health);
  }

  for (const source of SOURCES) {
    process.stdout.write(`\n[${source.id}]\n`);
    try {
      const events = await source.fetchEvents();
      console.log(`  ${events.length} kirjet`);
      collected.push(...events.map((e) => ({ ...e, sourceLabel: source.label })));
      health.push({
        id: source.id,
        label: source.label,
        count: events.length,
        // Kasitsi-nimekiri tohib olla tuhi. Scraper mitte — kui tema ei leia
        // midagi, on ta katki ja sellest peab teada saama.
        ok: events.length > 0 || source.optional === true,
      });
    } catch (err) {
      console.error(`  VIGA: ${err.message}`);
      health.push({ id: source.id, label: source.label, count: 0, ok: false, error: err.message });
    }
  }

  // Salvestame toorandmed ENNE kokkuliitmist. Kui liitmine kukub kokku,
  // ei pea allikaid uuesti kulastama — piisab kaivitusest --from-raw lipuga.
  await mkdir('data', { recursive: true });
  await writeFile('data/raw.json', JSON.stringify({ collected, health }));
  console.log(`\n(toorandmed salvestatud: data/raw.json)`);

  return finish(collected, health);
}

// Mitmepaevased voistlused tulevad allikatest kahe kirjena: Estoloppet annab
// vahemiku alguse, Sportos loppu. Kumulatiivne arhiiv hoiab molemat alles, sest
// kuupaev on osa id-st — nii jai "48. Alutaguse Maraton" listi kaks korda,
// 7. ja 8. veebruaril.
//
// Liidame kokku ainult siis, kui nimi on TAPSELT sama ja kuupaevade vahe on
// tapselt uks paev. Sarja etapid ("1. etapp", "2. etapp") jaavad eraldi, sest
// nende nimed erinevad. Alles jaab varasem kuupaev — voistlus algab siis.
function runKey(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[ivxlcdm]+\.?\s+/i, '')
    .replace(/^\d+\.?\s*/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function mergeMultiDay(events) {
  const byKey = new Map();
  for (const e of events) {
    const k = runKey(e.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }

  const drop = new Set();
  let merged = 0;
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i], b = group[i + 1];
      if (drop.has(a.id)) continue;
      const gap = (Date.parse(b.date) - Date.parse(a.date)) / 86400000;
      if (gap !== 1) continue;

      // Hilisema kirje allikad ja distantsid rannavad varasemasse.
      const seen = new Set(a.sources.map((s) => s.id));
      for (const s of b.sources) if (!seen.has(s.id)) a.sources.push(s);
      a.distances = [...new Set([...(a.distances || []), ...(b.distances || [])])];
      if (!a.location && b.location) a.location = b.location;
      drop.add(b.id);
      merged++;
    }
  }
  if (merged) console.log(`[mitmepaevased] liidetud ${merged} topeltkirjet`);
  return events.filter((e) => !drop.has(e.id));
}

// SAMA PAEVA DUPLIKAADID
//
// Uks voistlus tuleb kahest allikast eri nimega ja merge ei liida neid, sest
// ta vordleb tapset normaliseeritud nime:
//
//   "9. Tartu Rattamaraton"  vs  "SEB Uhispanga 9. Tartu Rattamaraton"
//   "Rapla duatlon"          vs  "RAPLA DUATLON - DUATLONI KARIKASARJA 1. ETAPP"
//
// Reegel: sama kuupaev JA uhe nime koik tunnussonad on teises olemas.
// Sponsori nimi ees ei tee uut voistlust.
//
// NUMBRID ON TUNNUSSONAD ja neid EI tohi valja filtreerida. Ilma selleta
// oleks "Tartu Maraton 63 km klassika" ja "Tartu Maraton 31 km klassika"
// teineteise alamhulk ja liidetaks kokku — kaks eri sõitu uheks.
// Sama loeb "Tallinna Maraton 21km" ja "42km" ning "1. PAEV" ja "2. PAEV".
const DUP_STOP = new Set(['ja', 'the', 'and', 'ning', 'voistlus', 'voistlused', 'sari', 'sarja']);

function dupTokens(name) {
  return new Set(
    (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((w) => w && (w.length >= 3 || /^\d+$/.test(w)) && !DUP_STOP.has(w))
  );
}

// Alles jaab see kirje, millel on PARIS valine tulemuste link. Kui neid on
// molemal voi kummalgi, jaab pikem nimi — sponsoriga nimi on tapsem.
function parem(a, b) {
  const link = (e) => {
    const u = e.sources.map((s) => s.links && s.links.results).find(Boolean);
    return u && !u.includes('losttimes.ee') && !u.startsWith('/');
  };
  if (link(a) !== link(b)) return link(a) ? a : b;
  return a.name.length >= b.name.length ? a : b;
}

function mergeSameDay(events) {
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const drop = new Set();
  let merged = 0;
  for (const rows of byDate.values()) {
    if (rows.length < 2) continue;
    const toks = rows.map((e) => dupTokens(e.name));
    for (let i = 0; i < rows.length; i++) {
      if (drop.has(rows[i].id)) continue;
      for (let j = i + 1; j < rows.length; j++) {
        if (drop.has(rows[j].id)) continue;
        const A = toks[i], B = toks[j];
        if (!A.size || !B.size) continue;
        const yhised = [...A].filter((w) => B.has(w)).length;
        if (yhised !== Math.min(A.size, B.size)) continue;

        const hoia = parem(rows[i], rows[j]);
        const viska = hoia === rows[i] ? rows[j] : rows[i];
        const seen = new Set(hoia.sources.map((x) => x.id));
        for (const x of viska.sources) if (!seen.has(x.id)) hoia.sources.push(x);
        hoia.distances = [...new Set([...(hoia.distances || []), ...(viska.distances || [])])];
        if (!hoia.location && viska.location) hoia.location = viska.location;
        if (!hoia.sport && viska.sport) hoia.sport = viska.sport;
        drop.add(viska.id);
        merged++;
        if (viska === rows[i]) break;
      }
    }
  }
  if (merged) console.log(`[duplikaadid] liidetud ${merged} sama päeva topeltkirjet`);
  return events.filter((e) => !drop.has(e.id));
}

// LINGITA VOISTLUS EI JOUA LEHELE
//
// Kui meil ei ole voistluse kohta UHTEGI valist linki — ei tulemusi, ei
// stardinimekirja, ei korraldaja lehte — siis me ei tea sellest voistlusest
// midagi peale nime ja kuupaeva. Kasutaja jaoks on see umbtee: ta klikib
// ja jouab lehele, mis utleb "me ei tea, kus tulemused on".
//
// Reegel EI puuduta tulevasi voistlusi, sest neil on alati vahemalt
// korraldaja link olemas — mootmise hetkel kadus selle reegliga null
// tulevast voistlust ja 2308 vana.
//
// TAHTIS: arhiiv on kumulatiivne ja need kirjed EI TULE tagasi tavalise
// ooise jooksuga, sest see puudutab ainult varsket otsa. Kui reegel kunagi
// valja lulitada, tuleb ajalugu taastada kaega:  node scrape/index.mjs --deep
function dropLinkless(events) {
  const oma = (u) => !u || u.includes('losttimes.ee') || u.startsWith('/');
  const onLink = (e) => e.sources.some((s) =>
    !oma(s.links.results) || !oma(s.links.startlist) || !oma(s.links.organiser));

  const kept = events.filter(onLink);
  const kadus = events.length - kept.length;
  if (kadus) console.log(`[lingita] eemaldatud ${kadus} võistlust, millel ei ole ühtegi välist linki`);
  return kept;
}

async function finish(collected, health) {
  const merged = merge(collected);
  const withDate = merged.filter((e) => e.date);

  // Vali valja see, mis siia lehele ei kuulu (discgolf, male, heiteseriaalid...).
  const { kept, dropped } = explainFilter(withDate);
  console.log(`\n[filter] jatsin ${kept.length}, viskasin valja ${dropped.length}`);
  if (dropped.length) {
    console.log('  naiteid: ' + dropped.slice(0, 6).map((e) => e.name).join(' | '));
  }

  const events = kept.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

  // Arhiiv jaotatakse aastate kaupa. Uks 11 000 voistlusega fail oleks
  // mobiilis liiga range — leht laeb jooksva aasta kohe ja vanemad siis,
  // kui kasutaja otsib voi aastat vahetab.
  await mkdir('site', { recursive: true });

  // TAHTIS: arhiiv on KUMULATIIVNE.
  //
  // Tavajooks loeb ainult varsket otsa (8 lehekulge Sportost jne). Kui me
  // kirjutaksime failid lihtsalt ule, kaoks kogu 11 000 voistlusega arhiiv
  // ara juba jargmisel ool. Seega loeme olemasoleva sisse ja liidame uue
  // peale — uus info voidab, vana jaab alles.
  //
  // Korvalkasu: kui moni scraper laheb katki ja tagastab prugi, ei havita
  // see ajalugu. Halvim, mis juhtuda saab, on et andmed ei uuene.
  const archive = new Map();
  if (REBUILD) {
    console.log('[arhiiv] --rebuild: vana arhiiv jaetakse arvestamata, ehitan nullist');
  } else try {
    const meta = JSON.parse(await readFile('site/index.json', 'utf8'));
    for (const { year } of meta.years) {
      const rows = JSON.parse(await readFile(`site/events-${year}.json`, 'utf8'));
      for (const e of rows) archive.set(e.id, e);
    }
    console.log(`[arhiiv] olemas ${archive.size} voistlust, liidan uued peale`);
  } catch {
    console.log('[arhiiv] varasemat arhiivi ei leidnud, alustan nullist');
  }

  for (const e of events) archive.set(e.id, e);

  // Filter kaib ULE KOGU ARHIIVI, mitte ainult selle jooksu kirjete.
  //
  // Muidu jaab uks kord sisse paasenud praht sinna igaveseks: kumulatiivne
  // liitmine toob ta iga kord tagasi ja uus filtrireegel ei puuduta teda.
  // Nuud puhastab iga jooks kogu ajaloo uute reeglite jargi.
  const beforeClean = archive.size;
  const cleaned = explainFilter([...archive.values()]);
  if (cleaned.dropped.length) {
    console.log(`[filter] arhiivist eemaldatud ${cleaned.dropped.length}: ` +
      cleaned.dropped.slice(0, 5).map((e) => e.name).join(' | '));
  }

  // Kasitsi parandused KOIGE VIIMASENA — need voidavad alati automaatika.
  const all = mergeSameDay(mergeMultiDay(await applyOverrides(cleaned.kept))).sort(
    (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)
  );
  if (beforeClean !== all.length) console.log(`[arhiiv] ${beforeClean} -> ${all.length}`);

  // Registreerimislingid valja ENNE resolverit ja enne Reeglit B.
  //
  // Enne, sest resolver kasutab korraldaja domeeni tulemuste otsimiseks:
  // "iseteenindus.xco.ee" pealt ei leia ta midagi, "xco.ee" pealt leiab.
  // Ja Reegel B peab otsustama parandatud linkide, mitte registreerimis-
  // vormide pealt — muidu jaab lehele voistlus, mille ainus link on makseleht.
  if (!SKIP_RESOLVE) await applyRegaLinks(all);

  // Korraldaja-hupe kaib ULE KOGU ARHIIVI, mitte ainult selle jooksu kirjete.
  //
  // Varem oli see enne arhiiviga liitmist ja puudutas seega ainult varskeid
  // uritusi. See tahendas, et 2019. aasta voistlus, millel tulemuste linki ei
  // ole, ei saanud seda mitte kunagi — sest teda ei olnud uheski hilisemas
  // jooksus. Nuud korjab iga jooks vana arhiivi puudujaake juurde ja vahemalu
  // hoolitseb selle eest, et sama lehte kaks korda ei kusitaks.
  // Korraldaja tulemuste leht annab otselingid TolkNeti taha, kuhu me
  // muidu ligi ei saa. Kaib ENNE resolverit: kui link on juba kaes, ei
  // pea resolver seda voistlust uldse proovima.
  if (!SKIP_RESOLVE) await applySpordisarjad(all);

  if (!SKIP_RESOLVE) await resolveMissing(all);

  // KOIGE VIIMASENA, sest resolver ja korraldajate moodulid lisavad
  // linke kuni siiani. Varem tehtuna viskaks see valja voistlusi,
  // millele link oleks paar rida hiljem leitud.
  const nahtavad = dropLinkless(all);

  // KOIK valjundid lahtuvad nahtavatest. Kui aastafailid tuleksid endiselt
  // `all` pealt, naitaks nimekiri lingita voistlusi edasi — leht loeb
  // events-*.json, mitte genereeritud HTML-i.
  const byYear = new Map();
  for (const e of nahtavad) {
    const year = e.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(e);
  }

  const years = [...byYear.keys()].sort().reverse();
  for (const year of years) {
    await writeFile(`site/events-${year}.json`, JSON.stringify(byYear.get(year)));
  }

  await writeFile(
    'site/index.json',
    JSON.stringify({
      generated: new Date().toISOString(),
      sources: health,
      total: nahtavad.length,
      // withResults = mitmel selle aasta voistlusel on paris tulemuste link.
      // Leht kasutab seda otsustamaks, milliseid aastaid uldse sirvimiseks
      // pakkuda — kehva kattega aasta naeb kasutaja silmis katkine valja.
      years: years.map((y) => {
        const rows = byYear.get(y);
        return {
          year: y,
          count: rows.length,
          withResults: rows.filter((e) => e.sources.some((s) => s.links.results)).length,
        };
      }),
    })
  );

  // Staatilised lehed — need on ainus asi, mida Google naeb.
  const yearMeta = years.map((y) => ({ year: y, count: byYear.get(y).length }));
  await buildPages(nahtavad, yearMeta);

  console.log(`\n=> arhiivis ${nahtavad.length} voistlust (sellest jooksust ${events.length})`);
  console.log(`=> aastad: ${years.map((y) => `${y}(${byYear.get(y).length})`).join(' ')}`);

  const broken = health.filter((h) => !h.ok);
  if (broken.length) {
    console.error(`\nKATKI: ${broken.map((b) => b.id).join(', ')}`);
    process.exit(1);
  }
}

/**
 * Liidab sama voistluse eri allikatest kokku.
 * Voti: normaliseeritud nimi + kuupaev (lubame 1 paeva nihet, sest
 * mitmepaevased uritused on eri allikates eri kuupaevaga).
 */
function merge(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const norm = normalizeName(row.name);
    if (!norm) continue;

    const candidates = [row.date, shiftDate(row.date, -1), shiftDate(row.date, 1)];
    let key = candidates.map((d) => `${norm}|${d}`).find((k) => byKey.has(k));
    if (!key) key = `${norm}|${row.date}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        id: key.replace(/[^a-z0-9|-]/gi, '-').replace(/\|/g, '_'),
        name: row.name,
        date: row.date,
        location: row.location || null,
        sport: row.sport || null,
        distances: row.distances || [],
        sources: [],
      });
    }

    const event = byKey.get(key);
    // Rikkaim allikas voidab kirjelduse osas.
    if (!event.location && row.location) event.location = row.location;
    if (!event.sport && row.sport) event.sport = row.sport;
    const hasDistances = event.distances && event.distances.length;
    const rowDistances = row.distances && row.distances.length;
    if (!hasDistances && rowDistances) event.distances = row.distances;
    if (row.name.length > event.name.length) event.name = row.name;

    event.sources.push({
      id: row.source,
      label: row.labelOverride || row.sourceLabel,
      links: row.links,
      distanceCount: row.distanceCount || 1,
    });
  }

  return [...byKey.values()];
}

function shiftDate(isoDate, days) {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate; // vigane kuupaev — ara kuku kokku
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
