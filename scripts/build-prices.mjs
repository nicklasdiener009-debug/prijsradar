#!/usr/bin/env node
// Copies the Checkjebon price data (MIT) into data/prices.json, so the site loads
// it from its own address (compressed and cached) instead of from GitHub raw.
// Products without a price are dropped. Runs daily from GitHub Actions.

import { writeFile } from 'node:fs/promises';

const SRC = 'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json';
const UA = 'prijsradar-bot/1.0 (+https://github.com/nicklasdiener009-debug/prijsradar)';

const r = await fetch(SRC, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
if (!r.ok) throw new Error(`prices answered ${r.status}`);
const raw = await r.json();
let total = 0;
const out = raw.map((c) => {
  const d = (c.d || []).filter((p) => p.p > 0).map((p) => (p.s ? { n: p.n, l: p.l, p: p.p, s: p.s } : { n: p.n, l: p.l, p: p.p }));
  total += d.length;
  return { n: c.n, u: c.u, i: c.i, d };
});
if (total < 20000) throw new Error(`only ${total} products, keeping the old file`);
await writeFile(new URL('../data/prices.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${total} products`);
