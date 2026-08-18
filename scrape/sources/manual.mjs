// Kasitsi lisatud voistlused — data/manual.json
//
// MIKS SEE OLEMAS ON:
// Osa ajavotjaid (racetecresults.com / TolkNet) on Cloudflare'i botikaitse taga.
// Seda ei saa ega tohi mooda hiilida. Kuna lehe tookoht on anda oige viit,
// piisab siin kasitsi kirjest: kuupaev + nimi + link. Uks kirje = pool minutit.
//
// Lisa uus voistlus data/manual.json faili. Kohustuslikud on "name", "date"
// ja VAHEMALT UKS link — results, startlist voi organiser.
//
// Varem oli "results" kohustuslik. See ei tootanud tulevaste voistluste
// puhul: 2027. aasta jooksul EI OLE tulemusi ega saagi olla, ja ainus viis
// teda sisse saada oleks pannud tulemuste lingiks juhendi lehe. See oleks
// lubanud lugejale tulemusi ja andnud talle voistlusjuhendi.
//
// Ilma tulemusteta kirje naitab lehel "Otsi tulemusi" ja korraldaja linki.
// See on aus: me utleme, et meil neid veel ei ole.

import { readFile } from 'node:fs/promises';

export default {
  id: 'manual',
  label: 'Käsitsi',
  // Tuhi kasitsi-nimekiri EI OLE viga. Ilma selle margeta luges monitooring
  // tuhja faili katkiseks allikaks ja kogu ooine too kukkus labi.
  optional: true,
  async fetchEvents() {
    let rows;
    try {
      rows = JSON.parse(await readFile('data/manual.json', 'utf8'));
    } catch (err) {
      console.warn(`  [manual] data/manual.json puudub voi katki: ${err.message}`);
      return [];
    }

    return rows
      .filter((r) => r && r.name && r.date && !/^NÄIDE/.test(r.name) &&
        (r.results || r.startlist || r.organiser))
      .map((r) => ({
        source: 'manual',
        sourceId: `${r.date}-${r.name.replace(/\W+/g, '-').toLowerCase()}`.slice(0, 80),
        name: r.name,
        date: r.date,
        location: r.location || null,
        sport: r.sport || null,
        distanceCount: 1,
        // Sildistame kirje paris ajavotja nimega, mitte sonaga "Kasitsi",
        // et kasutaja naeks nupul "Tulemused TolkNet".
        labelOverride: r.timer || null,
        links: {
          results: r.results || null,
          startlist: r.startlist || null,
          live: r.live || null,
          organiser: r.organiser || null,
          info: r.info || r.organiser || null,
        },
        distances: [],
      }));
  },
};
