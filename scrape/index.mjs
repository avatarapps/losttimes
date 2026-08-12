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

import sportos from './sources/sportos.mjs';
import championchip from './sources/championchip.mjs';
import estoloppet from './sources/estoloppet.mjs';
import antrotsenter from './sources/antrotsenter.mjs';
import timing from './sources/timing.mjs';
import manual from './sources/manual.mjs';

const ALL_SOURCES = [sportos, championchip, estoloppet, antrotsenter, timing, manual];

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
  const all = (await applyOverrides(cleaned.kept)).sort(
    (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)
  );
  if (beforeClean !== all.length) console.log(`[arhiiv] ${beforeClean} -> ${all.length}`);

  // Korraldaja-hupe kaib ULE KOGU ARHIIVI, mitte ainult selle jooksu kirjete.
  //
  // Varem oli see enne arhiiviga liitmist ja puudutas seega ainult varskeid
  // uritusi. See tahendas, et 2019. aasta voistlus, millel tulemuste linki ei
  // ole, ei saanud seda mitte kunagi — sest teda ei olnud uheski hilisemas
  // jooksus. Nuud korjab iga jooks vana arhiivi puudujaake juurde ja vahemalu
  // hoolitseb selle eest, et sama lehte kaks korda ei kusitaks.
  if (!SKIP_RESOLVE) await resolveMissing(all);

  const byYear = new Map();
  for (const e of all) {
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
      total: all.length,
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
  await buildPages(all, yearMeta);

  console.log(`\n=> arhiivis ${all.length} voistlust (sellest jooksust ${events.length})`);
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
