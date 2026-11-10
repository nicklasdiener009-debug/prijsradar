#!/usr/bin/env node
// Builds data/images.json: a product photo for as many products as possible.
//
//  1. Albert Heijn's own photos, from the same app API the offers use.
//  2. The same branded product photographed by AH (e.g. "Calvé Pindakaas" at Jumbo).
//  3. Open Food Facts, the open product database (ODbL), matched by brand and name.
// Anything left over gets a product-type picture in the browser (see src/pictures.js).
//
// Runs weekly from GitHub Actions. Open Food Facts results are cached in
// data/cache/off-nl.json for 30 days to keep load on their servers low.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const PRICES = 'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json';
const BOT_UA = 'prijsradar-bot/1.0 (+https://github.com/nicklasdiener009-debug/prijsradar)';
const AH_PREFIX = 'https://static.ah.nl/dam/product/';
const OFF_PREFIX = 'https://images.openfoodfacts.org/images/products/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, opts = {}, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 && i < tries) { await sleep(20000); continue; }
      if (!r.ok) throw new Error(`${r.status} from ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

// ---------- name matching ----------
const HOUSE = /^(ah|ah biologisch|ah terra|ah excellent|jumbo|1 de beste|plus|spar|g'woon|gwoon|deka|hoogvliet|vomar|lidl|dirk|eurospar|ekoplaza|perfekt|basic)\b/;
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d+\s*x\s*)?\d+([.,]\d+)?\s*(gram|gr|g|kilo|kg|ml|cl|liter|l|stuks|stuk|st|rollen|tabletten)\b/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = (s) => new Set(s.split(' ').filter((t) => t.length > 1));
function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

class Index {
  constructor() { this.exact = new Map(); this.byFirst = new Map(); }
  add(name, img) {
    const n = norm(name);
    if (!n || !img) return;
    if (!this.exact.has(n)) this.exact.set(n, img);
    const first = n.split(' ')[0];
    if (!this.byFirst.has(first)) this.byFirst.set(first, []);
    this.byFirst.get(first).push([tokens(n), img]);
  }
  find(name, min = 0.75) {
    const n = norm(name);
    if (this.exact.has(n)) return this.exact.get(n);
    const cands = this.byFirst.get(n.split(' ')[0]);
    if (!cands) return null;
    const t = tokens(n);
    let best = null; let score = min;
    for (const [ct, img] of cands) { const s = jaccard(t, ct); if (s >= score) { score = s; best = img; } }
    return best;
  }
}

// ---------- Albert Heijn ----------
async function ahCatalogue(ahNames) {
  const base = 'https://api.ah.nl';
  const headers = { 'x-application': 'AHWEBSHOP', 'Content-Type': 'application/json', 'User-Agent': BOT_UA };
  const tok = await json(`${base}/mobile-auth/v1/auth/token/anonymous`, { method: 'POST', headers, body: JSON.stringify({ clientId: 'appie' }) });
  const auth = { headers: { ...headers, Authorization: `Bearer ${tok.access_token}` } };
  const byId = new Map();
  const take = (res) => {
    for (const p of res.products || []) {
      const img = p.images?.find((i) => i.width >= 300 && i.width <= 500) || p.images?.find((i) => i.width >= 200) || p.images?.[0];
      if (p.webshopId && img?.url?.startsWith(AH_PREFIX)) byId.set(String(p.webshopId), { title: p.title, img: 'a' + img.url.slice(AH_PREFIX.length) });
    }
    return (res.products || []).length;
  };
  const sweep = async (query, maxPages = 40) => {
    for (let page = 0; page < maxPages; page++) {
      const res = await json(`${base}/mobile-services/product/search/v2?page=${page}&size=1000&sortOn=RELEVANCE${query ? '&query=' + encodeURIComponent(query) : ''}`, auth).catch(() => null);
      if (!res || !take(res) || page + 1 >= (res.page?.totalPages ?? 0)) break;
      await sleep(250);
    }
  };
  await sweep('');
  console.log(`AH: ${byId.size} products from the full listing`);
  // Fill gaps by searching the most common words in product names we still miss.
  const missing = ahNames.filter(([id]) => !byId.has(id));
  const freq = new Map();
  for (const [, n] of missing) for (const w of new Set(norm(n).split(' '))) if (w.length > 3) freq.set(w, (freq.get(w) || 0) + 1);
  const words = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 250).map(([w]) => w);
  for (const w of words) {
    await sweep(w, 3);
    if (ahNames.filter(([id]) => byId.has(id)).length / ahNames.length > 0.97) break;
  }
  console.log(`AH: ${byId.size} products after word searches`);
  return byId;
}

// ---------- Open Food Facts ----------
// Their recommended way to use the data in bulk is the daily export file, so we
// stream that once a month and keep only Dutch products that have a photo.
async function offCatalogue() {
  const file = new URL('data/cache/off-nl.json', ROOT);
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - cached.at < 30 * 864e5 && cached.items.length > 1000) { console.log(`OFF: ${cached.items.length} cached`); return cached.items; }
  } catch { /* none yet */ }
  const { createGunzip } = await import('node:zlib');
  const { Readable } = await import('node:stream');
  const readline = await import('node:readline');
  const res = await fetch('https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz', { headers: { 'User-Agent': BOT_UA } });
  if (!res.ok) throw new Error(`export download ${res.status}`);
  const rl = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
  let col = null;
  const items = [];
  let rows = 0;
  for await (const line of rl) {
    const f = line.split('\t');
    if (!col) { col = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    rows++;
    const countries = f[col.countries_en] || '';
    if (!countries.includes('Netherlands')) continue;
    const img = f[col.image_small_url] || f[col.image_front_small_url] || '';
    const name = f[col.product_name] || '';
    if (!img.startsWith(OFF_PREFIX) || !name) continue;
    items.push([name, (f[col.brands] || '').split(',')[0].trim(), img.slice(OFF_PREFIX.length)]);
  }
  console.log(`OFF: read ${rows} products, ${items.length} Dutch ones with photos`);
  await mkdir(new URL('data/cache/', ROOT), { recursive: true });
  await writeFile(file, JSON.stringify({ at: Date.now(), items }));
  return items;
}

// ---------- build ----------
async function main() {
  const prices = await json(PRICES, { headers: { 'User-Agent': BOT_UA } });
  const ah = prices.find((c) => c.n === 'ah')?.d || [];
  const ahNames = ah.map((p) => [(p.l.match(/^wi(\d+)/) || [])[1], p.n]).filter(([id]) => id);

  let ahById = new Map();
  try { ahById = await ahCatalogue(ahNames); } catch (e) { console.error('AH failed:', e.message); }
  let off = [];
  try { off = await offCatalogue(); } catch (e) { console.error('OFF failed:', e.message); }

  // Branded products photographed by AH (house brands excluded: an AH pack on a Jumbo product would mislead).
  const branded = new Index();
  for (const { title, img } of ahById.values()) if (!HOUSE.test(norm(title))) branded.add(title, img);
  const offIdx = new Index();
  const byBrand = new Map(); // first word of brand -> Index of names without the brand
  for (const [name, brand, img] of off) {
    const n = norm(name);
    const b = norm(brand);
    offIdx.add(b && !n.startsWith(b.split(' ')[0]) ? `${brand} ${name}` : name, 'o' + img);
    if (b) {
      const key = b.split(' ')[0];
      if (!byBrand.has(key)) byBrand.set(key, new Index());
      byBrand.get(key).add(n.startsWith(key) ? n.slice(b.length).trim() || n : n, 'o' + img);
    }
  }
  const brandFind = (name) => {
    const n = norm(name);
    const [first, ...rest] = n.split(' ');
    const idx = byBrand.get(first === '1' ? '1' : first) || (first === 'ah' ? byBrand.get('albert') : null);
    return idx && rest.length ? idx.find(rest.join(' '), 0.6) : null;
  };

  const img = {};
  const stats = {};
  for (const chain of prices) {
    const s = (stats[chain.n] = { total: chain.d.length, own: 0, branded: 0, off: 0 });
    for (const p of chain.d) {
      const key = `${chain.n}|${p.l}`;
      let hit = null;
      if (chain.n === 'ah') { const id = (p.l.match(/^wi(\d+)/) || [])[1]; hit = ahById.get(id)?.img; if (hit) s.own++; }
      if (!hit && !HOUSE.test(norm(p.n))) { hit = branded.find(p.n, 0.8); if (hit) s.branded++; }
      if (!hit) { hit = offIdx.find(p.n, 0.7) || brandFind(p.n); if (hit) s.off++; }
      if (hit) img[key] = hit;
    }
  }
  for (const [c, s] of Object.entries(stats)) if (s.total) console.log(`${c}: ${s.total} products, photos: own ${s.own}, branded ${s.branded}, open food facts ${s.off} -> ${Math.round(((s.own + s.branded + s.off) / s.total) * 100)}%`);
  const out = { updatedAt: new Date().toISOString(), prefixes: { a: AH_PREFIX, o: OFF_PREFIX }, img };
  await writeFile(new URL('data/images.json', ROOT), JSON.stringify(out));
  console.log(`wrote ${Object.keys(img).length} photos`);
  if (!Object.keys(img).length) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
