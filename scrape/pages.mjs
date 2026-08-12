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

// Osa ajavotjaid kirjutab nime LABIVATE SUURTAHTEDEGA. Teisendame ainult siis,
// kui nimi on PARIS kapslites — "XXIII Muhu Jooks" jaab puutumata.
// NB: slug tehakse endiselt algsest nimest, nii et aadressid ei muutu.
const KEEP_CAPS = new Set(['MTB','XCO','ATV','SEB','TTP','EMV','MV','SK','JK','KFC','EGCC','LHV','TV','II','III','IV','VI','VII','VIII','IX','XI','XII']);

// Eesti keeles kirjutatakse pealkirjas suure tähega ainult esimene sona ja
// parisnimed — mitte iga sona. Kui allikas annab nime LABALT SUURTAHTEDEGA
// ("KIILI KUUBIKU 5. ETAPP"), teeb ulemine reegel igast sonast "Etapp",
// "Jooks", "Ja". See nimekiri toob need tagasi vaiketahega.
//
// Sees on ainult uldnimed ja sidesonad. Kohanimed (Keila, Narva), brandid
// (Estonia, Cup, Run) ja luhendid jaavad puutumata — neid ei saa masinlikult
// eristada, seega parem jatta suureks kui eksida parisnime kallal.
// Rooma numbrid: KEEP_CAPS ei jaksa koiki variante loetleda (XXIII, XVII...).
// Kontrollime kuju jargi. Uhetahelised I, V, X jaavad valja — need on liiga
// sageli midagi muud kui number.
const ROMAN = /^(?=[mdclxvi]{2,})m*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/i;

const LOWER_WORDS = new Set([
  'etapp','etapid','etappi','avaetapp','finaal',
  'jooks','jooksud','jooksu','jooksupaev','joouspaev',
  'rahvajooks','linnajooks','suurjooks','maijooks','ohtujooks','kevadjooks',
  'sugisjooks','talvejooks','metsajooks','maastikujooks','tervisejooks',
  'soit','soidud','soidu','rahvasoit','rattasoit','lastesoit','temposoit','temposoidu',
  'maraton','poolmaraton','rattamaraton','maastikumaraton','teatemaraton','oomaraton',
  'triatlon','rahvatriatlon','kross','rattakross','ralli','rattaralli','velotuur',
  'suusasoit','suusasarja','seeriajooksu','karikasarja','jooksusarja','lastesarja',
  'sprindisarja','sari','sarja','seeriavoistlus','seeriavoistlused',
  'jooksusari','suusasari','sprindisari','karikasari','lastesari','seeriajooks',
  'meistrivoistlused','karikavoistlused','malestusvoistlus','malestusvoistlused',
  'kiiruisuklubi','kolmapaevakud','orienteerumiskolmapaevakud','spordinadal',
  'paev','paevad','valla','linna','umber','ja','ning','ehk','km','liigub',
  'jarve','moisa','silda','sild','voistlus','voistlused','sisemaraton',
  'ujumismatk','sudaoojooks','oojooks','matk','ujumine','koolide','kooli',
  'suusatamises','jooksus','ujumises','orienteerumises','kergejoustikus',
  'murdmaasuusatamises','triatlonis','rattasoidus','suuskadel','vigursoit',
]);

// Eesti tapitahed peavad olema motestatud ka siis, kui allikas kirjutab need
// eri moodi — vordleme ilma diakriitikuteta.
function foldWord(w) {
  return w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function tidyName(name) {
  const letters = (name.match(/\p{L}/gu) || []).length;
  const upper = (name.match(/\p{Lu}/gu) || []).length;
  if (!letters || upper / letters < 0.8) return name;
  return name.toLowerCase()
    .replace(/(^|[\s(\[„"'\-\/.])(\p{L})/gu, (m, p, c) => p + c.toUpperCase())
    .replace(/\p{L}+/gu, (w, off, all) => {
      const U = w.toUpperCase();
      if (KEEP_CAPS.has(U) || ROMAN.test(w)) return U;
      // Esimene sona jaab alati suureks, ka siis kui ta on nimekirjas.
      // Mottekriipsu voi koolonit jargnev sona alustab uut osa ("... 3. etapp
      // - Vigursoit") ja jaab suureks nagu esimene sona. Sidekriips ilma
      // tuhikuta on liitsona ("Laane-Virumaa"), see reegel sinna ei kai.
      const segiAlgus = off === 0 || /[\u2013\u2014:-]\s+$/.test(all.slice(0, off));
      if (!segiAlgus && LOWER_WORDS.has(foldWord(w))) return w.toLowerCase();
      return w;
    });
}

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
${o.robots ? `<meta name="robots" content="${o.robots}">` : ''}
<meta name="theme-color" content="#FFFFFF">

<!-- Jagamiskaart. Ilma nendeta naitab Messenger, WhatsApp voi Slack
     paljast aadressi ilma pealkirja ja pildita. og:image PEAB olema
     taisaadress — suhteline tee ei toimi, sest kaardi ehitab vork,
     mitte brauser. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="LostTimes">
<meta property="og:locale" content="et_EE">
<meta property="og:url" content="${o.canonical}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="LOSTTIMES. Ei leia jälle tulemusi? Siin nad on.">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..800&display=swap" rel="stylesheet">
<style>
:root{--bg:#FFFFFF;--ink:#13202B;--red:#FF4938;--slate:#66717D;--line:#E7EBED;
--sans:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg)}
body{font-family:var(--sans);color:var(--ink);font-size:16px;line-height:1.55;
-webkit-font-smoothing:antialiased;padding-bottom:env(safe-area-inset-bottom)}
a{color:inherit}
.wrap{max-width:640px;margin:0 auto;padding:0 22px}
.top{position:relative;display:flex;align-items:center;justify-content:space-between;padding:26px 0 0}
/* Logo ja ikoonid peavad seisma TAPSELT samal joonel. Varem oli logo
   20px korge tekstikast ja ikoon 44px nupu sees — nende optilised keskmed
   erinesid paari piksli vorra ja seda oli naha.
   Nuud on molemal 44px korge kast, mis negatiivsete marginaalidega
   kokku surutakse 20px-ni. align-items:center joondab kastide keskmed,
   ja kuna tekst on oma kastis samuti keskel, langevad ka keskmed kokku.
   Boonus: logol on nuud korralik 44px puutepind. */
.logo{display:inline-flex;align-items:center;height:44px;margin:-12px 0;
font-weight:700;font-size:20px;letter-spacing:-.035em;
line-height:1;text-decoration:none;color:var(--ink)}
.logo i{color:var(--red);font-style:normal}
.icons button{width:40px;height:40px;display:grid;place-items:center;margin-top:-9px;
background:none;border:0;cursor:pointer;color:var(--ink)}
.icons button svg{width:21px;height:21px;stroke:currentColor;stroke-width:2;fill:none;
stroke-linecap:round;stroke-linejoin:round}
.icons button[aria-expanded="true"]{color:var(--red)}
.menu{position:absolute;right:0;top:calc(100% + 8px);z-index:40;width:206px;
max-width:calc(100vw - 44px);background:var(--bg);border:1px solid var(--line);
border-radius:16px;padding:10px 16px;box-shadow:0 12px 32px rgba(19,32,43,.10)}
.menu[hidden]{display:none}
.menu a{display:block;padding:9px 0;font-size:15px;font-weight:600;
color:var(--ink);text-decoration:none;text-align:center}
.menu a:hover{color:var(--red)}
h1{margin:30px 0 0;font-size:clamp(22px,7.7vw,33px);font-weight:640;
letter-spacing:-.028em;line-height:1.14}
.meta{margin-top:10px;font-size:15.5px;color:var(--slate);font-weight:500}
.cta{display:inline-block;margin-top:22px;padding:13px 22px;border-radius:100px;
background:var(--red);color:#fff;font-size:15.5px;font-weight:600;text-decoration:none}
.alt{display:inline-block;margin-top:22px;margin-left:10px;font-size:15px;
font-weight:600;text-decoration:none}
.note{margin-top:18px;font-size:14.5px;color:var(--slate)}
ul.list{margin:18px 0 0;padding:0;list-style:none}
ul.list li{padding:14px 0;border-bottom:1px solid #F0F3F4}
ul.list .n{font-weight:600;font-size:16.5px;text-decoration:none}
ul.list .d{display:block;font-size:13px;color:var(--slate);font-weight:500;margin-top:3px}
ul.list .r{font-weight:600;font-size:14.5px;color:var(--red);text-decoration:none}
ul.list .s{font-weight:600;font-size:14.5px;text-decoration:none;margin-left:12px}
.years{display:flex;flex-wrap:wrap;gap:7px;margin-top:18px}
.years a{padding:7px 13px;border:1px solid var(--line);border-radius:100px;
font-size:13.5px;font-weight:600;text-decoration:none}
footer{margin-top:40px;padding:20px 0 44px;border-top:1px solid var(--line);
color:var(--slate);font-size:12.5px;font-weight:500;line-height:1.65}
footer strong{color:var(--ink);font-weight:600}

/* Otsing arhiivilehel. Otsingumootorit siin EI dubleerita — vorm saadab
   parisu avalehele (/?q=...), kus kogu loogika juba on. Uks mootor, mitte
   kaks, mis aja jooksul lahku kasvavad.
   Kirjasuurus 16px on tahtlik: alla selle suumib iOS Safari valjale
   klikkides lehe sisse ja kasutaja peab kaega tagasi suumima. */
form.find{margin:20px 0 0;display:flex;gap:10px;align-items:center}
form.find input{flex:1;min-width:0;padding:11px 0;font-family:var(--sans);
font-size:16px;font-weight:500;color:var(--ink);background:none;border:0;
border-bottom:2px solid var(--ink);outline:none}
form.find input::placeholder{color:var(--slate);font-weight:500}
form.find button{border:0;background:none;font-family:var(--sans);font-size:15px;
font-weight:600;color:var(--red);cursor:pointer;padding:8px 2px}

/* ---------- desktop ----------
   Sama polumotte, mis avalehel: ainult paigutus, koik @media sees.
   .wrap laieneb ka siin, et pais ja logo ei hupaks avalehelt voistluse
   lehele minnes kohta. Tekstiloikude enda max-width (32em / 30em) hoiab
   lugemispikkuse ikka lyhikesena — laiem konteiner ei tee ridu pikemaks. */
@media (min-width:900px){
  .wrap{max-width:1000px}
  ul.list li{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 24px}
  ul.list .d{display:block;margin-top:0;margin-left:auto}
}
</style>
${o.jsonld ? `<script type="application/ld+json">${o.jsonld}</script>` : ''}
</head>
<body>
<div class="wrap">
<div class="top">
<a class="logo" href="/">LOSTTIMES<i>.</i></a>
<div class="icons">
<button id="btn-menu" aria-label="Menüü" aria-expanded="false" aria-controls="menu">
<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
</button>
</div>
<div class="menu" id="menu" hidden>
<a href="/arhiiv/">Arhiiv</a>
<a href="/reklaam/">Reklaam</a>
<a href="/kontakt/">Kontakt</a>
<a href="mailto:info@losttimes.ee?subject=V%C3%B5istlus%20puudu">Võistlus puudu?</a>
</div>
</div>
${o.body}
<footer><strong>Me ei hoia tulemusi. Me lihtsalt teame, kus need on.</strong><br>
Iga link viib otse ametlikku allikasse.</footer>
</div>
<script>
if(location.hostname.endsWith('.pages.dev'))location.replace('https://losttimes.ee'+location.pathname+location.search+location.hash);
var m=document.getElementById('menu'),b=document.getElementById('btn-menu');
b.addEventListener('click',function(e){e.stopPropagation();m.hidden=!m.hidden;
b.setAttribute('aria-expanded',String(!m.hidden));});
document.addEventListener('click',function(e){if(!m.hidden&&!m.contains(e.target))m.hidden=true;});
document.addEventListener('keydown',function(e){if(e.key==='Escape')m.hidden=true;});
</script>
</body>
</html>`;

function resultsLink(e) {
  const r = e.sources.find((s) => s.links.results);
  return r ? r.links.results : null;
}

// KAS SEE LEHT VAARIB INDEKSIT?
//
// Kusimus, millele iga indekseeritav leht peab vastama: mis kasu on
// Google'i kasutajal siit lehest vorreldes sellega, kui Google saadaks
// ta otse ajavotja juurde?
//
// Kui meil on valine link, on vastus selge — see leht ON see, mis seob
// voistluse nime ja aasta oige ajavotu-URLiga, ja seda seost mujal ei ole.
//
// Kui valist linki ei ole, utleb leht kulastajale "me ei tea, kus tulemused
// on" ja pakub Google'i otsingut. Kasutaja tuli Google'ist. Selline leht ei
// lahenda midagi ja indeksis teeb ta kahju, mitte kasu.
//
// Reegel on ISETERVENEV: kui oine resolver leiab hiljem lingi, muutub leht
// jargmisel jooksul ise indekseeritavaks. Kaitsi nimekirja hoida ei ole vaja.
function isOwn(url) {
  return !url || url.includes('losttimes.ee') || url.startsWith('/');
}

export function worthIndexing(e) {
  const res = resultsLink(e);
  if (!isOwn(res)) return true;
  return e.sources.some((x) => x.links.startlist && !isOwn(x.links.startlist));
}

// noindex EI tahenda lehe peitmist. Leht jaab saidile, teda roomatakse ja
// follow annab arhiivile ning sarjahubidele endiselt linkivaartust edasi.
// Kaob ainult indeksikirje.
const ROBOTS_THIN = 'noindex,follow';

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
    ? `<p class="note"><a href="/race/${e.hub}">Kõik ${esc(tidyName(e.name).replace(/\s*\(?\d{4}\)?\s*$/, ''))} aastad →</a></p>`
    : '';

  return SHELL({
    title: `${tidyName(e.name)} ${year} tulemused | LostTimes`,
    description: `${tidyName(e.name)} — ${when}${where}. ` +
      (res ? 'Otselink tulemustele ja stardinimekirjale.' : 'Kust leida selle võistluse tulemused.'),
    canonical: `${SITE}/race/${e.slug}`,
    robots: worthIndexing(e) ? null : ROBOTS_THIN,
    jsonld: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: tidyName(e.name),
      startDate: e.date,
      ...(e.location ? { location: { '@type': 'Place', name: e.location } } : {}),
      ...(res ? { url: res } : {}),
    }),
    body: `<h1>${esc(tidyName(e.name))}</h1>
<p class="meta">${esc(when)}${esc(where)}${e.sport ? ' · ' + esc(e.sport) : ''}</p>
${action}${extras.join('')}
${res ? '' : '<p class="note">Selle võistluse tulemuste asukoht ei ole meil teada. Kui sa selle leiad, kirjuta ja lisame.</p>'}
${others}
${year > String(new Date().getFullYear())
  // Tuleviku aastal ei ole arhiivilehte — need voistlused ei ole toimunud.
  // Saadame /upcoming peale, mis on nende paris kodu.
  ? '<p class="note"><a href="/upcoming/">Kõik tulemas olevad võistlused →</a></p>'
  : `<p class="note"><a href="/arhiiv/${year}/">Kõik ${year}. aasta võistlused →</a></p>`}`,
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
        res
          ? `<a class="r" href="${esc(res)}" aria-label="${esc(tidyName(name))} ${y} tulemused">${y} tulemused</a>`
          : `<a class="r" href="/race/${e.slug}" aria-label="${esc(tidyName(name))} ${y}">${y}</a>`,
        start && start.links.startlist !== res
          ? `<a class="s" href="${esc(start.links.startlist)}" aria-label="${esc(tidyName(name))} ${y} stardinimekiri">Stardinimekiri</a>` : '',
      ].join('');
      return `<li>${links}<span class="d">${esc(etDate(e.date))}${e.location ? ' · ' + esc(e.location) : ''} · <a href="/race/${e.slug}">detailid</a></span></li>`;
    })
    .join('\n');

  const first = rows[rows.length - 1].date.slice(0, 4);
  const last = rows[0].date.slice(0, 4);

  return SHELL({
    title: `${tidyName(name)} tulemused — kõik aastad | LostTimes`,
    description: `${tidyName(name)} tulemused aastate kaupa: ${first}–${last}. Otselingid ajavõtjate lehtedele.`,
    canonical: `${SITE}/race/${baseSlug(name)}`,
    // Hub, mille koik kumme aastat on tuhjad, on kumme korda tuhi leht.
    robots: rows.some(worthIndexing) ? null : ROBOTS_THIN,
    body: `<h1>${esc(tidyName(name))}</h1>
<p class="meta">${rows.length} korda · ${first}–${last}</p>
<ul class="list">${items}</ul>`,
  });
}

function yearPage(year, rows) {
  const items = rows
    .map((e) => `<li><a class="n" href="/race/${e.slug}">${esc(tidyName(e.name))}</a>
<span class="d">${esc(etDate(e.date))}${e.location ? ' · ' + esc(e.location) : ''}</span></li>`)
    .join('\n');

  return SHELL({
    title: `${year}. aasta võistluste tulemused | LostTimes`,
    description: `Kõik ${year}. aasta Eesti jooksu-, ratta-, suusa- ja triatlonivõistlused ning tulemuste lingid. Kokku ${rows.length} võistlust.`,
    canonical: `${SITE}/arhiiv/${year}/`,
    body: `<h1>${year}. aasta võistlused</h1>
<p class="meta">${rows.length} võistlust</p>
<form class="find" action="/" method="get" role="search">
<input name="q" type="search" placeholder="Otsi võistlust" aria-label="Otsi võistlust">
<button type="submit">Otsi</button></form>
<ul class="list">${items}</ul>`,
  });
}

function archiveIndex(years) {
  // Arhiiv on TOIMUNUD voistluste kohta. 2027. aasta suusamaraton ei ole
  // arhiiv vaid kalender — ta elab /upcoming lehel. Jooksev aasta jaab
  // sisse, sest seal on nii toimunud kui tulevasi.
  const thisYear = String(new Date().getFullYear());
  years = years.filter((y) => y.year <= thisYear);
  const total = years.reduce((n, y) => n + y.count, 0);
  return SHELL({
    title: 'Spordivõistluste tulemuste arhiiv | LostTimes',
    description: `Eesti jooksu-, ratta-, suusa- ja triatlonivõistluste tulemused aastate kaupa. Kokku ${total} võistlust.`,
    canonical: `${SITE}/arhiiv/`,
    body: `<h1>Tulemuste arhiiv</h1>
<p class="meta">${total} võistlust, ${years[years.length - 1].year}–${years[0].year}</p>
<div class="years">${years.map((y) => `<a href="/arhiiv/${y.year}/">${y.year}</a>`).join('')}</div>
<form class="find" action="/" method="get" role="search">
<input name="q" type="search" placeholder="Otsi võistlust" aria-label="Otsi võistlust">
<button type="submit">Otsi</button></form>`,
  });
}

/** Reamärgistus, mis läheb avalehe HTML-i sisse crawleri jaoks. */
function ssrRows(rows) {
  return rows
    .map((e) => {
      const d = new Date(e.date + 'T12:00:00');
      const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
      const res = resultsLink(e);
      // Sama reegel mis kliendipoolses renderis: aastaarv ainult siis, kui
      // voistlus ei ole jooksvast aastast. Muidu naeks crawler ja esimene
      // pilguheit eri asja kui see, mis JS-i jarel ekraanile jaab.
      const yr = e.date.slice(0, 4);
      const yrHtml = yr === String(new Date().getFullYear()) ? '' : `<div class="yr">${yr}</div>`;
      return `<article class="row"><div class="date"><div class="day">${String(d.getDate()).padStart(2,'0')}</div><div class="mon">${mon}</div>${yrHtml}</div>` +
        `<div class="body"><h2><a class="title" href="/race/${e.slug}">${esc(tidyName(e.name))}</a></h2>` +
        `<div class="acts"><a class="res" href="${res ? esc(res) : `/race/${e.slug}`}" ` +
        `aria-label="Results — ${esc(tidyName(e.name))} tulemused">Results <span class="arr">↗</span></a></div></div></article>`;
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
  const nowYear = String(new Date().getFullYear());
  for (const [year, rows] of byYear) {
    // Tuleviku aasta ei ole arhiiv. Ilma selleta jai /arhiiv/2027/ alles ka
    // siis, kui me ta esilehelt ara votsime — kaust lihtsalt kirjutati uuesti.
    if (year > nowYear) continue;
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
      '<title>Tulemas — Spordivõistluste kalender | LostTimes</title>')
    .replace(/<meta name="description" content="[^"]*">/,
      '<meta name="description" content="Tulemas olevad Eesti jooksu-, ratta-, suusa- ja triatlonivõistlused. Stardinimekirjad ja tulemuste lingid ühes kohas.">')
    .replace(/<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="${SITE}/upcoming/">`)
    // Jagamiskaart peab jargima lehte, mitte avalehte — muidu naitab
    // Messenger /upcoming lingi juures avalehe pealkirja.
    .replace(/<meta property="og:url" content="[^"]*">/,
      `<meta property="og:url" content="${SITE}/upcoming/">`)
    .replace(/<meta property="og:title" content="[^"]*">/,
      '<meta property="og:title" content="Tulemas — Spordivõistluste kalender | LostTimes">')
    .replace(/<meta property="og:description" content="[^"]*">/,
      '<meta property="og:description" content="Tulemas olevad Eesti jooksu-, ratta-, suusa- ja triatlonivõistlused. Stardinimekirjad ja tulemuste lingid ühes kohas.">')
    // Oige tab on valitud juba staatilises HTML-is, mitte alles siis kui JS
    // jouab kohale. Nii ei valgu kasutajale hetkeks vale sakk silma ja
    // crawler naeb samuti oiget seisu.
    .replace('<a id="tab-past" role="tab" href="/" aria-selected="true">',
             '<a id="tab-past" role="tab" href="/" aria-selected="false">')
    .replace('<a id="tab-next" role="tab" href="/upcoming/" aria-selected="false">',
             '<a id="tab-next" role="tab" href="/upcoming/" aria-selected="true">');
  await writeFile('site/upcoming/index.html', upcoming);

  // 7. Sitemap ja robots
  const urls = [
    // /reklaam on meelega valjas — ta kannab noindex'it. Sitemap on
    // soovitus "indekseeri need", noindex on kask "ara indekseeri";
    // koos saadaksime Google'ile vasturaakiva signaali.
    `${SITE}/`, `${SITE}/upcoming/`, `${SITE}/arhiiv/`, `${SITE}/kontakt/`,
    ...[...byYear.keys()].filter((y) => y <= nowYear).map((y) => `${SITE}/arhiiv/${y}/`),
    // Sitemapis on AINULT need, mida me tahame indeksis naha. Sama reegel,
    // mis maarab noindex'i — muidu utleks sitemap "indekseeri" ja lehe enda
    // margend "ara indekseeri", ja me saadaksime vasturaakiva signaali.
    ...[...series.entries()]
      .filter(([h, r]) => r.length >= 2 && !used.has(h) && r.some(worthIndexing))
      .map(([h]) => `${SITE}/race/${h}`),
    ...events.filter(worthIndexing).map((e) => `${SITE}/race/${e.slug}`),
  ];
  await writeFile('site/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>\n`);

  await writeFile('site/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

  console.log(`[lehed] ${events.length} võistlust, ${hubs} sarja hubi, ${byYear.size} aastalehte`);
  console.log(`[lehed] avaleht ja /upcoming eelrenderdatud, sitemapis ${urls.length} aadressi`);
}
