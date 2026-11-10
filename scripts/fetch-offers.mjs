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
// We identify ourselves honestly; sources that refuse bots are skipped, not tricked.
const UA = 'prijsradar-bot/1.0 (+https://github.com/nicklasdiener009-debug/prijsradar)';
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

// ---------- weekly folders on Publitas ----------
// Many chains publish their weekly folder on Publitas, a public folder-hosting
// service. Each folder exposes its pages (images + text) as JSON. We keep the
// page pictures and read the offers out of the page text.

const BOT_UA = 'prijsradar-bot/1.0 (+https://github.com/nicklasdiener009-debug/prijsradar)';
const MONTHS = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
const PRICE = /^(\d{1,3})[.,](\d{2})-?$/;
const MECH = /(\d\s*\+\s*\d\s*gratis|2e\s+halve\s+prijs|\d+\s*%\s*korting|\d+\s+voor\s+\d+(?:[.,]\d{1,2})?|nu\s+\d+[.,]\d{2}|op\s*=\s*op|halve\s+prijs|gratis)/i;
const SIZE = /(\d+(?:[.,]\d+)?\s*(?:gram|g|kg|kilo|ml|cl|liter|l|stuks?|st|rollen|tabletten)\b|per\s+(?:stuk|kilo|pak|bos|zak)|\bbak\b|\bzak\b|\bpak\b|\bfles\b|\bpot\b)/i;
const SKIP = /geldig|aanbieding|folder|prijzen|www\.|\.nl\b|t\/m|alleen|zolang|voorraad|week\s*\d|per persoon|max\./i;

function validity(text, year) {
  const m = text.match(/geldig[^\d]{0,30}(\d{1,2})\s*([a-z]{3})?[a-z]*\.?\s*t\/?m\s*[a-z]{0,3}\.?\s*(\d{1,2})\s*([a-z]{3})[a-z]*\.?\s*(\d{4})?/i);
  if (!m) return {};
  const y = Number(m[5] || year);
  const m2 = MONTHS[m[4].toLowerCase()];
  const m1 = MONTHS[(m[2] || m[4]).toLowerCase()];
  if (!m1 || !m2) return {};
  const pad = (n) => String(n).padStart(2, '0');
  return { validFrom: `${m1 > m2 ? y - 1 : y}-${pad(m1)}-${pad(m[1])}`, validUntil: `${y}-${pad(m2)}-${pad(m[3])}` };
}

const BAD_TITLE = /^(totaal|let op|zonder|met|voor|nu|per|van|bij|op|elke|alle|extra|vanaf|ontdek|prijsvoorbeeld|nov|okt|dec|gram|rollen|stuks?)\b|zegels|spaar|combinatie|kwaliteit|iedereen|prijsverlaging|voucher|^[+•\-–*!0-9]|:$/i;
const BAD_TITLE_RESET = /^totaal|prijsvoorbeeld|zonder spaarkaart/i;
function goodTitle(t) {
  if (BAD_TITLE.test(t)) return false;
  if (!/^[A-ZÀ-ÖØ-Ý'’]/.test(t)) return false; // product names start with a capital or brand
  const letters = t.replace(/[^a-zà-ÿ]/gi, '');
  if (letters.length < 4) return false;
  if (t === t.toUpperCase() && t.split(' ').length === 1 && t.length < 8) return false; // shouty fragments like "VOMA"
  return true;
}

function offersFromText(text, page) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let prices = [];
  let mech = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pm = line.match(PRICE);
    if (pm) { prices.push(Number(`${pm[1]}.${pm[2]}`)); continue; }
    const two = `${line} ${lines[i + 1] || ''}`;
    const single = line.match(MECH);
    const joined = !single && line.length < 12 ? two.match(MECH) : null;
    const mm = single || joined;
    if (mm && line.length < 40) { mech = mm[0].replace(/\s+/g, ' ').trim(); if (joined && joined.index + joined[0].length > line.length) i++; continue; }
    if (SKIP.test(line) || line.length < 3 || line.length > 70 || !/[a-z]{3}/i.test(line) || SIZE.test(line) && !/[a-z]{4,}.*[a-z]{4,}/i.test(line)) continue;
    if (!prices.length && !mech) continue;
    if (!goodTitle(line)) { prices = []; if (BAD_TITLE_RESET.test(line)) mech = null; continue; }
    const next = lines[i + 1] || '';
    const size = SIZE.test(next) && next.length < 40 ? next : null;
    const price = prices.length ? prices[prices.length - 1] : null;
    const was = prices.length > 1 && prices[prices.length - 2] > price ? prices[prices.length - 2] : null;
    out.push(clean({
      title: line.replace(/\s+/g, ' '),
      mechanism: mech ? mech[0].toUpperCase() + mech.slice(1).toLowerCase() : was ? `Van ${was.toFixed(2).replace('.', ',')} voor ${price.toFixed(2).replace('.', ',')}` : 'In de folder',
      price, was, size, page,
    }));
    if (size) i++;
    prices = [];
    mech = null;
  }
  return out;
}

async function fetchPublitas(candidates) {
  let base = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': BOT_UA } });
      if (r.ok) { base = r.url.replace(/\/page\/\d+.*$/, '').replace(/\/$/, ''); break; }
    } catch { /* try next */ }
  }
  if (!base) throw new Error('no folder found at ' + candidates.join(', '));
  const host = new URL(base).origin;
  const headers = { 'User-Agent': BOT_UA };
  const spreads = await http(`${base}/spreads.json`, { headers });
  const pages = spreads.flatMap((s) => s.pages || []);
  const allText = pages.map((p) => p.text || '').join('\n');
  const valid = validity(allText, new Date().getFullYear());
  const pick = (imgs) => imgs && (imgs.at600 || imgs.at800 || imgs.at1000 || imgs.at1200 || Object.values(imgs)[0]);
  const folder = {
    url: `${base}/page/1`,
    pages: pages.slice(0, 40).map((p) => ({ n: p.number, image: pick(p.images) ? host + pick(p.images) : null })).filter((p) => p.image),
    ...valid,
  };
  // Keep only confident matches: a real discount (old > new price) or a recognised deal like "1+1 gratis".
  const offers = pages.flatMap((p) => offersFromText(p.text || '', p.number).map((o) => ({ ...o, ...valid, url: `${base}/page/${p.number}` })))
    .filter((o) => (o.was && o.price && o.was > o.price && o.price < 60) || (o.mechanism !== 'In de folder' && !/^Van /.test(o.mechanism)));
  return { offers, folder };
}

const folderAdapter = (...urls) => () => fetchPublitas(urls);

// Add more chains here: { id, fetch } returning [{ title, mechanism, price?, was?, validFrom?, validUntil?, image?, url? }]
// Adapters return either an array of offers or { offers, folder }.
const PUB = 'https://view.publitas.com';
const ADAPTERS = [
  // AH's app API first; if it refuses us, fall back to AH's public weekly folder.
  { id: 'ah', fetch: async () => { try { return await fetchAH(); } catch (e) { console.error('ah api:', e.message); return fetchPublitas(['https://folder.ah.nl/']); } } },
  { id: 'jumbo', fetch: folderAdapter(`${PUB}/jumbo-supermarkten`) },
  { id: 'vomar', fetch: folderAdapter('https://view.folders.nl/vomar') },
  { id: 'dekamarkt', fetch: folderAdapter(`${PUB}/dekamarkt`) },
  { id: 'spar', fetch: folderAdapter(`${PUB}/spar`) },
  { id: 'hoogvliet', fetch: folderAdapter(`${PUB}/hoogvliet`) },
  { id: 'ekoplaza', fetch: folderAdapter(`${PUB}/ekoplaza`) },
  // Not found on Publitas yet (ALDI's folder there is the German one, so it is left out).
  // These candidates are tried each day and fail quietly.
  { id: 'dirk', fetch: folderAdapter(`${PUB}/dirk-van-den-broek-supermarkten`, `${PUB}/dirk-vdbroek`, 'https://view.folders.nl/dirk-van-den-broek') },
  { id: 'plus', fetch: folderAdapter(`${PUB}/plus-supermarkten`, `${PUB}/plus-retail`, 'https://view.folders.nl/plus') },
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
      const got = await fetch();
      const folder = Array.isArray(got) ? null : got.folder;
      const offers = dedupe((Array.isArray(got) ? got : got.offers).filter((o) => o.title && o.mechanism));
      if (offers.length < 5 && !folder?.pages?.length) throw new Error(`only ${offers.length} offers found, looks broken`);
      result.chains[id] = { status: 'ok', checkedAt: result.updatedAt, fetchedAt: result.updatedAt, offers, ...(folder ? { folder } : {}) };
      ok++;
      console.log(`${id}: ${offers.length} offers${folder ? `, folder with ${folder.pages.length} pages` : ''}`);
      for (const o of offers.slice(0, 4)) console.log('   ', JSON.stringify(o));
    } catch (err) {
      const kept = (prev?.offers || []).filter((o) => !o.validUntil || o.validUntil >= today);
      const keepFolder = prev?.folder && (!prev.folder.validUntil || prev.folder.validUntil >= today) ? { folder: prev.folder } : {};
      result.chains[id] = { status: kept.length || keepFolder.folder ? 'stale' : 'error', checkedAt: result.updatedAt, fetchedAt: prev?.fetchedAt || null, error: String(err.message || err).slice(0, 300), offers: kept, ...keepFolder };
      console.error(`${id}: FAILED (${err.message}); keeping ${kept.length} previous offers`);
    }
  }

  await writeFile(OUT, JSON.stringify(result, null, 1) + '\n');
  if (!ok) {
    console.error('Every chain failed.');
    process.exit(1);
  }
}

export { offersFromText, validity };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
