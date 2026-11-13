#!/usr/bin/env node
// Builds data/shop-images.json: the supermarkets' own product photos, for the
// shops that publish them where a clearly named bot is welcome (robots.txt allows
// it and the pages answer normally):
//   Hoogvliet  - photos are listed in its sitemap (one request)
//   Dirk       - category pages carry a product list with photo per article number
//   DekaMarkt  - same platform as Dirk
//   SPAR       - category pages show the photo, whose file name holds the article number
// Albert Heijn and Jumbo refuse automated visitors, PLUS and Vomar do not put photos
// in their pages, so those are left to the other sources in fetch-images.mjs.
// Runs weekly; a shop that fails keeps last week's photos.

import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { norm } from './fetch-images.mjs';

const ROOT = new URL('../', import.meta.url);
const UA = 'prijsradar-bot/1.0 (+https://github.com/nicklasdiener009-debug/prijsradar)';
const DELAY = 900; // ms between requests to one shop
const MAX_PAGES = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const PREFIXES = {
  h: 'https://static.hoogvliet.nl/ecom/product/',
  d: 'https://web-fileserver.dirk.nl/',
  k: 'https://web-fileserver.dekamarkt.nl/',
  s: 'https://media.spar.nl/product/',
};

async function get(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,*/*' }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) { await sleep(8000); continue; }
      if (!r.ok) return '';
      let buf = Buffer.from(await r.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      return buf.toString('utf8');
    } catch { await sleep(3000); }
  }
  return '';
}
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const unxml = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// ---------- Hoogvliet: sitemap with photos; matched to our products by name ----------
async function hoogvliet(products) {
  const xml = await get('https://hoogvliet.nl/sitemap-catalog.xml');
  const byName = new Map();
  for (const m of xml.matchAll(/<url>\s*<loc>https:\/\/hoogvliet\.nl\/([^<]+?)-(\d{6,})<\/loc>[\s\S]*?<image:loc>https:\/\/static\.hoogvliet\.nl\/ecom\/product\/([^<]+)<\/image:loc>(?:\s*<image:title>([^<]*)<\/image:title>)?/g)) {
    const slug = norm(m[1].replace(/-/g, ' '));
    byName.set(slug, m[3]);
    if (m[4]) { const title = norm(unxml(m[4])); if (!byName.has(title)) byName.set(title, m[3]); }
  }
  console.log(`hoogvliet: ${byName.size} names with a photo in the sitemap`);
  const out = {};
  const slugs = [...byName.keys()].map((k) => [new Set(k.split(' ')), byName.get(k)]);
  for (const p of products) {
    const n = norm(p.n);
    let hit = byName.get(n) || byName.get('hoogvliet ' + n) || byName.get(norm(p.l.replace(/-/g, ' ')));
    if (!hit) { // closest name: every word of ours appears in theirs, and little else
      const words = n.split(' ').filter(Boolean);
      let best = 0;
      for (const [set, img] of slugs) {
        if (set.size < words.length || set.size > words.length + 2) continue;
        if (!words.every((w) => set.has(w))) continue;
        const score = words.length / set.size;
        if (score > best) { best = score; hit = img; }
      }
    }
    if (hit) out[p.l] = 'h' + hit;
  }
  return out;
}

// ---------- Dirk and DekaMarkt: product lists inside category pages ----------
async function dirkLike(origin, prefixKey, products) {
  const host = PREFIXES[prefixKey];
  const wanted = new Set(products.map((p) => String(p.l)));
  const maps = locs(await get(`${origin}/sitemap.xml`));
  const catMap = maps.find((u) => /categor/i.test(u)) || `${origin}/categories-and-items-sitemap.xml`;
  let pages = locs(await get(catMap)).filter((u) => /\/boodschappen\/.+/.test(u));
  pages.sort((a, b) => a.split('/').length - b.split('/').length); // broad categories first: fewer pages needed
  console.log(`${origin}: ${pages.length} category pages listed`);
  const out = {};
  let fetched = 0;
  for (const url of pages) {
    if (fetched >= MAX_PAGES || Object.keys(out).length >= wanted.size * 0.98) break;
    const html = await get(url);
    fetched++;
    let found = 0;
    const take = (sku, src) => {
      const file = decodeURIComponent(src.replace(/\\u002F/gi, '/').replace(/\\\//g, '/')).split('?')[0];
      if (!file.startsWith(host) || !wanted.has(sku) || out[sku]) return;
      out[sku] = prefixKey + file.slice(host.length); found++;
    };
    for (const m of html.matchAll(/"sku":\s*"?(\d+)"?\s*,\s*"image":\s*\[?\s*"([^"]+)"/g)) take(m[1], m[2]);
    for (const m of html.matchAll(/data-product-id="(\d+)"[\s\S]{0,600}?<img[^>]+src="([^"]+)"/g)) take(m[1], m[2]);
    if (fetched <= 3 || fetched % 50 === 0) console.log(`  page ${fetched}: +${found} (total ${Object.keys(out).length}/${wanted.size}) ${url}`);
    await sleep(DELAY);
  }
  console.log(`${origin}: ${Object.keys(out).length} of ${wanted.size} products have a photo after ${fetched} pages`);
  return out;
}

// ---------- SPAR: the photo's file name ends in <article number>-<n>.jpg ----------
async function spar(products) {
  const idOf = (l) => (decodeURIComponent(l).match(/-(\d{5,})\/?$/) || [])[1];
  const byId = new Map(products.map((p) => [idOf(p.l), p.l]).filter(([id]) => id));
  const pages = locs(await get('https://www.spar.nl/sitemap/categories.xml')).filter((u) => /\/boodschappen\/.+/.test(u));
  pages.sort((a, b) => b.split('/').length - a.split('/').length); // the most specific categories show all their products
  console.log(`spar: ${pages.length} category pages listed, ${byId.size} products wanted`);
  const out = {};
  let fetched = 0;
  const seen = new Set();
  const queue = [...pages];
  while (queue.length && fetched < MAX_PAGES && Object.keys(out).length < byId.size * 0.98) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await get(url);
    fetched++;
    let found = 0;
    for (const m of html.matchAll(/https:\/\/media\.spar\.nl\/product\/([^"'\s?]+?-(\d{5,})-\d+\.(?:jpe?g|png|webp))/g)) {
      const link = byId.get(m[2]);
      if (link && !out[link]) { out[link] = 's' + m[1]; found++; }
    }
    // further pages of the same category
    for (const m of html.matchAll(/href="([^"]*[?&](?:page|p)=(\d+)[^"]*)"/g)) {
      if (+m[2] > 30) continue;
      try { const next = new URL(m[1].replace(/&amp;/g, '&'), url).href; if (next.startsWith(url.split('?')[0]) && !seen.has(next)) queue.unshift(next); } catch { /* skip */ }
    }
    if (fetched <= 3 || fetched % 50 === 0) console.log(`  page ${fetched}: +${found} (total ${Object.keys(out).length}/${byId.size}) ${url}`);
    await sleep(DELAY);
  }
  console.log(`spar: ${Object.keys(out).length} of ${byId.size} products have a photo after ${fetched} pages`);
  return out;
}

async function main() {
  const prices = JSON.parse(await readFile(new URL('data/prices.json', ROOT), 'utf8'));
  const of = (n) => prices.find((c) => c.n === n)?.d || [];
  let old = { img: {} };
  try { old = JSON.parse(await readFile(new URL('data/shop-images.json', ROOT), 'utf8')); } catch { /* first run */ }
  const only = process.argv[2]?.split(',');
  const jobs = { hoogvliet: () => hoogvliet(of('hoogvliet')), dirk: () => dirkLike('https://www.dirk.nl', 'd', of('dirk')), dekamarkt: () => dirkLike('https://www.dekamarkt.nl', 'k', of('dekamarkt')), spar: () => spar(of('spar')) };
  const img = {};
  // the shops are different sites, so they can be read side by side
  await Promise.all(Object.entries(jobs).map(async ([chain, job]) => {
    const total = of(chain).length;
    let found = {};
    if (!only || only.includes(chain)) { try { found = await job(); } catch (e) { console.error(`${chain} failed: ${e.message}`); } }
    const kept = Object.keys(found).length >= total * 0.2 || !Object.keys(old.img).some((k) => k.startsWith(chain + '|'));
    if (kept) for (const [link, v] of Object.entries(found)) img[`${chain}|${link}`] = v;
    else { console.log(`${chain}: too few found, keeping last week's photos`); for (const [k, v] of Object.entries(old.img)) if (k.startsWith(chain + '|')) img[k] = v; }
    console.log(`${chain}: ${Object.keys(img).filter((k) => k.startsWith(chain + '|')).length} of ${total} products with the shop's own photo`);
  }));
  await writeFile(new URL('data/shop-images.json', ROOT), JSON.stringify({ updatedAt: new Date().toISOString(), prefixes: PREFIXES, img }));
  console.log(`wrote ${Object.keys(img).length} shop photos`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
