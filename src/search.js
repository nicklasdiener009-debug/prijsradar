import { normalize } from './data.js';

// A product matches when every query word starts a word in its name.
// Whole-word hits rank above prefix hits, so "melk" prefers "Halfvolle melk"
// over "Melkchocolade".
export function search(products, query, { limit = 5000 } = {}) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  for (const p of products) {
    const words = p.key.split(' ');
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (words.includes(t)) score += 2;
      else if (words.some((w) => w.startsWith(t))) score += 1;
      else { ok = false; break; }
    }
    if (ok) out.push({ p, score, rank: score - words.length * 0.05 });
  }
  out.sort((a, b) => b.rank - a.rank || a.p.price - b.p.price);
  return out.slice(0, limit).map((x) => ({ ...x.p, score: x.score }));
}

// Best match per chain: among the most relevant results, the cheapest one.
export function bestPerChain(results, sortBy = 'price') {
  const byChain = new Map();
  for (const r of results) {
    if (!byChain.has(r.chain)) byChain.set(r.chain, []);
    byChain.get(r.chain).push(r);
  }
  const groups = [];
  for (const [chain, items] of byChain) {
    const top = Math.max(...items.map((i) => i.score));
    const relevant = items.filter((i) => i.score === top);
    relevant.sort((a, b) => cmp(a, b, sortBy));
    groups.push({ chain, best: relevant[0], items: relevant, others: items.length - relevant.length });
  }
  groups.sort((a, b) => cmp(a.best, b.best, sortBy));
  return groups;
}

function cmp(a, b, sortBy) {
  if (sortBy === 'unit') {
    const ua = a.unit?.value ?? Infinity;
    const ub = b.unit?.value ?? Infinity;
    if (ua !== ub) return ua - ub;
  }
  return a.price - b.price;
}
