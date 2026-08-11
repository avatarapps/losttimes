// Antrotsenter — WordPressi leht, kus tabelit hooldatakse kasitsi.
//
// See on naide "vaese mehe allikast": me ei saa siit asukohta, distantse ega
// live'i — ainult KUUPAEV | NIMI | LINK. Ja sellest piisab, sest lehe tookoht
// on anda oige viit, mitte hoida tulemusi.
//
// Kuna tabel on inimese kirjutatud, on see habras. Kui parser lakkab
// kirjeid leidmast, teatab monitooring sellest ise.

import * as cheerio from 'cheerio';
import { fetchHtml, absoluteUrl, clean, parseNumericDate } from '../lib.mjs';

const BASE = 'https://antrotsenter.ee';

export default {
  id: 'antrotsenter',
  label: 'Antrotsenter',
  async fetchEvents() {
    const html = await fetchHtml(`${BASE}/tulemused2/`, 'antrotsenter-tulemused');
    const $ = cheerio.load(html);
    const events = [];

    $('tr').each((_, el) => {
      const cells = $(el).find('td');
      if (cells.length < 2) return;

      const dateText = clean($(cells[0]).text());
      const date = parseNumericDate(dateText);
      if (!date) return;

      const name = clean($(cells[1]).text());
      if (!name || name.length < 4) return;

      // Tulemuste link voib olla nime- voi info-lahtris.
      const anchor = $(el).find('a[href]').filter((__, a) => {
        const href = $(a).attr('href') || '';
        return !/^(#|mailto:|tel:)/.test(href);
      }).first();

      const href = anchor.length ? absoluteUrl(anchor.attr('href'), BASE) : `${BASE}/tulemused2/`;

      events.push({
        source: 'antrotsenter',
        sourceId: `${date}-${name.replace(/\W+/g, '-').toLowerCase()}`.slice(0, 80),
        name,
        date,
        location: null,
        sport: null,
        distanceCount: 1,
        links: { results: href, startlist: null, live: null, organiser: null },
        distances: [],
      });
    });

    return events;
  },
};
