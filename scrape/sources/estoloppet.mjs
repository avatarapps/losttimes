// Estoloppet — Eesti rahvasuusatajate sari
//
// MIKS SEE FAIL UMBER KIRJUTATI
// Varem oli siin oma parser, mis luges lehte /et/etapid ja otsis sealt
// competition_id linke. Ta leidis neid NULL — ja ma jarel dasin, et leht on
// JavaScriptiga renderdatud. See oli vale jareldus.
//
// Leht /et/etapid on tavaline HTML, aga seal on etapid ainult TEKSTINA:
// number, kuupaev, nimi, distantsid. Ainustki linki ei ole.
//
// Lingid on AVALEHEL. Seal on iga etapi taga nupp "Tulemused" ja nimi ise
// on link kujul:
//
//   https://www.estoloppet.ee/et/etapid?competition_id=455
//
// Sama viga tegin varem eestimaraton.ee juures, kus nimekiri elas /avaleht
// peal, mitte /sundmused peal. Kaks korda sama oppetund: KUI NIMEKIRJA EI
// OLE SEAL, KUS TA LOOGILISELT PEAKS OLEMA, VAATA AVALEHTE.
//
// Kontrollitud kasitsi: ?competition_id=455&action=results avab 40. Viru
// Maratoni protokolli, kus on ka aastate valik 2015-2026. Menuu kinnitab
// tavalise BestITi mustri:
//
//   Uldinfo          ?competition_id=455
//   Registreerunud   &action=registered
//   Tulemused        &action=results
//
// Seega ei ole siin oma parserit vaja — bestItSource oskab seda juba.
//
// NB: avaleht naitab ainult KAESOLEVA hooaja etappe. Vanemad aastad tulevad
// arhiivi kaudu ja tulemuste lehe aastavalikust, mida me ei kae labi.

import { bestItSource } from './bestit.mjs';

export default bestItSource({
  id: 'estoloppet',
  label: 'Estoloppet',
  base: 'https://www.estoloppet.ee/et/etapid',
  list: [
    'https://www.estoloppet.ee/',           // SIIN on lingid
    'https://www.estoloppet.ee/et/etapid',  // siin ainult tekst, aga proovime
    'https://www.estoloppet.ee/et/tulemused',
  ],
  sport: 'Suusatamine',
});
