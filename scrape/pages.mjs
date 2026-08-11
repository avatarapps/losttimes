// Staatiliste lehtede generaator — SEO tuum.
//
// PROBLEEM: avaleht ehitab nimekirja JavaScriptiga. Google naeb HTML-is ainult
// pealkirja ja sona "Loading...". Ilus liides, aga otsimootorile tuhi leht.
//
// STRUKTUUR:
//   /                          uusimad tulemused (eelrenderdatud nimekiri)
//   /upcoming/                 tulevased voistlused, paris URL
//   /race/muhu-jooks-2026      uks kindel voistlus
//   /race/muhu-jooks           sarja hub: koik aastad uhel lehel
//   /arhiiv/  /arhiiv/2018/    aastate kaupa
//   /sitemap.xml  /robots.txt
//
// Sarja hub on siin koige vaartuslikum leht. Inimene otsib "muhu jooks
// tulemused", mitte "muhu jooks 2026 tulemused" — ja hub vastab just sellele.
//
// Pealkirjad ja kirjeldused on EESTI KEELES, sest otsitakse eesti keeles.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { normalizeName } from './lib.mjs';

const SITE = 'https://losttimes.ee';

const MONTHS_ET = ['jaanuar','veebruar','märts','aprill','mai','juuni',
  'juuli','august','september','oktoober','november','detsember'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function baseSlug(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'voistlus';
}

export function slugify(name, date) {
  return `${baseSlug(name)}-${date.slice(0, 4)}`;
}

function etDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONTHS_ET[m - 1]} ${y}`;
}

const SHELL = (o) => `<!doctype html>
<html lang="et">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${o.canonical}">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#FFFFFF;--ink:#13202B;--red:#FF4938;--slate:#66717D;--line:#E7EBED;
--sans:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg)}
body{font-family:var(--sans);color:var(--ink);font-size:16px;line-height:1.55;
-webkit-font-smoothing:antialiased;padding-bottom:env(safe-area-inset-bottom)}
a{color:inherit}
.wrap{max-width:640px;margin:0 auto;padding:0 22px}
.top{padding:26px 0 0}
.logo{display:inline-block;font-weight:700;font-size:22px;letter-spacing:-.035em;
line-height:1;text-decoration:none;color:var(--ink)}
.logo i{color:var(--red);font-style:normal}
h1{margin:30px 0 0;font-size:clamp(26px,6.6vw,34px);font-weight:700;
letter-spacing:-.032em;line-height:1.12}
.meta{margin-top:10px;font-size:15.5px;color:var(--slate);font-weight:500}
.cta{display:inline-block;margin-top:22px;padding:13px 22px;border-radius:100px;
background:var(--red);color:#fff;font-size:15.5px;font-weight:600;text-decoration:none}
.alt{display:inline-block;margin-top:22px;margin-left:10px;font-size:15px;
font-weight:600;text-decoration:none}
.note{margin-top:18px;font-size:14.5px;color:var(--slate)}
ul.list{margin:18px 0 0;padding:0;list-style:none}
ul.list li{padding:14px 0;border-bottom:1px solid var(--line)}
ul.list .n{font-weight:600;font-size:16.5px;text-decoration:none}
ul.list .d{display:block;font-size:13px;color:var(--slate);font-weight:500;margin-top:3px}
ul.list .r{font-weight:600;font-size:14.5px;color:var(--red);text-decoration:none}
ul.list .s{font-weight:600;font-size:14.5px;text-decoration:none;margin-left:12px}
.years{display:flex;flex-wrap:wrap;gap:7px;margin-top:18px}
.years a{padding:7px 13px;border:1px solid var(--line);border-radius:100px;
font-size:13.5px;font-weight:600;text-decoration:none}
footer{margin-top:40px;padding:20px 0 44px;border-top:1px solid var(--line);
color:var(--slate);font-size:13px}
footer a{color:var(--ink);font-weight:600;text-decoration:none}
</style>
${o.jsonld ? `<script type="application/ld+json">${o.jsonld}</script>` : ''}
</head>
<body>
<div class="wrap">
<div class="top"><a class="logo" href="/">LOSTTIMES<i>.</i></a></div>
${o.body}
<footer><a href="/">Tulemused</a> · <a href="/upcoming/">Tulemas</a> · <a href="/arhiiv/">Arhiiv</a> · <a href="/about.html">Mis on LostTimes</a></footer>
</div>
</body>
</html>`;

function resultsLink(e) {
  const r = e.sources.find((s) => s.links.results);
  return r ? r.links.results : null;
}

function eventPage(e, siblings) {
  const year = e.date.slice(0, 4);
  const when = etDate(e.date);
  const res = resultsLink(e);
  const start = e.sources.find((s) => s.links.startlist);
  const org = e.sources.find((s) => s.links.organiser);
  const where = e.location ? `, ${e.location}` : '';

  const action = res
    ? `<a class="cta" href="${esc(res)}">Vaata tulemusi →</a>`
    : `<a class="cta" href="https://www.google.com/search?q=${encodeURIComponent(e.name + ' ' + year + ' tulemused')}">Otsi tulemusi →</a>`;

  const extras = [];
  if (start && start.links.startlist !== res) {
    extras.push(`<a class="alt" href="${esc(start.links.startlist)}">Stardinimekiri</a>`);
  }
  if (org) extras.push(`<a class="alt" href="${esc(org.links.organiser)}">Korraldaja</a>`);

  const others = siblings.length > 1
    ? `<p class="note"><a href="/race/${e.hub}">Kõik ${esc(e.name.replace(/\s*\(?\d{4}\)?\s*$/, ''))} aastad →</a></p>`
    : '';

  return SHELL({
    title: `${e.name} ${year} tulemused | LostTimes`,
    description: `${e.name} — ${when}${where}. ` +
      (res ? 'Otselink tulemustele ja stardinimekirjale.' : 'Kust leida selle võistluse tulemused.'),
    canonical: `${SITE}/race/${e.slug}`,
    jsonld: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: e.name,
      startDate: e.date,
      ...(e.location ? { location: { '@type': 'Place', name: e.location } } : {}),
      ...(res ? { url: res } : {}),
    }),
    body: `<h1>${esc(e.name)}</h1>
<p class="meta">${esc(when)}${esc(where)}${e.sport ? ' · ' + esc(e.sport) : ''}</p>
${action}${extras.join('')}
<p class="note">${res
      ? 'Tulemusi hoiab ajavõtja — link viib otse ametlikku allikasse.'
      : 'Selle võistluse tulemuste asukoht ei ole meil teada. Kui sa selle leiad, kirjuta ja lisan.'}</p>
${others}
<p class="note"><a href="/arhiiv/${year}/">Kõik ${year}. aasta võistlused →</a></p>`,
  });
}

// Sarja hub — koik aastad uhe voistluse kohta. See on leht, mis vastab
// paringule "muhu jooks tulemused", kus aastat ei ole kusitud.
function hubPage(name, rows) {
  const items = rows
    .map((e) => {
      const y = e.date.slice(0, 4);
      const res = resultsLink(e);
      const start = e.sources.find((s) => s.links.startlist);
      const links = [
        res ? `<a class="r" href="${esc(res)}">${y} tulemused</a>` : `<a class="r" href="/race/${e.slug}">${y}</a>`,
        start && start.links.startlist !== res
          ? `<a class="s" href="${esc(start.links.startlist)}">Stardinimekiri</a>` : '',
      ].join('');
      return `<li>${links}<span class="d">${esc(etDate(e.date))}${e.location ? ' · ' + esc(e.location) : ''} · <a href="/race/${e.slug}">detailid</a></span></li>`;
    })
    .join('\n');

  const first = rows[rows.length - 1].date.slice(0, 4);
  const last = rows[0].date.slice(0, 4);

  return SHELL({
    title: `${name} tulemused — kõik aastad | LostTimes`,
    description: `${name} tulemused aastate kaupa: ${first}–${last}. Otselingid ajavõtjate lehtedele.`,
    canonical: `${SITE}/race/${baseSlug(name)}`,
    body: `<h1>${esc(name)}</h1>
<p class="meta">${rows.length} korda · ${first}–${last}</p>
<ul class="list">${items}</ul>`,
  });
}

function yearPage(year, rows) {
  const items = rows
    .map((e) => `<li><a class="n" href="/race/${e.slug}">${esc(e.name)}</a>
<span class="d">${esc(etDate(e.date))}${e.location ? ' · ' + esc(e.location) : ''}</span></li>`)
    .join('\n');

  return SHELL({
    title: `${year}. aasta võistluste tulemused | LostTimes`,
    description: `Kõik ${year}. aasta Eesti jooksu-, ratta-, suusa- ja triatlonivõistlused ning tulemuste lingid. Kokku ${rows.length} võistlust.`,
    canonical: `${SITE}/arhiiv/${year}/`,
    body: `<h1>${year}. aasta võistlused</h1>
<p class="meta">${rows.length} võistlust</p>
<ul class="list">${items}</ul>`,
  });
}

function archiveIndex(years) {
  const total = years.reduce((n, y) => n + y.count, 0);
  return SHELL({
    title: 'Eesti võistluste tulemuste arhiiv | LostTimes',
    description: `Eesti jooksu-, ratta-, suusa- ja triatlonivõistluste tulemused aastate kaupa. Kokku ${total} võistlust.`,
    canonical: `${SITE}/arhiiv/`,
    body: `<h1>Tulemuste arhiiv</h1>
<p class="meta">${total} võistlust, ${years[years.length - 1].year}–${years[0].year}</p>
<div class="years">${years.map((y) => `<a href="/arhiiv/${y.year}/">${y.year}</a>`).join('')}</div>`,
  });
}

/** Reamärgistus, mis läheb avalehe HTML-i sisse crawleri jaoks. */
function ssrRows(rows) {
  return rows
    .map((e) => {
      const d = new Date(e.date + 'T12:00:00');
      const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
      const res = resultsLink(e);
      return `<article class="row"><div class="date"><div class="day">${String(d.getDate()).padStart(2,'0')}</div><div class="mon">${mon}</div></div>` +
        `<div class="body"><h2><a class="title" href="/race/${e.slug}">${esc(e.name)}</a></h2>` +
        `<div class="acts"><a class="res" href="${res ? esc(res) : `/race/${e.slug}`}">Results <span class="arr">↗</span></a></div></div></article>`;
    })
    .join('');
}

export async function buildPages(events, years) {
  // 1. Slugid
  const used = new Set();
  for (const e of events) {
    let s = slugify(e.name, e.date);
    let n = 2;
    while (used.has(s)) s = `${slugify(e.name, e.date)}-${n++}`;
    used.add(s);
    e.slug = s;
    e.hub = baseSlug(normalizeName(e.name) || e.name);
  }

  // 2. Sarjad: sama normaliseeritud nimi eri aastatel
  const series = new Map();
  for (const e of events) {
    if (!series.has(e.hub)) series.set(e.hub, []);
    series.get(e.hub).push(e);
  }

  await mkdir('site/race', { recursive: true });
  await mkdir('site/arhiiv', { recursive: true });
  await mkdir('site/upcoming', { recursive: true });

  // 3. Voistluste lehed
  for (const e of events) {
    await mkdir(`site/race/${e.slug}`, { recursive: true });
    await writeFile(`site/race/${e.slug}/index.html`, eventPage(e, series.get(e.hub)));
  }

  // 4. Sarja hubid — ainult siis, kui aastaid on rohkem kui uks.
  let hubs = 0;
  for (const [hub, rows] of series) {
    if (rows.length < 2 || used.has(hub)) continue;
    rows.sort((a, b) => b.date.localeCompare(a.date));
    await mkdir(`site/race/${hub}`, { recursive: true });
    await writeFile(`site/race/${hub}/index.html`, hubPage(rows[0].name, rows));
    hubs++;
  }

  // 5. Aastad
  const byYear = new Map();
  for (const e of events) {
    const y = e.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(e);
  }
  for (const [year, rows] of byYear) {
    await mkdir(`site/arhiiv/${year}`, { recursive: true });
    await writeFile(`site/arhiiv/${year}/index.html`, yearPage(year, rows));
  }
  await writeFile('site/arhiiv/index.html', archiveIndex(years));

  // 6. Avaleht ja /upcoming — sama rakendus, aga sisu on HTML-is olemas
  const today = new Date().toISOString().slice(0, 10);
  const past = events.filter((e) => e.date <= today).slice(0, 60);
  const next = events.filter((e) => e.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60);

  const shell = await readFile('site/index.html', 'utf8');
  const inject = (html, rows) =>
    html.replace(/<!--SSR-START-->[\s\S]*?<!--SSR-END-->/,
      `<!--SSR-START-->${ssrRows(rows)}<!--SSR-END-->`);

  await writeFile('site/index.html', inject(shell, past));

  const upcoming = inject(shell, next)
    .replace(/<title>[\s\S]*?<\/title>/,
      '<title>Tulemas — Eesti võistluste kalender | LostTimes</title>')
    .replace(/<meta name="description" content="[^"]*">/,
      '<meta name="description" content="Tulemas olevad Eesti jooksu-, ratta-, suusa- ja triatlonivõistlused. Stardinimekirjad ja tulemuste lingid ühes kohas.">')
    .replace(/<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="${SITE}/upcoming/">`);
  await writeFile('site/upcoming/index.html', upcoming);

  // 7. Sitemap ja robots
  const urls = [
    `${SITE}/`, `${SITE}/upcoming/`, `${SITE}/arhiiv/`,
    `${SITE}/about.html`, `${SITE}/advertise.html`,
    ...[...byYear.keys()].map((y) => `${SITE}/arhiiv/${y}/`),
    ...[...series.entries()].filter(([h, r]) => r.length >= 2 && !used.has(h)).map(([h]) => `${SITE}/race/${h}`),
    ...events.map((e) => `${SITE}/race/${e.slug}`),
  ];
  await writeFile('site/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>\n`);

  await writeFile('site/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

  console.log(`[lehed] ${events.length} võistlust, ${hubs} sarja hubi, ${byYear.size} aastalehte`);
  console.log(`[lehed] avaleht ja /upcoming eelrenderdatud, sitemapis ${urls.length} aadressi`);
}
