// Vahemalu urituste lehtedele.
//
// MIKS: Sportos noab iga urituse kohta eraldi lehe avamist, et tulemuste link
// katte saada. Arhiivis on ~11 500 uritust — see teeks kaks tundi paringuid.
//
// Aga toimunud voistluse tulemuste link EI MUUTU ENAM KUNAGI. Seega kusime
// seda uks kord ja jatame meelde. Oine too puudutab siis ainult uusi ja
// varskeid uritusi, mida on paarkummend.
//
// Varsket uritust kusime uuesti, sest tulemused voivad alles ilmuda.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const FILE = 'data/cache.json';

// Kui vana voistlus loetakse "valmis" ja teda enam ei kusita.
const SETTLED_DAYS = 21;

let store = null;

export async function loadCache() {
  if (store) return store;
  try {
    store = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    store = {};
  }
  return store;
}

export async function saveCache() {
  if (!store) return;
  await mkdir('data', { recursive: true });
  await writeFile(FILE, JSON.stringify(store));
}

/** Kas voistlus on piisavalt ammu toimunud, et tulemused enam ei muutuks? */
export function isSettled(eventDate) {
  if (!eventDate) return false;
  const age = (Date.now() - new Date(eventDate + 'T12:00:00').getTime()) / 86400000;
  return age > SETTLED_DAYS;
}

export function get(key, eventDate) {
  if (!store || !(key in store)) return null;
  return isSettled(eventDate) ? store[key] : null;
}

export function put(key, value) {
  if (store) store[key] = value;
}

export function size() {
  return store ? Object.keys(store).length : 0;
}
