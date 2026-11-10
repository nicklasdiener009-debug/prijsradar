#!/usr/bin/env node
// Fetches this week's supermarket offers and writes data/offers.json.
// Runs every morning from GitHub Actions (.github/workflows/update-data.yml).
//
// Built not to break the site:
//  * every chain is fetched independently; one failing never affects the others
//  * responses are read loosely (we walk the JSON for anything that looks like an
//    offer) so small API changes in the chains' apps don't stop it working
//  * if a chain fails or returns nothing, its last good offers are kept until
//    they expire, and the chain is marked "stale" so the site can say so
//  * the script exits non-zero only if *every* chain failed, which makes the
//    workflow open an issue so someone notices

import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/offers.json', import.meta.url);
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';
const today = new Date().toISOString().slice(0, 10);

async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`${r.status} from ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- generic helpers ----------

const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') v = v.amount ?? v.now ?? v.value ?? v.price;
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
  return n > 500 ? n / 100 : n; // some APIs give cents
};
const date = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);

function* walk(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  yield node;
  for (const v of Array.isArray(node) ? node : Object.values(node)) yield* walk(v, depth + 1);
}

function dedupe(offers) {
  const seen = new Map();
  for (const o of offers) {
    const k = (o.title + '|' + o.mechanism).toLowerCase();
    if (!seen.has(k)) seen.set(k, o);
  }
  return [...seen.values()];
}

function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));
}

// ---------- Albert Heijn (app API, anonymous token) ----------

async function fetchAH() {
  const base = 'https://api.ah.nl';
  const headers = { 'x-application': 'AHWEBSHOP', 'Content-Type': 'application/json' };
  const tok = await http(`${base}/mobile-auth/v1/auth/token/anonymous`, { method: 'POST', headers, body: JSON.stringify({ clientId: 'appie' }) });
  const auth = { ...headers, Authorization: `Bearer ${tok.access_token}` };

  const offers = [];
  for (let page = 0; page < 30; page++) {
    const res = await http(`${base}/mobile-services/product/search/v2?page=${page}&size=100&sortOn=RELEVANCE&bonus=BONUS`, { headers: auth });
    const products = res.products || [];
    for (const p of products) {
      if (!p.isBonus && !p.bonusMechanism) continue;
      offers.push(clean({
        title: p.title,
        mechanism: p.bonusMechanism || p.discountLabels?.[0]?.defaultDescription || 'Bonus',
        price: num(p.currentPrice),
        was: num(p.priceBeforeBonus),
        size: p.salesUnitSize,
        validFrom: date(p.bonusStartDate),
        validUntil: date(p.bonusEndDate),
        image: p.images?.find((i) => i.width >= 200)?.url || p.images?.[0]?.url,
        url: p.webshopId ? `https://www.ah.nl/producten/product/wi${p.webshopId}` : null,
      }));
    }
    const total = res.page?.totalPages ?? 0;
    if (!products.length || page + 1 >= total) break;
  }
  return offers;
}

// ---------- Jumbo (app API) ----------

async function fetchJumbo() {
  const offers = [];
  const sources = [];
  const errors = [];
  // The app API version moves now and then; try the recent ones.
  for (const v of ['v17', 'v18', 'v19', 'v20', 'v16']) {
    const base = `https://mobileapi.jumbo.com/${v}`;
    const overview = await http(`${base}/promotion-overview`).catch((e) => { errors.push(`${v} overview: ${e.message}`); return null; });
    if (overview) sources.push(overview);
    for (let offset = 0; offset < 3000; offset += 100) {
      const res = await http(`${base}/search?offset=${offset}&limit=100&filters=promotion`).catch((e) => { errors.push(`${v} search: ${e.message}`); return null; });
      const items = res?.products?.data || [];
      if (!items.length) break;
      sources.push(res);
      if (items.length < 100) break;
    }
    if (sources.length) break;
  }
  for (const src of sources) {
    for (const n of walk(src)) {
      const promo = n.promotion || (Array.isArray(n.promotions) ? n.promotions[0] : null);
      const title = n.title || n.name;
      if (!title || !promo) continue;
      offers.push(clean({
        title,
        mechanism: promo.tags?.[0]?.text || promo.name || promo.title || 'Aanbieding',
        price: num(n.prices?.promotionalPrice) || num(n.prices?.price),
        was: num(n.prices?.price),
        size: n.quantity,
        validFrom: date(promo.fromDate || promo.startDate),
        validUntil: date(promo.toDate || promo.endDate),
        image: n.imageInfo?.primaryView?.[0]?.url || n.image,
        url: n.id ? `https://www.jumbo.com/producten/${n.id}` : null,
      }));
    }
  }
  if (!offers.length) {
    const sample = sources[0] ? JSON.stringify(sources[0]).slice(0, 600) : 'no responses';
    throw new Error(`no offers parsed. ${errors.slice(0, 6).join('; ')}. sample: ${sample}`);
  }
  return offers;
}

// Add more chains here: { id, fetch } returning [{ title, mechanism, price?, was?, validFrom?, validUntil?, image?, url? }]
const ADAPTERS = [
  { id: 'ah', fetch: fetchAH },
  { id: 'jumbo', fetch: fetchJumbo },
];

// ---------- run ----------

async function main() {
  let previous = { chains: {} };
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

  const result = { updatedAt: new Date().toISOString(), chains: {} };
  let ok = 0;

  for (const { id, fetch } of ADAPTERS) {
    const prev = previous.chains?.[id];
    try {
      const offers = dedupe((await fetch()).filter((o) => o.title && o.mechanism));
      if (offers.length < 5) throw new Error(`only ${offers.length} offers found, looks broken`);
      result.chains[id] = { status: 'ok', checkedAt: result.updatedAt, fetchedAt: result.updatedAt, offers };
      ok++;
      console.log(`${id}: ${offers.length} offers`);
    } catch (err) {
      const kept = (prev?.offers || []).filter((o) => !o.validUntil || o.validUntil >= today);
      result.chains[id] = { status: kept.length ? 'stale' : 'error', checkedAt: result.updatedAt, fetchedAt: prev?.fetchedAt || null, error: String(err.message || err).slice(0, 300), offers: kept };
      console.error(`${id}: FAILED (${err.message}); keeping ${kept.length} previous offers`);
    }
  }

  await writeFile(OUT, JSON.stringify(result, null, 1) + '\n');
  if (!ok) {
    console.error('Every chain failed.');
    process.exit(1);
  }
}

main();
