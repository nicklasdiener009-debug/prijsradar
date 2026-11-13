#!/usr/bin/env node
// One-off check: which supermarkets publish product photos in a way an honest,
// clearly named bot may read? Looks at robots.txt, sitemaps and one product page
// per chain. A handful of requests per site; nothing is saved.

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const UA = 'prijsradar-bot/1.0 (+https://github.com/nicklasdiener009-debug/prijsradar)';
const prices = JSON.parse(await readFile(new URL('../data/prices.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,text/plain,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    return { status: r.status, text: buf.toString('utf8'), url: r.url };
  } catch (e) {
    return { status: 0, text: '', error: e.message };
  }
}

for (const chain of prices) {
  if (!chain.d.length || !chain.u) continue;
  const origin = new URL(chain.u).origin;
  console.log(`\n===== ${chain.n} (${origin}) =====`);
  const robots = await get(origin + '/robots.txt');
  console.log(`robots.txt: ${robots.status}${robots.error ? ' ' + robots.error : ''}`);
  const lines = robots.text.split('\n').map((l) => l.trim());
  const maps = lines.filter((l) => /^sitemap:/i.test(l)).map((l) => l.replace(/^sitemap:\s*/i, ''));
  console.log('  rules:', lines.filter((l) => /^(user-agent|disallow|allow|crawl-delay)/i.test(l)).slice(0, 25).join(' | ').slice(0, 1200));
  console.log('  sitemaps:', maps.slice(0, 8).join(' , ') || 'none listed');
  await sleep(1500);

  // follow sitemaps a little way, preferring ones that sound like products
  let queue = maps.length ? maps : [origin + '/sitemap.xml'];
  let fetched = 0;
  let found = false;
  while (queue.length && fetched < 4 && !found) {
    queue.sort((a, b) => /product|artikel|item/i.test(b) - /product|artikel|item/i.test(a));
    const url = queue.shift();
    const sm = await get(url);
    fetched++;
    const locs = [...sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    const images = [...sm.text.matchAll(/<image:loc>\s*([^<\s]+)\s*<\/image:loc>/g)].map((m) => m[1]);
    console.log(`  sitemap ${url}: ${sm.status}, ${locs.length} urls, ${images.length} images, ${Math.round(sm.text.length / 1024)} KB`);
    if (images.length) { found = true; console.log('    image sample:', images.slice(0, 3).join(' , ')); console.log('    page sample:', locs.filter((l) => !/\.(jpg|png|webp)/i.test(l)).slice(0, 2).join(' , ')); }
    else if (/<sitemapindex/i.test(sm.text)) queue = locs.concat(queue);
    else if (locs.length) console.log('    url sample:', locs.slice(0, 2).join(' , '));
    await sleep(1500);
  }

  // one product page: does it answer, and does it name its photo?
  const page = await get(chain.u + chain.d[Math.floor(chain.d.length / 2)].l);
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(page.text) || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i.exec(page.text);
  const ld = /"image"\s*:\s*\[?\s*"([^"]+)"/.exec(page.text);
  console.log(`  product page: ${page.status}${page.error ? ' ' + page.error : ''}, ${Math.round(page.text.length / 1024)} KB, og:image ${og ? og[1] : 'none'}, json image ${ld ? ld[1] : 'none'}`);
  await sleep(1500);
}
