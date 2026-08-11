// Kaivitab koik allikad, liidab tulemused kokku ja kirjutab site/events.json.
//
//   npm run scrape           -- tavaline kaivitus
//   npm run fixtures         -- salvestab ka toor-HTML-i fixtures/ kausta
//
// Valjub koodiga 1, kui moni allikas tagastas 0 kirjet. GitHub Actions
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

// --no-resolve jatab korraldaja lehtede kulastamise vahele (kiirem testimine).
const SKIP_RESOLVE = process.argv.includes('--no-resolve');

import sportos from './sources/sportos.mjs';
import championchip from './sources/championchip.mjs';
import estoloppet from './sources/estoloppet.mjs';
import antrotsenter from './sources/antrotsenter.mjs';
import manual from './sources/manual.mjs';

const ALL_SOURCES = [sportos, championchip, estoloppet, antrotsenter, manual];

// Uhe allika kaupa testimiseks:  node scrape/index.mjs --only=sportos
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : null;
const SOURCES = only
  ? ALL_SOURCES.filter((s) => only.split(',').includes(s.id))
  : ALL_SOURCES;

if (!SOURCES.length) {
  console.error(`Tundmatu allikas: ${only}. Valikus: ${ALL_SOURCES.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

// Kui vana kirjeid alles hoiame. Vanemad kaovad JSON-ist, et fail ei paisuks.
const KEEP_MONTHS = 18;

// --from-raw kasutab eelmise kaivituse toorandmeid ja jatab allikate
// kulastamise vahele. Kokkuliitmise silumiseks — sekundiga, mitte kahe minutiga.
const FROM_RAW = process.argv.includes('--from-raw');

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
      health.push({ id: source.id, label: source.label, count: events.length, ok: events.length > 0 });
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
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS);

  const inWindow = merged.filter((e) => e.date && new Date(e.date) >= cutoff);

  // Vali valja see, mis siia lehele ei kuulu (discgolf, male, heiteseriaalid...).
  const { kept, dropped } = explainFilter(inWindow);
  console.log(`\n[filter] jatsin ${kept.length}, viskasin valja ${dropped.length}`);
  if (dropped.length) {
    console.log('  naiteid: ' + dropped.slice(0, 6).map((e) => e.name).join(' | '));
  }

  const events = kept.sort(
    (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)
  );

  if (!SKIP_RESOLVE) await resolveMissing(events);

  await mkdir('site', { recursive: true });
  await writeFile(
    'site/events.json',
    JSON.stringify({ generated: new Date().toISOString(), sources: health, events }, null, 0)
  );

  console.log(`\n=> ${events.length} voistlust, ${collected.length} toorkirjet`);
  console.log(`=> site/events.json kirjutatud`);

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
