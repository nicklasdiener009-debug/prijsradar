#!/usr/bin/env node
// One-off check (round 2): how do category and product pages name their photos?
import { gunzipSync } from 'node:zlib';
const UA = 'prijsradar-bot/1.0 (+https://github.com/nicklasdiener009-debug/prijsradar)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,*/*' }, signal: AbortSignal.timeout(30000) });
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    return { status: r.status, text: buf.toString('utf8') };
  } catch (e) { return { status: 0, text: '', error: e.message }; }
}
const around = (text, re, n = 3, pad = 260) => [...text.matchAll(re)].slice(0, n).map((m) => text.slice(Math.max(0, m.index - pad), m.index + pad).replace(/\s+/g, ' '));

const pages = [
  ['hoogvliet sitemap', 'https://hoogvliet.nl/sitemap-catalog.xml'],
  ['dirk category', 'https://www.dirk.nl/boodschappen/dranken-sap-koffie-thee/bier'],
  ['dirk product', 'https://www.dirk.nl/boodschappen/dranken-sap-koffie-thee/bier/heineken-pilsener-krat/6'],
  ['dekamarkt category', 'https://www.dekamarkt.nl/boodschappen/producten/dranken-sap-koffie-thee/bier'],
  ['dekamarkt product', 'https://www.dekamarkt.nl/boodschappen/producten/dranken-sap-koffie-thee/bier/heineken-pilsener-krat-24-x-300-ml/6'],
  ['vomar sitemap', 'https://www.vomar.nl/sitemap.xml'],
  ['vomar category', 'https://www.vomar.nl/producten/bier-wijn-sterke-drank'],
  ['spar category', 'https://www.spar.nl/boodschappen/bakkerij/'],
];
for (const [name, url] of pages) {
  const r = await get(url);
  console.log(`\n===== ${name}: ${r.status} ${Math.round(r.text.length / 1024)} KB ${r.error || ''}`);
  if (name === 'hoogvliet sitemap') { for (const s of around(r.text, /<image:loc>/g, 3, 330)) console.log('  ', s); continue; }
  if (name === 'vomar sitemap') { console.log('  ', [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /producten/.test(u)).slice(0, 12).join(' , ')); continue; }
  const imgs = [...new Set([...r.text.matchAll(/https?:[^"'\s\\)]+?\.(?:jpe?g|png|webp)[^"'\s\\)]*/gi)].map((m) => m[0]))];
  const hosts = {};
  for (const u of imgs) { try { const h = new URL(u).host; hosts[h] = (hosts[h] || 0) + 1; } catch { /* skip */ } }
  console.log('  image hosts:', JSON.stringify(hosts));
  console.log('  samples:', imgs.filter((u) => !/logo|icon|footer|banner/i.test(u)).slice(0, 6).join(' , '));
  const first = imgs.find((u) => /artikel|product/i.test(u));
  if (first) for (const s of around(r.text, new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 2, 420)) console.log('  context:', s);
  await sleep(1500);
}
