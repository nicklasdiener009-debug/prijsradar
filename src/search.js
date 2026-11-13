import { normalize } from './data.js';

// Words that turn a product into something else: "melk" should find milk before
// "melk chocolade reep", and "appel" apples before "appel sap".
const DERIVED = new Set(('chocolade chocola reep repen koek koekjes koeken saus smaak chips ijs ijsjes drink drank sap siroop limonade poeder mix'
  + ' kruiden soep vla pudding toetje snoep biscuit wafels bonbons taart cake gebak shampoo douchegel zeep creme lotion deodorant geur kaars'
  + ' voer brokjes kattenvoer hondenvoer thee yoghurt kwark jam moes vlaai muffin pastei salade bouillon crackers tosti pizza burger').split(' '));

const DERIVED_END = /(biscuits?|koek|koeken|koekjes|reep|repen|sap|saus|drink|taart|vlaai|vla|yoghurt|kwark|chips|noodles|snoep|thee|shampoo|soep|mix|moes|stroop|pudding|bonbons|wafels?|gel|lotion|geur|smaak)$/;

// Shop names and filler words that say nothing about what the product is.
const FILLER = new Set('ah jumbo plus spar g woon de beste deka dekamarkt hoogvliet vomar lidl dirk ekoplaza biologisch biologische bio en met van het een'.split(' '));
const plural = (w, t) => w === t + 'en' || w === t + 's' || w === t + 'n' || w === t + 'eren' || w === t + 'jes';

const SIZE_WORD = /^\d|^(g|gr|kg|ml|cl|l|st|stuks|x|per|ca)$/;

// A product matches when every query word starts a word in its name. Whole-word
// hits rank above prefix hits; words in the query order next to each other rank
// higher; names that describe a different kind of product rank lower.
export function search(products, query, { limit = 5000 } = {}) {
  const q = normalize(query);
  const tokens = q.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const whole = tokens.map((t) => ` ${t} `);
  const pre = tokens.map((t) => ` ${t}`);
  const phrase = tokens.length > 1 ? ` ${q}` : null;
  const out = [];
  outer: for (const p of products) {
    const k = p.key;
    let score = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (k.includes(whole[i])) score += 2;
      else if (k.includes(pre[i])) score += 1;
      else continue outer;
    }
    if (phrase && k.includes(phrase)) score += 0.5;
    const words = k.trim().split(' ');
    let derived = 0;
    let n = 0;
    let first = null;
    let head = null;
    for (const w of words) {
      if (SIZE_WORD.test(w)) continue;
      n++;
      if (!FILLER.has(w)) { first ??= w; head = w; }
      if (tokens.includes(w)) continue;
      const ti = tokens.findIndex((t) => t.length > 2 && w.length > t.length && (w.startsWith(t) || w.endsWith(t)));
      if (ti >= 0 && plural(w, tokens[ti])) { if (!k.includes(whole[ti])) score += 1; continue; } // "appels" is as good as "appel"
      // "melkbiscuit" and "chocolademelk" are not what someone typing "melk" is after
      if (ti >= 0 && k.includes(whole[ti])) derived += 1;
      else if (!tokens.some((t) => w.startsWith(t)) && (DERIVED.has(w) || DERIVED_END.test(w))) derived += 1;
    }
    score -= Math.min(derived, 2);
    // The thing itself usually comes first or last in a Dutch product name: "Halfvolle melk", "Melk halfvol".
    const last = tokens[tokens.length - 1];
    const is = (w) => w && (w === last || plural(w, last));
    if (is(head) || is(first)) score += 0.5;
    out.push({ p, score, rank: score - n * 0.05 });
  }
  out.sort((a, b) => b.rank - a.rank || a.p.price - b.p.price);
  return out.slice(0, limit).map((x) => ({ ...x.p, score: x.score, ref: x.p }));
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
    let relevant = items.filter((i) => i.score >= top - 0.01);
    relevant.sort((a, b) => cmp(a, b, sortBy));
    // A price far below the rest is nearly always a mistake in the source data.
    if (relevant.length >= 4) {
      const val = (i) => (sortBy === 'unit' && i.unit ? i.unit.value : i.price);
      const sorted = relevant.map(val).sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      const sane = relevant.filter((i) => val(i) >= median * 0.25);
      if (sane.length) relevant = sane;
    }
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

// ---------- vocabulary: suggestions and typo tolerance ----------
let vocab = null; // [word, count] sorted by count
function vocabulary(products) {
  if (vocab) return vocab;
  const m = new Map();
  for (const p of products) for (const w of p.key.split(' ')) if (w.length > 2 && !/\d/.test(w)) m.set(w, (m.get(w) || 0) + 1);
  vocab = [...m.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  return vocab;
}

// Edit distance with swapped neighbours counted as one mistake; stops early above `max`.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < low) low = v;
    }
    if (low > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

// "pindakas" -> "pindakaas". Returns the corrected query, or null when nothing needs fixing.
export function correct(products, query) {
  const v = vocabulary(products);
  const tokens = normalize(query).split(' ').filter(Boolean);
  let changed = false;
  const fixed = tokens.map((t) => {
    if (t.length < 4 || /\d/.test(t) || v.some(([w]) => w.startsWith(t))) return t;
    const max = t.length >= 8 ? 2 : 1;
    let best = null; let bestD = max + 1;
    for (const [w] of v) { // most common words first, so ties go to the common word
      const d = distance(t, w, max);
      if (d < bestD) { bestD = d; best = w; if (d === 1) break; }
    }
    if (best) { changed = true; return best; }
    return t;
  });
  return changed ? fixed.join(' ') : null;
}

// Ways to finish what is being typed: common product words first.
export function completions(products, query, max = 5) {
  const raw = normalize(query);
  const tokens = raw.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const last = tokens.pop();
  const head = tokens.join(' ');
  const out = [];
  for (const [w] of vocabulary(products)) {
    if (w.startsWith(last) && !tokens.includes(w)) { out.push((head ? head + ' ' : '') + w); if (out.length >= max) break; }
  }
  return out;
}
