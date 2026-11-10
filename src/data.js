import { CHAINS, chainForTags } from './chains.js';
import { unitPrice } from './units.js';

// Live price data (MIT-licensed, refreshed daily by the Checkjebon.nl project).
const PRICES_LIVE = 'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json';
const PRICES_SNAPSHOT = 'data/prices-snapshot.json';

// Amsterdam bounding box (south, west, north, east) for OpenStreetMap store lookup.
const AMSTERDAM_BBOX = [52.278, 4.728, 52.431, 5.079];
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const STORES_SNAPSHOT = 'data/stores-snapshot.json';
const STORE_CACHE_KEY = 'ams-stores-v1';
const STORE_CACHE_MS = 7 * 24 * 3600 * 1000;

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
    raw = await fetchJson(PRICES_LIVE, {}, 25000);
    source = 'live';
  } catch (e) {
    console.warn('Live prices unavailable, using snapshot', e);
    raw = await fetchJson(PRICES_SNAPSHOT, {}, 60000);
    source = 'snapshot';
  }
  const products = [];
  const chainsWithData = [];
  const logos = {};
  for (const chain of raw) {
    if (chain.i) logos[chain.n] = chain.i;
    if (!CHAINS[chain.n] || !chain.d?.length) continue;
    chainsWithData.push(chain.n);
    for (const p of chain.d) {
      if (!(p.p > 0)) continue;
      products.push({
        chain: chain.n,
        name: p.n,
        size: p.s || '',
        price: p.p,
        url: chain.u && p.l ? chain.u + p.l : null,
        link: p.l,
        unit: unitPrice(p),
        key: normalize(p.n + ' ' + (p.s || '')),
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

export async function loadStores() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORE_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < STORE_CACHE_MS && cached.stores?.length) {
      return { stores: cached.stores, source: 'cache' };
    }
  } catch { /* storage unavailable */ }

  const [s, w, n, e] = AMSTERDAM_BBOX;
  const query = `[out:json][timeout:60];(node["shop"="supermarket"](${s},${w},${n},${e});way["shop"="supermarket"](${s},${w},${n},${e}););out center tags;`;
  for (const url of OVERPASS_URLS) {
    try {
      const json = await fetchJson(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 45000);
      const stores = parseOverpass(json);
      if (stores.length) {
        try { localStorage.setItem(STORE_CACHE_KEY, JSON.stringify({ at: Date.now(), stores })); } catch { /* ignore */ }
        return { stores, source: 'live' };
      }
    } catch (err) {
      console.warn('Overpass failed', url, err);
    }
  }
  try {
    const json = await fetchJson(STORES_SNAPSHOT, {}, 15000);
    return { stores: parseOverpass(json), source: 'snapshot' };
  } catch {
    return { stores: [], source: 'unavailable' };
  }
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
