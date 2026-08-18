// Registreerimisleht ei ole ürituse leht
//
// MIKS SEE OLEMAS ON
// Sportos annab korraldaja lingiks sageli selle aadressi, kust saab end kirja
// panna: "iseteenindus.xco.ee/?g=428", "reg.sportiv.ee/?g=435",
// "my.raceresult.com/374301/registration". Kasutaja klopsib "Korraldaja" ja
// satub makselehele, mitte voistluse juurde. Kui registreerimine on lopetatud,
// on see leht sageli hoopis tuhi voi kinni.
//
// See ei ole uksiku voistluse viga, mida saaks kasitsi parandada — see on
// muster, mis kordub igal hooajal uute voistlustega. Seetottu on siin reegel,
// mitte nimekiri.
//
// KOLM KAIKU
//
//  1. UMBERKIRJUTATAV — registreerimisaadressist saab tuletada paris lehe:
//       iseteenindus.xco.ee/?g=428  ->  xco.ee
//       my.raceresult.com/374301/registration  ->  .../info
//       eestimaraton.ee/...?competition_id=53&action=registered  ->  ilma action-ita
//     Esimene juht on turvaline, sest "iseteenindus.xco.ee" on xco.ee enda
//     alamdomeen — emadomeen ON korraldaja leht. Kontrollime siiski ule ja
//     loobume umberkirjutusest, kui server vastab selge veaga. Vastus laheb
//     cache'i, nii et igal ool ei kusi me sama asja uuesti.
//
//  2. UMBERKIRJUTAMATU — reg.sportiv.ee emadomeen on ise registreerimis-
//     platvorm, mitte korraldaja. Fienta, Lyyti, weebly registreerimine.html.
//     Neil me lihtsalt VOTAME LINGI ARA. Puuduv link on parem kui vale link:
//     tuhja lingi peale klopsates arvab kasutaja, et ta on kohal.
//
//  3. Koik ulejaanud lingid jaavad puutumata.
//
// KUI LINK ARA VOETAKSE, VOIB VOISTLUS LEHELT KADUDA
// See on tahtlik ja jargib sama reeglit, milles juba kokku leppisime:
// linkideta voistlust me ei kuva. Parem on mitte lubada midagi, kui saata
// inimene registreerimisvormi otsa.

import { get, put } from './cache.mjs';

// Muster 1: iseteenindus.<domeen> ja reg.<domeen> — Sportose registreerimis-
// mootor. "?g=428" on selle mootori voistluse number, mitte korraldaja oma.
const ISETEENINDUS = /^(iseteenindus|reg|registreerimine)\./i;

// Muster 2: emadomeen, mis ON ise registreerimisplatvorm. Neil ei ole motet
// emadomeeni proovida — sportiv.ee ei ole Luganuse rahvajooksu korraldaja.
const PLATVORM = /^(sportiv|sportos|fienta|lyyti|entrypoint|osalen)\./i;

// Muster 3: aadressitee, mis raagib registreerimisest.
const REGA_TEE = /\/(reg|registreerimine|registreeru|registreeri|registration|register|signup|sign-up|osale|liitu)(\.html?|\/|$)/i;

const OK = new Map();  // domeen -> kas katki (uhe joosu malu)

// Kas emadomeen on TOENDATAVALT katki?
//
// Loogika on tahtlikult ettevaatlik. "iseteenindus.xco.ee" on xco.ee enda
// alamdomeen — emadomeen ON peaaegu alati korraldaja leht. Seetottu me
// kirjutame lingi umber VAIKIMISI ja kontroll saab seda ainult tuhistada.
//
// Kontroll tuhistab AINULT siis, kui server vastas selge veaga (404, 410,
// 5xx). Vorguviga — DNS ei vastanud, uhendus katkes, aegus — EI ole tostend,
// et leht on halb; see voib olla meie ots. Varem oli see vastupidi ja siis
// oleks uks katkine ohtu maha voetud koik korralikud lingid korraga.
async function domeenKatki(domeen) {
  if (OK.has(domeen)) return OK.get(domeen);

  const kuu = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const votme = `domeen|${domeen}`;
  const malust = get(votme, kuu);
  if (malust && typeof malust.katki === 'boolean') {
    OK.set(domeen, malust.katki);
    return malust.katki;
  }

  let katki = false;
  try {
    const res = await fetch(`https://${domeen}/`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'LostTimes/1.0 (+https://losttimes.ee)' },
    });
    katki = res.status === 404 || res.status === 410 || res.status >= 500;
  } catch {
    katki = false;   // vorguviga ei ole suudistus
  }
  put(votme, { katki });
  OK.set(domeen, katki);
  return katki;
}

// Uks link sisse, uks link (voi null) valja.
// Tagastab { url, miks } — miks on logi jaoks, mitte lehele.
export async function parandaKorraldaja(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { url, miks: null };
  }

  const host = u.hostname.replace(/^www\./, '');

  // raceresult: /NNNN/registration -> /NNNN/info. Sama voistlus, oige leht.
  if (/(^|\.)raceresult\.com$/i.test(host) && /\/registration\/?$/i.test(u.pathname)) {
    return { url: url.replace(/\/registration\/?$/i, '/info'), miks: 'raceresult /info' };
  }

  // BestIT: &action=registered on stardinimekiri, mitte korraldaja leht.
  if (/[?&]action=registered/i.test(u.search)) {
    u.searchParams.delete('action');
    return { url: u.toString(), miks: 'BestIT action maha' };
  }

  const iseteenindus = ISETEENINDUS.test(host);
  const teeRega = REGA_TEE.test(u.pathname);
  if (!iseteenindus && !teeRega) return { url, miks: null };

  // Alamdomeen maha ja proovi emadomeeni — aga ainult siis, kui emadomeen
  // ei ole ise registreerimisplatvorm ja tegelikult vastab.
  if (iseteenindus) {
    const ema = host.replace(ISETEENINDUS, '');
    if (!PLATVORM.test(`${ema}.`) && ema.includes('.')) {
      if (!(await domeenKatki(ema))) {
        return { url: `https://${ema}/`, miks: `iseteenindus -> ${ema}` };
      }
    }
  }

  return { url: null, miks: 'registreerimisleht, link maha' };
}

export async function applyRegaLinks(events) {
  let parandatud = 0;
  let mahav = 0;

  for (const e of events) {
    for (const s of e.sources) {
      // Korraldaja JA info — molemad on lingid, mida kasutaja voib klopsida.
      for (const valja of ['organiser', 'info']) {
        const vana = s.links[valja];
        if (!vana) continue;
        const { url } = await parandaKorraldaja(vana);
        if (url === vana) continue;
        s.links[valja] = url;
        if (url) parandatud++;
        else mahav++;
      }
    }
  }

  console.log(`[regalink] registreerimislinke: parandatud ${parandatud}, eemaldatud ${mahav}`);
  return events;
}
