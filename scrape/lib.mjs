// Uhised abifunktsioonid koigile allikatele.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const SAVE_FIXTURES = process.argv.includes('--save-fixtures');

const UA =
  'Mozilla/5.0 (compatible; wheresmytime.ee/0.1; +https://wheresmytime.ee) ' +
  'link-aggregator, contact: info@wheresmytime.ee';

/**
 * Laeb lehe alla. --save-fixtures lipuga salvestab toorHTML-i fixtures/ kausta,
 * et saaks parserit ilma vorguta silmata.
 */
export async function fetchHtml(url, fixtureName, { timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'et' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${url}`);
  const html = await res.text();

  if (SAVE_FIXTURES && fixtureName) {
    const file = path.join('fixtures', `${fixtureName}.html`);
    await mkdir('fixtures', { recursive: true });
    await writeFile(file, html);
    console.log(`  [fixture] ${file} (${(html.length / 1024).toFixed(0)} kB)`);
  }
  return html;
}

/** Viisakas paus paringute vahel — arge koormake teiste servereid. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function absoluteUrl(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

const MONTHS_ET = {
  jaan: 1, veebr: 2, marts: 3, mar: 3, apr: 4, mai: 5, juuni: 6, juuli: 7,
  aug: 8, sept: 9, okt: 10, nov: 11, dets: 12,
  jan: 1, feb: 2, jun: 6, jul: 7, sep: 9, oct: 10, dec: 12,
};

/** "10. AUG 2026" -> "2026-08-10" */
export function parseTextDate(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\.?\s*([A-Za-zÄÖÜÕäöüõ]{3,6})\.?\s*(\d{4})/);
  if (!m) return null;
  const key = m[2].toLowerCase().slice(0, 5).replace(/\.$/, '');
  const month =
    MONTHS_ET[key] ?? MONTHS_ET[key.slice(0, 4)] ?? MONTHS_ET[key.slice(0, 3)];
  if (!month) return null;
  return iso(Number(m[3]), month, Number(m[1]));
}

/** "11.08" voi "17.01.2026" -> ISO. Aasta puudumisel arvatakse lahim. */
export function parseNumericDate(text, fallbackYear = new Date().getFullYear()) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : fallbackYear;

  if (!m[3]) {
    // Ilma aastata: kui kuupaev jaaks rohkem kui 6 kuud tulevikku, on see mullune.
    const guess = new Date(Date.UTC(year, month - 1, day));
    const diffMonths = (guess - new Date()) / (1000 * 60 * 60 * 24 * 30);
    if (diffMonths > 6) year -= 1;
  }
  return iso(year, month, day);
}

function iso(y, m, d) {
  if (!y || !m || !d) return null;

  // Kasitsi hooldatud tabelites on paratamatult prahti (paev 32, kuu 13,
  // aasta 1900). Kontrollime, kas kuupaev on paris — vigane kirje jaab valja,
  // sest vale kuupaev rikub hiljem kogu kokkuliitmise.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 2000 || y > new Date().getFullYear() + 2) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // nt 31. veebruar

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Normaliseerib voistluse nime, et sama uritus eri allikatest kokku laheks.
 * "53. Tartu Maraton" ja "Tartu Maraton 2026" -> "tartu maraton"
 */
export function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[ivxlcdm]+\.?\s+/i, '')       // rooma numbrid ees
    .replace(/^\d+\.?\s*/, '')                // "53. "
    .replace(/\b(19|20)\d{2}\b/g, '')         // aastaarvud
    .replace(/\b\d+\.\s*etapp\b/g, '')        // "8. etapp"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function logSource(id, events) {
  console.log(`  ${id}: ${events.length} kirjet`);
  return events;
}
