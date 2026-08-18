// Kasitsi parandused automaatselt saadud andmete peale.
//
// MIKS SEE OLEMAS ON:
// Scraper voib eksida ja allikad ise ka. Sportos annab korraldajaks Tartu
// linnavalitsuse lehe, korraldaja avaldab sama voistluse kaks korda, mone
// sarja etapid ei kuulu siia lehele uldse. Neid asju ei saa reegliga
// lahendada — need tuleb kasitsi ara oelda.
//
// Parandused elavad failis data/overrides.json ja rakenduvad IGAL jooksul
// uuesti. Nii ei kao nad ara, kui andmed uuenevad.

import { readFile } from 'node:fs/promises';
import { normalizeName } from './lib.mjs';

const fold = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export async function applyOverrides(events) {
  let conf;
  try {
    conf = JSON.parse(await readFile('data/overrides.json', 'utf8'));
  } catch (err) {
    console.log(`[parandused] data/overrides.json puudub voi katki: ${err.message}`);
    return events;
  }

  const rules = conf.events || [];
  // Nimereeglid kaivad KOIGI sama nimemustriga voistluste peale, ilma
  // kuupaevata. Sarjal on kumme etappi ja igaühele eraldi rea kirjutamine
  // tahendaks, et jargmise hooaja etapid jaavad kohe parandamata.
  const nameRules = conf.nameLinks || [];
  const hideOrganiser = (conf.hideOrganiser || []).map(fold);
  const hideName = (conf.hideName || []).map(fold);
  const used = new Set();

  let hidden = 0;
  let patched = 0;

  const kept = events.filter((e) => {
    // 1. Terve korraldaja peitmine — nt uks sari, mis siia lehele ei kuulu.
    if (hideOrganiser.length) {
      const orgs = e.sources.map((s) => fold(s.links.organiser || ''));
      if (orgs.some((o) => o && hideOrganiser.some((h) => o.includes(h)))) {
        hidden++;
        return false;
      }
    }

    // 2. Nimemuster igal kuupaeval — nt sari, mis dubleerib teist kirjet.
    const raw = fold(e.name);
    if (hideName.some((h) => raw.includes(h))) {
      hidden++;
      return false;
    }

    // 3. Nimereeglid: kehtivad koigile, kelle nimes muster esineb.
    for (const r of nameRules) {
      if (!fold(e.name).includes(fold(r.match))) continue;
      e.sources.unshift({
        id: 'kasitsi',
        label: 'Käsitsi parandatud',
        links: {
          results: r.results || null,
          startlist: r.startlist || null,
          live: null,
          organiser: r.organiser || null,
          info: r.info || r.organiser || null,
        },
        distanceCount: 1,
      });
      patched++;
      break;
    }

    // 4. Uksikud reeglid: kuupaev peab klappima, nimi sisaldama otsingusona.
    const name = fold(normalizeName(e.name) || e.name);
    for (const [i, r] of rules.entries()) {
      if (r.date !== e.date) continue;
      if (!name.includes(fold(normalizeName(r.match) || r.match))) continue;
      used.add(i);

      if (r.hide) {
        hidden++;
        return false;
      }

      // Nime saab ule kirjutada — allikad kirjutavad neid vahel poolikult
      // voi valesti ("TALLINNA MARATON" kolme eri distantsi kohta).
      if (r.name) e.name = r.name;

      // Parandus laheb ETTE, et ta voidaks automaatselt leitud lingi ule.
      e.sources.unshift({
        id: 'kasitsi',
        label: 'Käsitsi parandatud',
        links: {
          results: r.results || null,
          startlist: r.startlist || null,
          live: null,
          organiser: r.organiser || null,
          info: r.info || r.organiser || null,
        },
        distanceCount: 1,
      });
      patched++;
      break;
    }
    return true;
  });

  // Kasutamata reegel tahendab, et voistluse nimi voi kuupaev on muutunud —
  // parem teada saada kohe, mitte avastada kuu parast, et parandus ei mojunud.
  const unused = rules.filter((_, i) => !used.has(i));
  if (unused.length) {
    console.log(`[parandused] HOIATUS: ${unused.length} reeglit ei leidnud ubagi voistlust:`);
    for (const r of unused) console.log(`    ${r.date}  "${r.match}"`);
  }

  console.log(`[parandused] peidetud ${hidden}, parandatud ${patched}`);
  return kept;
}
