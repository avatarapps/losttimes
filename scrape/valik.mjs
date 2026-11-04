// Kureeritud valik: LostTimes näitab AINULT data/valik.json nimekirjas olevaid
// võistlusi.
//
// Varem oli loogika vastupidine: kõik, mida allikad tõid, läks lehele ja
// prahti võeti ükshaaval välja (overrides.json hideName). Sportos toob aga iga
// lasteaia spordinädala ja kooli liikumispäeva — neid tuli juurde kiiremini,
// kui jõudis peita, ja päris võistlused kadusid nende alla ära.
//
// Nüüd: lubatud nimekiri. Uus allikate prügi ei jõua lehele kunagi, sest
// keegi pole seda nimekirja pannud.

import { readFile } from 'node:fs/promises';
import { reastus } from './lib.mjs';

// Täpitähed maha, väiketähed, kirjavahemärgid tühikuks. Punkt jääb alles
// ("70.3"), sest IRONMANi distantsid erinevad just selle poolest.
export function valikNimi(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

export async function loadValik(path = 'data/valik.json') {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const alati = (raw.alatiValja || []).map((p) => new RegExp(p));
  const rules = raw.voistlused.map((r) => ({
    nimi: r.nimi,
    match: new RegExp(r.match),
    except: (r.except || []).map((p) => new RegExp(p)),
  }));
  return { alati, rules };
}

// Tagastab reegli, millesse võistlus kuulub, või null.
export function leiaReegel(valik, name) {
  const n = valikNimi(name);
  if (valik.alati.some((re) => re.test(n))) return null;
  for (const r of valik.rules) {
    if (r.match.test(n) && !r.except.some((re) => re.test(n))) return r;
  }
  return null;
}

export function applyValik(events, valik) {
  const kept = [];
  const perRule = new Map(valik.rules.map((r) => [r.nimi, 0]));
  for (const e of events) {
    const r = leiaReegel(valik, e.name);
    if (!r) continue;
    e.valik = r.nimi;
    perRule.set(r.nimi, perRule.get(r.nimi) + 1);
    kept.push(e);
  }
  // Reegel, mis ei taba midagi, on peaaegu alati kirjaviga mustris.
  const tuhjad = [...perRule].filter(([, n]) => n === 0).map(([k]) => k);
  const yhes = yksRidaVoistluseKohta(kept)
    .sort((a, b) => b.date.localeCompare(a.date) || reastus(a, b));
  console.log(`[valik] ${events.length} -> ${kept.length} kirjet -> ${yhes.length} võistlust, ${valik.rules.length} sarja`);
  if (tuhjad.length) console.log(`[valik] HOIATUS: ei leidnud ühtki: ${tuhjad.join(', ')}`);
  return yhes;
}

// Üks võistlus = üks rida.
//
// Allikad toovad sama nädalavahetuse kohta mitu kirjet: "Swedbanki Tallinna
// Maraton" (Sportos), "Tallinna Maraton 42km" ja "Tallinna Maraton 21km"
// (ajavõtja), Tartu Maratonil iga distants eraldi. Lugeja jaoks on see üks
// võistlus. Sama sarja kirjed, mis on kuni 4 päeva sees, liidetakse.
const AKEN_PAEVI = 4;
const ALAMDISTANTS = /\d\s*km\b|:|teate|klassika|vabatehnika|poolmaraton/i;
// Käsitsi kontrollitud lingid (manual, kasitsi) ees, Sportos viimasena.
const allikaEelistus = (s) =>
  ['manual', 'kasitsi'].includes(s.id) ? -1 : s.id === 'sportos' ? 2 : s.id === 'lingipere' ? 1 : 0;

function yksRidaVoistluseKohta(events) {
  const bySeries = new Map();
  for (const e of events) {
    if (!bySeries.has(e.valik)) bySeries.set(e.valik, []);
    bySeries.get(e.valik).push(e);
  }
  const out = [];
  for (const rows of bySeries.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    let grupp = [];
    const sulge = () => { if (grupp.length) out.push(liida(grupp)); grupp = []; };
    for (const e of rows) {
      const viimane = grupp[grupp.length - 1];
      if (viimane && (Date.parse(e.date) - Date.parse(grupp[0].date)) / 86400000 > AKEN_PAEVI) sulge();
      grupp.push(e);
    }
    sulge();
  }
  return out;
}

function liida(grupp) {
  if (grupp.length === 1) return grupp[0];
  // Peamine kirje: nimi ilma distantsita ja mitte ainult Sportosest.
  const skoor = (e) =>
    (ALAMDISTANTS.test(e.name) ? 2 : 0) + (e.sources.every((s) => s.id === 'sportos') ? 1 : 0);
  const [peamine] = [...grupp].sort((a, b) => skoor(a) - skoor(b) || b.date.localeCompare(a.date));

  // Kuupäev: ajavõtja oma on täpne, Sportos annab sageli registreerimise
  // või mitmepäevase ürituse ALGUSE. Võtame hiliseima mitte-Sportose kuupäeva.
  const tapsed = grupp.filter((e) => e.sources.some((s) => s.id !== 'sportos')).map((e) => e.date);
  const date = (tapsed.length ? tapsed : grupp.map((e) => e.date)).sort().pop();

  // Lingid kõigist kirjetest, ametlik ajavõtja ees, Sportos viimasena —
  // Results-nupp võtab esimese olemasoleva.
  const nahtud = new Set();
  const sources = grupp.flatMap((e) => e.sources)
    .filter((s) => {
      const k = JSON.stringify(s.links);
      if (nahtud.has(k)) return false;
      nahtud.add(k);
      return true;
    })
    .sort((a, b) => allikaEelistus(a) - allikaEelistus(b));

  const distances = [...new Set(grupp.flatMap((e) => e.distances || []))];
  return { ...peamine, date, sources, distances };
}
