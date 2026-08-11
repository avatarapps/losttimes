# Where's My Time

Kõikide Eesti harrastusvõistluste stardinimekirjade ja tulemuste lingid ühes kohas.
Me ei hoia tulemusi — me teame ainult, kus need on.

## Kuidas see töötab

```
GitHub Actions (kord ööpäevas)
        ↓
   npm run scrape          → käib läbi 4 ajavõtja indeksilehte
        ↓
   site/events.json        → commititakse repo sisse
        ↓
 Cloudflare Pages          → serveerib site/ kausta staatiliselt
```

Andmebaasi ei ole. Serverit ei ole. Kuutasu ei ole.

## Esimene käivitus

```bash
npm install
npm run scrape      # kirjutab site/events.json
npm run serve       # avab lehe aadressil http://localhost:3000
```

Kui mõni allikas annab 0 kirjet, väljub skript veakoodiga ja Actions saadab kirja.
See on kogu monitooring, mida vaja on.

### Kui parser eksib

Scraperid on kirjutatud lehtede struktuuri põhjal, aga esimesel korral läheb midagi
peaaegu kindlasti valesti. Salvesta toorleht ja vaata, mis seal tegelikult on:

```bash
npm run fixtures    # salvestab kõik allalaetud lehed fixtures/ kausta
```

## Allikad

| Allikas | Katvus | Mida saame | Seis |
|---|---|---|---|
| **Sportos** | suurim — jooks, maantee, maastik, gravel, triatlon, rulluisk, orienteerumine | kuupäev, nimi, asukoht, ala, distantsid, link | lihtne |
| **ChampionChip** | jooks, ratas, triatlon | kuupäev, nimi, asukoht + **eraldi stardinimekirja, tulemuste ja live'i lingid** | lihtne |
| **Estoloppet** | suusamaratonid (Tartu, Haanja, Alutaguse, Viru, Neeruti) | kuupäev, nimi, distantsid | triviaalne, ~7 üritust aastas |
| **Antrotsenter** | segu | ainult kuupäev + nimi + link | habras, käsitsi hooldatud tabel |

Veel lisamata, sest lehed on JS-iga renderdatud ja vajaksid päris brauserit
(Playwright): **racetecresults.com** (TolkNet) ja **triatlon.ee**.
`my.raceresult.com`-il puudub Eesti indeks, seega neid ei saa loetleda —
enamik neist üritustest on niikuinii Sportoses olemas.

**Miinimum uue allika lisamiseks: kuupäev + nimi + link.** Kõik muu on boonus.

## Uue allika lisamine

1. Tee `scrape/sources/nimi.mjs`, mis ekspordib `{ id, label, fetchEvents() }`
2. `fetchEvents()` tagastab massiivi kirjeid kujul:

```js
{
  source: 'nimi',
  sourceId: 'unikaalne-id',
  name: 'Muhu Jooks',
  date: '2026-08-08',              // ISO
  location: 'Muhu spordihall',     // või null
  sport: 'Jooksmine',              // või null
  distances: [],
  links: { results, startlist, live, organiser }   // puuduvad = null
}
```

3. Lisa see `scrape/index.mjs` faili `SOURCES` massiivi.

Sama võistlus eri allikatest liidetakse kokku normaliseeritud nime ja kuupäeva
järgi (±1 päev). Kasutaja näeb ühte kaarti, millel on mõlema ajavõtja nupud —
mis on kasulik, sest vahel on tulemused ühes olemas ja teises mitte.

## Deploy

Cloudflare Pages:

- **Build command:** jäta tühjaks
- **Build output directory:** `site`

Iga kord, kui Actions commitib uue `events.json`-i, deploy'ib Pages ise uuesti.

## Viisakus ja juriidika

- Me ei salvesta ühtegi isikuandmet — ainult võistluse nimi, kuupäev ja link.
  See hoiab GDPR-i probleemid täielikult eemal.
- Iga link viib originaallehele. Me saadame ajavõtjatele liiklust, ei võta seda ära.
- Scraper käib kord ööpäevas ja teeb päringute vahel pausi. Ära seda kiirenda.
- User-Agent on aus ja sisaldab kontaktaadressi.
