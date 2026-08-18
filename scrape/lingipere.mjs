// Linkide pere: ühest teadaolevast lingist tuletatakse ülejäänud
//
// MIKS SEE OLEMAS ON
// Ajavotususteemidel on aadressid ehitatud mustri jargi. Kui me teame
// voistluse numbrit uhes kohas, teame teda ka teistes:
//
//   my.raceresult.com/406189/info
//   my.raceresult.com/406189/results        <- sama voistlus
//   my.raceresult.com/406189/participants   <- sama voistlus
//
//   stamina.ee/et/jarvejooks/voistlused?competition_id=297
//   ...?competition_id=297&action=results
//   ...?competition_id=297&action=registered
//
// Molemad mustrid ei ole minu oletus — Eva saatis need ise, Kooraste ja
// Ulemiste jarve jooksu kohta, taielike komplektidena. Siin on nad reegliks
// tehtud, et sama tood ei peaks iga voistluse jaoks uuesti tegema.
//
// MOOTMINE ENNE EHITAMIST
// Arhiivis oli 360 voistlust, kus platvorm oli teada, aga mone lingi koht
// tuhi. Need on voistlused, mille tulemusteni me saaksime lugeja viia ilma
// uhtegi lehte juurde lugemata.
//
// MIDA SIIN EI TEHTA
// ChampionChipi ja Nelsoni juures on tulemuste aadress teada, aga
// stardinimekirja oma mitte. Ma EI hakka seda pakkuma. Vale aadress on
// halvem kui puuduv: lugeja klopsib ja satub veateatele, aga usub, et
// meie leht on katki. Kui neist tuleb kunagi kinnitatud naide, saab
// mustri siia lisada.
//
// TULETATUD LINK EI VOIDA KASITSI ANTUT
// Uus allikas laheb massiivi LOPPU, mitte algusesse. resultsLink() votab
// esimese, seega kasitsi parandus ja korraldaja enda leht jaavad ette.
// Tuletatud link taidab ainult tuhja kohta.

const PERED = [
  {
    nimi: 'raceresult',
    // my.raceresult.com/<number>/<mistahes leht>
    tunne: /^(https?:\/\/my\.raceresult\.com\/(\d+))(?:\/|$)/i,
    ehita: (m) => ({
      organiser: `${m[1]}/info`,
      results: `${m[1]}/results`,
      startlist: `${m[1]}/participants`,
    }),
  },
  {
    nimi: 'BestIT',
    // ?competition_id=<number> — eestimaraton, stamina, rattamaratonid,
    // estoloppet, tartumaraton. Alus votame lingist endast, mitte
    // nimekirjast: igal saidil on tee erinev.
    tunne: /[?&]competition_id=\d+/i,
    ehita: (_, url) => {
      const u = new URL(url);
      u.searchParams.delete('action');
      const alus = u.toString();
      return {
        organiser: alus,
        results: `${alus}&action=results`,
        startlist: `${alus}&action=registered`,
      };
    },
  },
];

// Uhest lingist pere, voi null kui muster ei sobi.
export function pere(url) {
  if (!url) return null;
  for (const p of PERED) {
    const m = String(url).match(p.tunne);
    if (m) {
      try {
        return { nimi: p.nimi, ...p.ehita(m, url) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

const oma = (u) => !u || u.includes('losttimes.ee') || u.startsWith('/');

export function applyLingipere(events) {
  let taidetud = 0;
  const platvormid = {};

  for (const e of events) {
    // Millised kohad on praegu tuhjad?
    const onOlemas = (valja) => e.sources.some((s) => !oma(s.links[valja]));
    const puudu = ['results', 'startlist', 'organiser'].filter((v) => !onOlemas(v));
    if (!puudu.length) continue;

    // Otsi esimene link, millest saab pere tuletada. Kaime KOIK valjad labi,
    // sest seeme voib olla ukskoik kummas: vahel on meil ainult tulemused,
    // vahel ainult korraldaja leht.
    let leitud = null;
    for (const s of e.sources) {
      for (const v of ['results', 'startlist', 'organiser', 'info']) {
        if (oma(s.links[v])) continue;
        leitud = pere(s.links[v]);
        if (leitud) break;
      }
      if (leitud) break;
    }
    if (!leitud) continue;

    const uued = { results: null, startlist: null, live: null, organiser: null, info: null };
    let midagi = false;
    for (const v of puudu) {
      if (!leitud[v]) continue;
      uued[v] = leitud[v];
      midagi = true;
      taidetud++;
    }
    if (!midagi) continue;

    platvormid[leitud.nimi] = (platvormid[leitud.nimi] || 0) + 1;

    // LOPPU, et kasitsi antud ja korraldaja lingid jaaksid ette.
    e.sources.push({
      id: 'lingipere',
      label: leitud.nimi,
      links: uued,
      distanceCount: 0,
    });
  }

  const kokku = Object.entries(platvormid).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`[lingipere] täitsin ${taidetud} tühja linki${kokku ? ` (${kokku})` : ''}`);
  return events;
}
