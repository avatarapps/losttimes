// Suitsutest — kas leht üldse töötab?
//
// MIKS SEE OLEMAS ON
// Kaks viga läksid ühe päevaga välja, mõlemad sellised, mida `node --check`
// EI PÜÜA, sest kood oli süntaktiliselt korrektne:
//
//   1. `reastus is not defined` — funktsioon oli defineeritud loadYear()
//      sees, aga render() kasutas teda ka. "Tulevased" jäi tühjaks.
//   2. `res is not defined` — refaktooris muutsin muutuja nime ainult ühes
//      kohas kahest. buildPages viskas vea POOLE PEAL: võistluste lehed said
//      kirjutatud, avaleht ja /upcoming mitte. Andmefail oli uus, SSR vana,
//      ja väljastpoolt nägi kõik korras välja.
//
// Teine juht on hullem kui katkine leht, sest ta on VAIKNE. Seetõttu
// kontrollib see test kahte asja, mida silm ei näe:
//
//   A. buildPages jookseb algusest lõpuni läbi.
//   B. Lehe JavaScript käivitub ja renderdab päris andmetega ridu.
//
// Test ei vaja võrku ega andmete uuendamist — ta töötab selle peal, mis
// site/ kaustas juba olemas on.
//
// KASUTUS:  node scrape/test.mjs

import fs from 'node:fs';
import { buildPages } from './pages.mjs';

let vigu = 0;
const ok = (nimi, tingimus, lisa = '') => {
  console.log(`  ${tingimus ? 'OK  ' : 'VIGA'}  ${nimi}${lisa ? '   ' + lisa : ''}`);
  if (!tingimus) vigu++;
};

// --- A. Kas lehtede ehitus jookseb lõpuni? --------------------------------

console.log('\nA. buildPages');
const meta = JSON.parse(fs.readFileSync('site/index.json', 'utf8'));
const events = [];
for (const y of meta.years.map((x) => x.year)) {
  events.push(...JSON.parse(fs.readFileSync(`site/events-${y}.json`, 'utf8')));
}

try {
  await buildPages(events, meta.years);
  ok('jookseb algusest lõpuni', true, `${events.length} võistlust`);
} catch (err) {
  ok('jookseb algusest lõpuni', false, err.message);
  console.log('\n' + err.stack.split('\n').slice(0, 5).join('\n'));
}

// --- B. Kas lehe JavaScript käivitub ja renderdab? ------------------------
//
// Ehitame nii vähe brauserit, kui vaja: skript peab saama DOM-i, fetch'i ja
// location'i. Kui ta viskab vea, saame selle kätte — just seda me otsime.

function jooksutaLeht(fail, tee) {
  const html = fs.readFileSync(fail, 'utf8');
  const js = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];

  const el = () => ({
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; },
    set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; },
    style: {}, focus() {}, blur() {}, querySelector: () => el(), querySelectorAll: () => [],
    appendChild() {}, value: '', clientWidth: 400, scrollWidth: 380,
  });
  const nodes = {};
  globalThis.document = {
    getElementById: (id) => (nodes[id] = nodes[id] || el()),
    querySelector: () => el(), querySelectorAll: () => [], addEventListener() {},
    body: el(), documentElement: el(), createElement: () => el(), fonts: null,
  };
  globalThis.location = { pathname: tee, search: '', hash: '', hostname: 'losttimes.ee',
    href: 'https://losttimes.ee' + tee, replace() {} };
  globalThis.window = { addEventListener() {}, location: globalThis.location,
    history: { replaceState() {}, pushState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }), scrollTo() {}, innerWidth: 400 };
  globalThis.history = globalThis.window.history;
  globalThis.getComputedStyle = () => ({ fontSize: '30px' });
  globalThis.requestAnimationFrame = (f) => f();
  globalThis.fetch = async (u) => {
    const p = 'site/' + String(u).replace(/^\//, '');
    if (!fs.existsSync(p)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  };

  return new Promise((resolve) => {
    let viga = null;
    const püüa = (e) => { viga = e; };
    process.on('unhandledRejection', püüa);
    process.on('uncaughtException', püüa);
    // Nonce on KOHUSTUSLIK. Avalehe ja /upcoming skript on tähemärgini sama,
    // seega teine import tuleks moodulite vahemälust ja EI KÄIVITUKS uuesti —
    // test näitaks "0 rida" ja süüdistaks lehte oma vea eest.
    const nonce = `\n// ${fail} ${Math.random()}\n`;
    import('data:text/javascript;base64,' + Buffer.from(js + nonce).toString('base64'))
      .catch(püüa)
      .finally(() => setTimeout(() => {
        process.off('unhandledRejection', püüa);
        process.off('uncaughtException', püüa);
        const h = nodes.list ? nodes.list.innerHTML : '';
        resolve({ viga, ridu: (h.match(/class="row"/g) || []).length, html: h });
      }, 1500));
  });
}

console.log('\nB. lehe JavaScript');
for (const [fail, tee, vahim] of [['site/index.html', '/', 50], ['site/upcoming/index.html', '/upcoming/', 5]]) {
  const r = await jooksutaLeht(fail, tee);
  ok(`${tee} ei viska viga`, !r.viga, r.viga ? (r.viga.message || String(r.viga)) : '');
  ok(`${tee} renderdab ridu`, r.ridu >= vahim, `${r.ridu} rida`);
}

// --- C. Ükski "Results" nupp ei tohi viia meie enda lehele ----------------
//
// Kokkulepe: nupp lubab tulemusi. Kui ta viib tagasi meie lehele, on lubadus
// tühi. Kontrollime EELRENDERDATUD HTML-ist, mis on see, mida Google naeb.

console.log('\nC. Results-nupud viivad välja');
for (const fail of ['site/index.html', 'site/upcoming/index.html']) {
  const html = fs.readFileSync(fail, 'utf8');
  const ssr = (html.match(/<!--SSR-START-->([\s\S]*?)<!--SSR-END-->/) || [, ''])[1];
  const omale = (ssr.match(/class="res" href="\/race\//g) || []).length;
  ok(`${fail} ei vii iseendale`, omale === 0, `${omale} sellist rida`);
}

console.log(`\n${vigu ? `${vigu} VIGA` : 'kõik korras'}\n`);
process.exit(vigu ? 1 : 0);
