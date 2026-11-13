import { CHAINS, chainForTags } from './chains.js';
import { unitPrice } from './units.js';

// Prices: our own daily copy first (same address, compressed, cached for offline use),
// then the live Checkjebon file (MIT-licensed) if that copy is missing.
const PRICES_LOCAL = 'data/prices.json';
const PRICES_LIVE = 'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json';

// Amsterdam bounding box (south, west, north, east) for OpenStreetMap store lookup.
const AMSTERDAM_BBOX = [52.278, 4.728, 52.431, 5.079];
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const STORES_SNAPSHOT = 'data/stores-snapshot.json';

export function normalize(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.,%]+/g, ' ').trim();
}

async function fetchJson(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function loadPrices() {
  let raw, source;
  try {
    raw = await fetchJson(PRICES_LOCAL, {}, 60000);
    source = 'local';
  } catch (e) {
    console.warn('Own price copy unavailable, using the live file', e);
    raw = await fetchJson(PRICES_LIVE, {}, 60000);
    source = 'live';
  }
  const products = [];
  const chainsWithData = [];
  const logos = {};
  for (const chain of raw) {
    if (chain.i) logos[chain.n] = chain.i;
    if (!CHAINS[chain.n] || !chain.d?.length) continue;
    chainsWithData.push(chain.n);
    for (const p of chain.d) {
      if (!(p.p >= 0.05)) continue; // a price of one cent is a data error
      products.push({
        chain: chain.n,
        name: p.n,
        size: p.s || '',
        price: p.p,
        url: chain.u && p.l ? chain.u + p.l : null,
        link: p.l,
        unit: unitPrice(p),
        key: ' ' + normalize(p.n + ' ' + (p.s || '')) + ' ',
      });
    }
  }
  return { products, chainsWithData, logos, source };
}

function parseOverpass(json) {
  const stores = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const tags = el.tags || {};
    const chain = chainForTags(tags);
    if (!chain) continue;
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
    stores.push({
      id: `${el.type}/${el.id}`,
      chain,
      name: tags.name || tags.brand || 'Supermarket',
      address: street || null,
      postcode: tags['addr:postcode'] || null,
      hours: tags.opening_hours || null,
      lat, lon,
    });
  }
  return stores;
}

// The daily snapshot comes first because it is instant; OpenStreetMap is only asked
// directly when the snapshot is missing.
export async function loadStores() {
  try {
    const stores = parseOverpass(await fetchJson(STORES_SNAPSHOT, {}, 15000));
    if (stores.length) return { stores, source: 'snapshot' };
  } catch (err) {
    console.warn('Store snapshot unavailable', err);
  }
  const [s, w, n, e] = AMSTERDAM_BBOX;
  const query = `[out:json][timeout:60];(node["shop"="supermarket"](${s},${w},${n},${e});way["shop"="supermarket"](${s},${w},${n},${e}););out center tags;`;
  for (const url of OVERPASS_URLS) {
    try {
      const json = await fetchJson(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 45000);
      const stores = parseOverpass(json);
      if (stores.length) return { stores, source: 'live' };
    } catch (err) {
      console.warn('Overpass failed', url, err);
    }
  }
  return { stores: [], source: 'unavailable' };
}

// Address, street or postcode -> places, using the Dutch government's free address
// service (PDOK Locatieserver). Results near Amsterdam come first.
export async function findPlaces(q) {
  const url = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?rows=6&fl=weergavenaam,centroide_ll,type'
    + '&fq=type:(adres OR weg OR postcode OR woonplaats OR wijk OR buurt)&lat=52.3728&lon=4.8936&q=' + encodeURIComponent(q);
  let json;
  try { json = await fetchJson(url, {}, 8000); } catch { json = await fetchJson('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?rows=6&q=' + encodeURIComponent(q), {}, 8000); }
  const [s, w, n, e] = AMSTERDAM_BBOX;
  const out = [];
  for (const d of json.response?.docs || []) {
    const m = /POINT\(([\d.]+) ([\d.]+)\)/.exec(d.centroide_ll || '');
    if (!m) continue;
    const lon = +m[1]; const lat = +m[2];
    out.push({ label: d.weergavenaam, lat, lon, near: lat > s - 0.1 && lat < n + 0.1 && lon > w - 0.15 && lon < e + 0.15 });
  }
  return out.sort((a, b) => b.near - a.near);
}

export async function loadOffers() {
  try {
    return await fetchJson('data/offers.json?' + new Date().toISOString().slice(0, 13), {}, 15000);
  } catch {
    return { updatedAt: null, chains: {} };
  }
}

export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
