// Katkiste linkide kontroll — ainult lehel NÄIDATAVATE võistluste kohta.
//
// LostTimesi mõte on viia inimene õigesse kohta. Link, mis annab 404 või
// mille domeeni enam ei ole, on halvem kui puuduv link: inimene klõpsab,
// pettub ja ei tule tagasi.
//
// Reeglid:
//  - Link loetakse surnuks alles siis, kui ta on KAKS jooksu järjest katki.
//    Üks öine viga võib olla korraldaja serveri hetkeline häire.
//  - 401/403/429 EI ole surnud: see on enamasti botikaitse (nt Sportose
//    turvakontroll), inimese brauseris link töötab.
//  - Töötavat linki kontrollitakse uuesti kord nädalas, katkist igal ööl —
//    nii taastub link ise, kui korraldaja lehe tagasi paneb.
//  - Seis on data/linkcheck.json failis, mis commititakse koos andmetega.

import { readFile, writeFile } from 'node:fs/promises';

const FILE = 'data/linkcheck.json';
const RECHECK_OK_MS = 7 * 86400000;
const TIMEOUT_MS = 15000;
const CONCURRENCY = 6;
const DEAD_AFTER = 2;
const LINK_KEYS = ['results', 'startlist', 'live', 'organiser', 'info'];
const UA = 'Mozilla/5.0 (compatible; LostTimesLinkCheck/1.0; +https://losttimes.ee)';

const oma = (u) => !u || u.includes('losttimes.ee') || u.startsWith('/');

async function probe(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } });
    // Paljud serverid ei toeta HEAD-i korralikult — proovi GET-iga üle.
    if (res.status >= 400) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } });
      res.body?.cancel?.();
    }
    return res.status;
  } catch (err) {
    return `ERR ${err.cause?.code || err.name}`;
  } finally {
    clearTimeout(t);
  }
}

export function isDeadStatus(status) {
  if (typeof status === 'string') return true;          // DNS, ühendus, timeout
  if ([401, 403, 429].includes(status)) return false;    // botikaitse, mitte surnud
  return status >= 400;
}

export async function checkLinks(events, { now = Date.now(), probeFn = probe } = {}) {
  let state = {};
  try { state = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* esimene jooks */ }

  const urls = new Set();
  for (const e of events) for (const s of e.sources) for (const k of LINK_KEYS) {
    const u = s.links?.[k];
    if (!oma(u)) urls.add(u);
  }

  const due = [...urls].filter((u) => {
    const st = state[u];
    if (!st) return true;
    if (st.fails > 0) return true;
    return now - (st.checked || 0) > RECHECK_OK_MS;
  });

  const results = new Map();
  let i = 0;
  async function worker() {
    while (i < due.length) {
      const u = due[i++];
      results.set(u, await probeFn(u));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Kaitse: kui üle poole kontrollitud linkidest kukkus korraga, on viga
  // meie pool (runneri võrk), mitte kõigil korraldajatel korraga. Siis ei
  // muuda me midagi — muidu tühjeneks leht kahe halva ööga.
  const failed = [...results.values()].filter(isDeadStatus).length;
  if (due.length >= 10 && failed > due.length / 2) {
    console.log(`[lingid] HOIATUS: ${failed}/${due.length} linki kukkus — võrguviga? Seisu ei muuda.`);
    return { dead: new Set(), removed: 0 };
  }
  for (const [u, status] of results) {
    const prev = state[u] || { fails: 0 };
    state[u] = isDeadStatus(status)
      ? { fails: prev.fails + 1, checked: now, status }
      : { fails: 0, checked: now, status };
  }

  // Vanad kirjed, mida ükski võistlus enam ei kasuta, välja.
  for (const u of Object.keys(state)) if (!urls.has(u)) delete state[u];
  await writeFile(FILE, JSON.stringify(state, null, 0));

  // Surnud lingid maha. reaLink() langeb siis ise järgmisele (korraldaja).
  const dead = new Set(Object.entries(state).filter(([, st]) => st.fails >= DEAD_AFTER).map(([u]) => u));
  let removed = 0;
  for (const e of events) for (const s of e.sources) for (const k of LINK_KEYS) {
    if (s.links?.[k] && dead.has(s.links[k])) { s.links[k] = null; removed++; }
  }

  console.log(`[lingid] ${urls.size} linki, kontrollisin ${due.length}, surnud ${dead.size}, eemaldasin ${removed} kohast`);
  for (const u of [...dead].slice(0, 15)) console.log(`  surnud: ${state[u].status} ${u}`);
  return { dead, removed };
}
