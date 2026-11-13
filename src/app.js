import { CHAINS } from './chains.js';
import { loadPrices, loadStores, loadOffers, findPlaces, distanceKm, normalize } from './data.js';
import { search, bestPerChain, correct, completions } from './search.js';
import { loadImages, pictureHtml, groupFor, isOrganic } from './pictures.js';
import { openStatus } from './hours.js';
import { readList, saveList, readFavs, saveFavs, newItem, encodeShare, decodeShare } from './list.js';
import { t, lang, setLang, locale } from './i18n.js';
import { translate } from './translate.js';

const DEFAULT_LOCATION = { lat: 52.3791, lon: 4.9003, label: 'Amsterdam Centraal' };
const HERE_KEY = 'ams-here-v1';
const SEEN_KEY = 'ams-fav-deals-seen-v1';
const STAPLES = ['halfvolle melk', 'eieren', 'bananen', 'volkoren brood', 'pindakaas', 'jonge kaas', 'spaghetti', 'koffiebonen'];

const state = {
  ready: false, products: [], byChain: new Map(), byId: new Map(), chainsWithData: [], logos: {}, stores: [], storeChains: null,
  offers: { chains: {} }, here: readHere(), sortBy: 'unit', list: readList(), favs: readFavs(),
  filter: { q: null, group: null, organic: false, offer: false }, incoming: null, installEvent: null,
  staples: null, picks: new Map(), alts: new Map(), map: null, layer: null, you: null, mapChain: null,
};

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const euro = (v) => '€' + v.toFixed(2).replace('.', ',');
const km = (d) => (d < 1 ? `${Math.round(d * 100) * 10} m` : `${d.toFixed(1).replace('.', ',')} km`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Prices are set like a Dutch shelf label: big euros, small raised cents.
const price = (v) => { const [e, c] = v.toFixed(2).split('.'); return `<strong class="pr" aria-label="€${e},${c}"><i>€</i>${e}<sup>${c}</sup></strong>`; };
const BASE = { g: 'kg', l: 'l', st: 'piece' };
const unitText = (u) => (u ? `${euro(u.value)} / ${u.unit === 'st' ? t('piece') : BASE[u.unit]}` : '');
const dayLabel = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
const today = () => new Date().toISOString().slice(0, 10);
const chainVars = (id) => `--chain:${CHAINS[id]?.color || '#999'};--chain-ink:${CHAINS[id]?.ink || '#fff'}`;
const pid = (p) => `${p.chain}|${p.link}`;
const pHref = (p) => `#/p/${p.chain}/${encodeURIComponent(p.link)}`;
function readHere() { try { const h = JSON.parse(localStorage.getItem(HERE_KEY) || 'null'); if (h && isFinite(h.lat) && isFinite(h.lon)) return h; } catch { /* ignore */ } return { ...DEFAULT_LOCATION }; }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }
function persistList() { saveList(state.list); state.picks.clear(); updateCounts(); }

// Walking and cycling take the streets, so the straight line is stretched by a quarter.
const walkMin = (d) => Math.max(1, Math.round(d * 1.25 / 5 * 60));
const bikeMin = (d) => Math.max(1, Math.round(d * 1.25 / 15 * 60));
const travel = (d) => (walkMin(d) <= 15 ? t('{n} min walk', { n: walkMin(d) }) : t('{n} min by bike', { n: bikeMin(d) }));
const away = (d) => `${km(d)} · ${travel(d)}`;

function openHtml(s) {
  const o = openStatus(s?.hours);
  if (!o) return '';
  if (o.open) return `<span class="open">${t('Open')}</span> · ${t('closes {time}', { time: o.closes })}`;
  return `<span class="closed">${t('Closed')}</span>${o.opens ? ' · ' + (o.inDays === 1 ? t('opens tomorrow {time}', { time: o.opens }) : t('opens {time}', { time: o.opens })) : ''}`;
}

function logo(id, cls = '') {
  const c = CHAINS[id] || { short: '?' };
  const src = state.logos[id];
  return `<span class="logo ${cls}" style="${chainVars(id)}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('fail')">` : ''}<b>${esc(c.short || c.name?.[0] || '?')}</b></span>`;
}
const storeOnlyChains = () => (state.storeChains ? [...state.storeChains].filter((c) => CHAINS[c] && !state.chainsWithData.includes(c)) : []);
const activeChains = () => state.chainsWithData.filter((c) => !state.storeChains || state.storeChains.has(c));

function nearest(chain) {
  let best = null;
  for (const s of state.stores) if (s.chain === chain) { const d = distanceKm(state.here, s); if (!best || d < best.d) best = { s, d }; }
  return best;
}
const chainsByDistance = (all = false) => (all ? [...activeChains(), ...storeOnlyChains()] : activeChains()).map((c) => ({ c, n: nearest(c) })).sort((a, b) => (a.n?.d ?? 99) - (b.n?.d ?? 99));

function offersFor(chain) {
  const d = today();
  const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10); // include next week's folder a day or two early
  return (state.offers.chains?.[chain]?.offers || []).filter((o) => (!o.validUntil || o.validUntil >= d) && (!o.validFrom || o.validFrom <= soon));
}
function matchOffers(chain, q) {
  const tokens = normalize(q).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return offersFor(chain).filter((o) => { o._k ??= normalize(o.title).split(' '); return tokens.every((x) => o._k.some((w) => w.startsWith(x))); });
}

// A search that understands English ("milk" -> melk) and forgives typos.
function find(q, pool = state.products, exact = false) {
  const dutch = exact ? null : translate(q);
  let used = dutch || q;
  let how = dutch ? 'translated' : null;
  let results = search(pool, used);
  if (!results.length && dutch) { used = q; how = null; results = search(pool, q); } // the translation found nothing, so try it as typed
  if (!results.length) {
    const fixed = correct(state.products, used);
    if (fixed) { const r = search(pool, fixed); if (r.length) { used = fixed; how = 'corrected'; results = r; } }
  }
  return { used, how, results };
}

// ---------- comparing one product across chains ----------
const HOUSE = /^(ah biologisch|ah terra|ah excellent|ah|albert heijn|jumbo|1 de beste|plus|spar|g'?woon|deka|dekamarkt|hoogvliet|vomar|lidl|dirk|eurospar|ekoplaza|perfekt|basic)\s+/;
const SIZE_TOKEN = /^\d|^(g|gr|gram|kg|kilo|ml|cl|l|liter|st|stuks|stuk|x|per|ca|pot|pak|fles|blik|zak|regular|original|classic)$/;
function core(name) {
  let n = normalize(name).replace(/[.,%]/g, ' ').replace(/\s+/g, ' ').trim();
  const house = HOUSE.test(n);
  if (house) n = n.replace(HOUSE, '');
  return { tokens: n.split(' ').filter((w) => w && !SIZE_TOKEN.test(w)), house };
}
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}
const qtyOf = (p) => (p.unit ? { unit: p.unit.unit, qty: p.price / p.unit.value } : null);
const sameSize = (a, b) => { const x = qtyOf(a); const y = qtyOf(b); return !!x && !!y && x.unit === y.unit && Math.abs(x.qty / y.qty - 1) < 0.1; };

// The same product (or the closest thing) at every other chain. kind: 'same' | 'own' | 'similar'.
function alternatives(p) {
  const key = pid(p);
  if (state.alts.has(key)) return state.alts.get(key);
  const me = core(p.name);
  const mine = new Set(me.tokens);
  const longest = [...me.tokens].sort((a, b) => b.length - a.length)[0];
  const head = me.tokens[me.tokens.length - 1] || '';
  const sharesHead = (tokens) => tokens.some((w) => w.startsWith(head) || (w.length > 3 && head.startsWith(w)));
  const tries = [...new Set([me.tokens.slice(0, 2).join(' '), me.tokens.slice(-2).join(' '), me.tokens.slice(1, 3).join(' '), head, longest].filter(Boolean))];
  const out = [];
  for (const c of activeChains()) {
    if (c === p.chain) continue;
    const pool = state.byChain.get(c) || [];
    let best = null;
    for (const q of tries) {
      for (const x of search(pool, q, { limit: 200 })) {
        const other = core(x.name);
        const j = jaccard(mine, new Set(other.tokens));
        if (j < 0.5 && !sharesHead(other.tokens)) continue; // a different kind of product
        const size = sameSize(p, x);
        const s = j + (size ? 0.1 : 0);
        if (!best || s > best.s || (s === best.s && x.price < best.p.price)) best = { p: x.ref, s, j, size, house: other.house };
      }
      if (best && best.j >= 0.5) break;
    }
    if (!best || best.j < 0.3) continue;
    const exact = best.j >= 0.8 && best.size;
    out.push({ p: best.p, kind: exact ? (me.house || best.house ? 'own' : 'same') : 'similar', s: best.s });
  }
  const order = { same: 0, own: 1, similar: 2 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || (a.p.unit?.value ?? a.p.price) - (b.p.unit?.value ?? b.p.price));
  state.alts.set(key, out);
  return out;
}

// A deal that covers this product, judged by the first words of its name.
function dealFor(p) {
  if (p._deal !== undefined && p._dealAt === state.offers.updatedAt) return p._deal;
  const words = core(p.name).tokens.filter((w) => w.length > 2).slice(0, 2);
  p._dealAt = state.offers.updatedAt;
  p._deal = words.length === 2 ? matchOffers(p.chain, words.join(' '))[0] || null : null;
  return p._deal;
}

// ---------- list maths ----------
// Which product a list item becomes at each chain: Map chain -> product.
function picksFor(item) {
  const key = item.pin ? 'pin:' + pid(item.pin) : 'q:' + item.q;
  if (state.picks.has(key)) return state.picks.get(key);
  let m;
  const pinned = item.pin && state.byId.get(pid(item.pin));
  if (pinned) {
    m = new Map([[pinned.chain, pinned]]);
    for (const a of alternatives(pinned)) m.set(a.p.chain, a.p);
  } else {
    m = new Map(bestPerChain(find(item.pin?.name || item.q).results).map((g) => [g.chain, g.best.ref]));
  }
  state.picks.set(key, m);
  return m;
}
function baskets() {
  const N = state.list.length;
  return activeChains().map((c) => {
    let total = 0; let found = 0; let deals = 0;
    const picks = state.list.map((item) => {
      const p = picksFor(item).get(c);
      const d = p ? dealFor(p) : null;
      if (p) { total += p.price * item.qty; found++; }
      if (d) deals++;
      return { item, p, d };
    });
    return { c, total, found, deals, picks, n: nearest(c), complete: found === N };
  }).filter((r) => r.found).sort((a, b) => b.found - a.found || a.total - b.total);
}
// Best way to split the list over two of the five nearest chains.
function bestSplit(rows) {
  const near = rows.filter((r) => r.n).sort((a, b) => a.n.d - b.n.d).slice(0, 5);
  let best = null;
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const a = near[i]; const b = near[j];
    let total = 0; let found = 0; const at = [[], []];
    state.list.forEach((item, k) => {
      const pa = a.picks[k].p; const pb = b.picks[k].p;
      if (!pa && !pb) return;
      const useA = pa && (!pb || pa.price <= pb.price);
      total += (useA ? pa : pb).price * item.qty; found++;
      at[useA ? 0 : 1].push({ item, p: useA ? pa : pb });
    });
    if (!at[0].length || !at[1].length) continue;
    if (!best || found > best.found || (found === best.found && total < best.total)) best = { a, b, total, found, at };
  }
  return best;
}

function favDeals() {
  if (!state.ready) return [];
  return state.favs.map((f) => state.byId.get(pid(f))).filter(Boolean).map((p) => ({ p, d: dealFor(p) })).filter((x) => x.d);
}

// The home screen opens with a receipt: today's basics at whichever store sells each cheapest.
function receipt() {
  const active = new Set(activeChains());
  // cheapest pack per chain, so the receipt and the "all at one store" total compare like with like
  state.packs ??= STAPLES.map((q) => ({ q, by: new Map(bestPerChain(search(state.products, q), 'price').map((g) => [g.chain, g.best])) }));
  const lines = state.packs.map(({ q, by }) => {
    const best = [...by.values()].filter((p) => active.has(p.chain)).sort((a, b) => a.price - b.price)[0];
    return best ? { q, p: best, by } : null;
  }).filter(Boolean);
  if (!lines.length) return '';
  const total = lines.reduce((sum, l) => sum + l.p.price, 0);
  const near = chainsByDistance().find(({ c, n }) => n && lines.every((l) => l.by.get(c)));
  const nearTotal = near ? lines.reduce((sum, l) => sum + l.by.get(near.c).price, 0) : 0;
  return `<aside class="bon" aria-label="${t('Today’s basics at their cheapest')}"><div class="bon-paper">
    <div class="bon-head"><b>${t('Today’s basics at their cheapest')}</b><span>${new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
    <ol>${lines.map((l, i) => `<li style="--i:${i}"><a href="${pHref(l.p)}"><span class="what">${esc(l.q)}</span><span class="dots"></span>${logo(l.p.chain, 'sm')}<span class="num">${euro(l.p.price).slice(1)}</span></a></li>`).join('')}</ol>
    <div class="bon-total" style="--i:${lines.length}"><span>${t('Total')}</span><span class="num">${euro(total)}</span></div>
    ${near && nearTotal - total >= 0.01 ? `<p class="bon-note" style="--i:${lines.length + 1}">${t('All of it at {chain}, your nearest: {total}. Shopping around saves {amount}.', { chain: esc(CHAINS[near.c].name), total: euro(nearTotal), amount: euro(nearTotal - total) })}</p>` : ''}
    <button class="btn bon-btn" data-staples style="--i:${lines.length + 2}">${t('Put these on my list')}</button>
  </div></aside>`;
}

function staples() {
  if (state.staples) return state.staples;
  state.staples = STAPLES.map((q) => ({ q, by: new Map(bestPerChain(search(state.products, q), 'unit').map((g) => [g.chain, g.best])) }));
  return state.staples;
}

// ---------- pieces ----------
function folderOf(chain) {
  const f = state.offers.chains?.[chain]?.folder;
  if (!f?.pages?.length) return null;
  if (f.validUntil && f.validUntil < today()) return null;
  return f;
}
function folderTiles(chain, f, max = 12) {
  return f.pages.slice(0, max).map((p, i) => `<a class="tile pagetile rise" style="--i:${i};${chainVars(chain)}" href="${esc(f.url.replace(/\/page\/\d+$/, '/page/' + p.n))}" target="_blank" rel="noopener">
    <div class="pg"><img src="${esc(p.image)}" alt="${t('Folder page {n}', { n: p.n })}" loading="lazy"></div><div class="bd"><span class="u">${t('Page {n}', { n: p.n })}</span></div></a>`).join('');
}

function dealTile(o, i = 0) {
  return `<a class="tile rise" style="--i:${Math.min(i, 12)};${chainVars(o.chain)}" href="${esc(o.url || '#/chain/' + o.chain)}" ${o.url ? 'target="_blank" rel="noopener"' : ''}>
    <div class="ph">${pictureHtml({ chain: o.chain, name: o.title, image: o.image }, 'fill')}<span class="ribbon">${esc(o.mechanism)}</span></div>
    <div class="bd"><span class="t">${esc(o.title)}</span>
      <span class="p">${o.price ? `${price(o.price)}` : ''}${o.was && o.price && o.was > o.price ? `<s>${euro(o.was)}</s>` : ''}</span>
      ${o.validFrom && o.validFrom > today() ? `<span class="u">${t('From {day}', { day: dayLabel(o.validFrom) })}</span>` : o.validUntil ? `<span class="u">${t('Until {day}', { day: dayLabel(o.validUntil) })}</span>` : ''}</div></a>`;
}
function productTile(p, label, i = 0) {
  return `<a class="tile rise" style="--i:${i};${chainVars(p.chain)}" href="${pHref(p)}">
    <div class="ph">${pictureHtml(p, 'fill')}<span class="ribbon soft">${esc(label)}</span></div>
    <div class="bd"><span class="t">${esc(p.name)}</span><span class="p">${price(p.price)}</span><span class="u">${esc(p.size)}${p.unit ? ' · ' + unitText(p.unit) : ''}</span></div></a>`;
}
const onList = (p) => state.list.find((i) => i.pin && pid(i.pin) === pid(p));
function productRow(p, extra = '', cls = '') {
  const have = onList(p);
  return `<div class="row ${cls}"><a class="rowlink" href="${pHref(p)}"><span class="thumb">${pictureHtml(p, 'row')}${logo(p.chain, 'badge')}</span>
    <div class="main"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.size)}${extra}</div></div>
    <div class="price">${price(p.price)}<span>${unitText(p.unit)}</span></div></a>
    <button class="plus ${have ? 'on' : ''}" data-pin="${esc(pid(p))}" aria-label="${have ? t('On your list') : t('Add to list')}">${have ? '✓' : '+'}</button></div>`;
}
const skeletons = (n, h = 120) => Array.from({ length: n }, () => `<div class="skel" style="height:${h}px;margin-top:14px"></div>`).join('');
const storeRow = (s, d, chain) => `<button class="row rowbtn" data-focus="${esc(s.id)}">${logo(chain, 'sm')}<div class="main"><div class="n">${esc(chain === 'other' ? s.name : s.address || s.name)}</div><div class="s">${openHtml(s) || esc(s.postcode || s.address || '')}</div></div><span class="num muted dist">${km(d)}<small>${travel(d)}</small></span></button>`;

// ---------- views ----------
function viewHome() {
  const h = new Date().getHours();
  const hello = h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening');
  const intro = `<div class="hero-main"><h1>${hello}</h1><p>${t('Every supermarket in Amsterdam, in one place.')}</p>${locButton()}
    <div class="suggest">${STAPLES.slice(0, 6).map((q) => `<button data-go="#/search?q=${encodeURIComponent(q)}">${q}</button>`).join('')}</div></div>`;
  if (!state.ready) return `<section class="hero">${intro}<div class="skel bon-skel"></div></section>` + skeletons(2, 220);
  let html = `<section class="hero">${intro}${receipt()}</section>`;

  const fd = favDeals();
  if (fd.length) html += `<a class="banner rise" href="#/list"><span class="heart">♥</span><div><strong>${fd.length === 1 ? t('1 of your favourites is on offer') : t('{n} of your favourites are on offer', { n: fd.length })}</strong><span>${esc(fd.slice(0, 2).map((x) => x.p.name).join(', '))}</span></div></a>`;

  const chains = chainsByDistance(true);
  html += `<section class="sec"><div class="sec-head"><h2>${t('Supermarkets near you')}</h2><span class="sub">${t('{n} chains', { n: chains.length })}</span></div><div class="rail">${chains.map(({ c, n }, i) => {
    const deals = offersFor(c).length;
    const o = n ? openStatus(n.s.hours) : null;
    return `<a class="storecard rise" style="--i:${i};${chainVars(c)}" href="#/chain/${c}">${logo(c)}<div><div class="n">${esc(CHAINS[c].name)}</div><div class="d">${n ? away(n.d) : t('Prices only')}</div>${o ? `<div class="d">${o.open ? `<span class="open">${t('Open')}</span> · ${t('closes {time}', { time: o.closes })}` : `<span class="closed">${t('Closed')}</span>`}</div>` : ''}</div>${deals ? `<span class="tag">${t('{n} deals', { n: deals })}</span>` : ''}</a>`;
  }).join('')}</div></section>`;

  const st = staples();
  for (const [ci, { c, n }] of chains.entries()) {
    const deals = offersFor(c);
    const hasPrices = state.chainsWithData.includes(c);
    const storeTiles = () => state.stores.filter((s) => s.chain === c).map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d).slice(0, 6)
      .map(({ s, d }, i) => `<button class="storecard rise" style="--i:${i};${chainVars(c)};text-align:left;border:0;cursor:pointer" data-go="#/chain/${c}">${logo(c, 'sm')}<div><div class="n">${esc(s.address || s.name)}</div><div class="d">${away(d)}</div></div></button>`).join('');
    const tiles = deals.length
      ? deals.slice(0, 12).map((o, i) => dealTile({ ...o, chain: c }, i)).join('')
      : hasPrices ? st.filter((x) => x.by.get(c)).map((x, i) => productTile(x.by.get(c), x.q, i)).join('') : storeTiles();
    html += `<section class="chainsec rise" style="--i:${ci}">
      <div class="sec-head">${logo(c)}<div class="titles"><h2>${esc(CHAINS[c].name)}</h2><div class="sub">${n ? `${km(n.d)} · ${esc(n.s.address || n.s.name)}` : t('No store location found')}${deals.length ? ` · ${t('{n} deals this week', { n: deals.length })}` : hasPrices ? ` · ${t('Everyday prices')}` : ` · ${t('Stores (no online prices)')}`}</div></div><a class="more" href="#/chain/${c}">${t('View')}</a></div>
      <div class="rail">${tiles}<a class="tile add" href="#/chain/${c}">${t('See everything at {chain}', { chain: esc(CHAINS[c].name) })}</a></div>
      ${folderOf(c) ? `<div class="subhead">${t('This week’s folder')}${folderOf(c).validUntil ? ` · ${t('until {day}', { day: dayLabel(folderOf(c).validUntil) })}` : ''}</div><div class="rail pages">${folderTiles(c, folderOf(c), 10)}</div>` : ''}</section>`;
  }
  const locals = state.stores.filter((s) => s.chain === 'other').map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d).slice(0, 14);
  if (locals.length) {
    html += `<section class="sec"><div class="sec-head"><div class="titles"><h2>${t('Local and speciality shops')}</h2><div class="sub">${t('Turkish, Moroccan, Asian, organic and independent supermarkets near you')}</div></div><a class="more" href="#/map">${t('Map')}</a></div>
      <div class="rail">${locals.map(({ s, d }, i) => `<button class="storecard rise" style="--i:${i};--chain:#8e8e93;text-align:left;border:0;cursor:pointer" data-go="#/map" data-focus-after="${esc(s.id)}"><span class="logo" style="--chain:#8e8e93"><b>${esc((s.name || '?').trim()[0].toUpperCase())}</b></span><div><div class="n">${esc(s.name)}</div><div class="d">${away(d)}</div>${openHtml(s) ? `<div class="d">${openHtml(s)}</div>` : ''}</div></button>`).join('')}</div></section>`;
  }
  return html + footer();
}

function viewSearch(q, exact = false) {
  $('#q').value = q;
  if (!q) return `<div class="pagehead"><div><h1>${t('Search')}</h1><p>${t('Compare any product across every supermarket.')}</p></div></div>
    <div class="suggest">${STAPLES.map((s) => `<button data-go="#/search?q=${encodeURIComponent(s)}">${s}</button>`).join('')}</div>`;
  if (!state.ready) return `<div class="pagehead"><div><h1>“${esc(q)}”</h1></div></div>` + skeletons(4, 90);
  const f = state.filter;
  if (f.q !== q) Object.assign(f, { q, group: null, organic: false, offer: false });
  const active = new Set(activeChains());
  const found = find(q, state.products, exact);
  const used = found.used;
  const all = found.results.filter((p) => active.has(p.chain));
  // Filters, built from what the results contain.
  const counts = new Map();
  let organic = 0;
  for (const p of all) { const g = groupFor(p.ref); counts.set(g, (counts.get(g) || 0) + 1); if (isOrganic(p)) organic++; }
  const groupsTop = [...counts.entries()].filter(([g]) => g !== 'Other').sort((a, b) => b[1] - a[1]).slice(0, 5).filter(() => counts.size > 1);
  const anyOffer = [...active].some((c) => offersFor(c).length);
  let results = all;
  if (f.group) results = results.filter((p) => groupFor(p.ref) === f.group);
  if (f.organic) results = results.filter(isOrganic);
  if (f.offer) results = results.filter((p) => dealFor(p.ref));
  const groups = bestPerChain(results, state.sortBy);

  const more = completions(state.products, used, 6).filter((c) => c !== normalize(used)).slice(0, 5);
  const chainHits = normalize(q).length > 1 ? Object.entries(CHAINS).filter(([id, c]) => (active.has(id) || state.storeChains?.has(id)) && normalize(c.name).split(' ').some((w) => w.startsWith(normalize(q)))) : [];
  let html = `<div class="pagehead"><div><h1>“${esc(used)}”</h1><p>${found.how === 'translated' ? `${t('Translated from “{q}”.', { q: esc(q) })} <a class="inlinelink" href="#/search?q=${encodeURIComponent(q)}&exact=1">${t('Search “{q}” as typed', { q: esc(q) })}</a><br>` : found.how === 'corrected' ? t('No results for “{q}”, showing “{fixed}” instead.', { q: esc(q), fixed: esc(used) }) + ' ' : ''}${groups.length ? t('Found at {n} supermarkets', { n: groups.length }) : t('No results')}</p></div>
    <div class="seg" role="group" aria-label="${t('Sort')}"><button data-sort="unit" class="${state.sortBy === 'unit' ? 'on' : ''}">${t('Per kg / l')}</button><button data-sort="price" class="${state.sortBy === 'price' ? 'on' : ''}">${t('Pack price')}</button></div></div>`;
  if (more.length || chainHits.length) html += `<div class="suggest tight">${chainHits.map(([id, c]) => `<button class="chainchip" data-go="#/chain/${id}">${logo(id, 'sm')}${esc(c.name)}</button>`).join('')}${more.map((s) => `<button data-go="#/search?q=${encodeURIComponent(s)}">${esc(s)}</button>`).join('')}</div>`;
  if (all.length) html += `<div class="filters">${groupsTop.map(([g, n]) => `<button class="${f.group === g ? 'on' : ''}" data-filter="group:${esc(g)}">${t(g)} <small>${n}</small></button>`).join('')}${organic ? `<button class="${f.organic ? 'on' : ''}" data-filter="organic">${t('Organic')} <small>${organic}</small></button>` : ''}${anyOffer ? `<button class="${f.offer ? 'on' : ''}" data-filter="offer">${t('On offer')}</button>` : ''}</div>`;
  if (!groups.length) return html + `<div class="empty"><h3>${t('Nothing found')}</h3><p>${all.length ? t('Nothing matches these filters.') : t('Try fewer or simpler words.')}</p>${all.length ? `<button class="btn" data-filter="clear">${t('Clear filters')}</button>` : ''}</div>`;

  const best = groups[0];
  const near = groups.map((g) => ({ g, n: nearest(g.chain) })).filter((x) => x.n).sort((a, b) => a.n.d - b.n.d)[0];
  html += `<div class="summary">
    <div class="stat rise"><div class="k">${t('Cheapest')}</div><div class="v">${price(best.best.price)}<small>${esc(CHAINS[best.chain].name)}</small></div></div>
    ${near ? `<div class="stat rise" style="--i:1"><div class="k">${t('Closest with it')}</div><div class="v">${km(near.n.d)}<small>${esc(CHAINS[near.g.chain].name)}</small></div></div>` : ''}
    ${groups.length > 1 ? `<div class="stat rise" style="--i:2"><div class="k">${t('You save up to')}</div><div class="v">${price(Math.max(0, groups[groups.length - 1].best.price - best.best.price))}</div></div>` : ''}</div>`;

  html += groups.map((g, i) => {
    const n = nearest(g.chain);
    const deal = dealFor(g.best.ref) || matchOffers(g.chain, used)[0];
    const extra = ` · ${esc(CHAINS[g.chain].name)}${n ? ` · ${km(n.d)}` : ''}`;
    const tags = `${i === 0 ? ` <span class="pill good">${t('Best price')}</span>` : ''}${deal ? ` <span class="pill deal">${esc(deal.mechanism)}</span>` : ''}`;
    const rest = g.items.slice(1, 8);
    return `<div class="card compare-group rise" style="--i:${Math.min(i, 10)}"><div class="rows">${productRow(g.best.ref, extra + tags, i === 0 ? 'win' : '')}</div>
      ${rest.length ? `<details><summary>${t('{n} more at {chain}', { n: g.items.length - 1 + g.others, chain: esc(CHAINS[g.chain].name) })}</summary><div class="rows">${rest.map((p) => productRow(p.ref)).join('')}</div></details>` : ''}</div>`;
  }).join('');
  const missing = activeChains().filter((c) => !groups.some((g) => g.chain === c));
  if (missing.length) html += `<p class="note">${t('Not found at {chains}.', { chains: missing.map((c) => CHAINS[c].name).join(', ') })}</p>`;
  return html;
}

function viewProduct(chain, link) {
  if (!state.ready) return `<button class="back" data-back>${t('Back')}</button>` + skeletons(2, 260);
  const p = state.byId.get(`${chain}|${link}`);
  if (!p) return `<button class="back" data-back>${t('Back')}</button><div class="empty"><h3>${t('This product is no longer listed')}</h3><p>${t('It may have been renamed or removed by the supermarket.')}</p></div>`;
  const c = CHAINS[chain];
  const n = nearest(chain);
  const deal = dealFor(p);
  const have = onList(p);
  const fav = state.favs.some((x) => pid(x) === pid(p));
  const alts = alternatives(p);
  const cheaper = alts.filter((a) => a.kind !== 'similar' && a.p.price < p.price).sort((a, b) => a.p.price - b.p.price)[0];
  let html = `<button class="back" data-back>${t('Back')}</button>
    <div class="product enter" style="${chainVars(chain)}">
      <div class="shot">${pictureHtml(p, 'fill')}${deal ? `<span class="ribbon">${esc(deal.mechanism)}</span>` : ''}</div>
      <div class="info">
        <a class="chainline" href="#/chain/${chain}">${logo(chain, 'sm')}<span>${esc(c.name)}</span></a>
        <h1>${esc(p.name)}</h1>
        <p class="muted">${esc(p.size)}</p>
        <div class="bigprice">${price(p.price)}${p.unit ? `<span>${unitText(p.unit)}</span>` : ''}</div>
        ${deal ? `<p class="dealline"><span class="pill deal">${esc(deal.mechanism)}</span> ${esc(deal.title)}${deal.validUntil ? ` · ${t('until {day}', { day: dayLabel(deal.validUntil) })}` : ''}</p>` : ''}
        ${cheaper ? `<p class="dealline"><span class="pill good">${t('{amount} cheaper', { amount: euro(p.price - cheaper.p.price) })}</span> ${t('at {chain}', { chain: esc(CHAINS[cheaper.p.chain].name) })}</p>` : ''}
        <div class="actions">
          <button class="btn ${have ? 'ghost' : ''}" data-pin="${esc(pid(p))}">${have ? '✓ ' + t('On your list') : t('Add to list')}</button>
          <button class="btn ghost heartbtn ${fav ? 'on' : ''}" data-fav="${esc(pid(p))}" aria-pressed="${fav}">${fav ? '♥ ' + t('Favourite') : '♡ ' + t('Favourite')}</button>
          ${p.url ? `<a class="btn ghost" href="${esc(p.url)}" target="_blank" rel="noopener">${t('View at {chain}', { chain: esc(c.name) })}</a>` : ''}
        </div>
        ${n ? `<button class="nearline" data-go="#/chain/${chain}" data-focus-after="${esc(n.s.id)}"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span><b>${esc(n.s.address || n.s.name)}</b><br>${away(n.d)}${openHtml(n.s) ? ' · ' + openHtml(n.s) : ''}</span></button>` : ''}
      </div></div>`;
  const label = { same: t('Same product'), own: t('Own-brand version'), similar: t('Similar') };
  html += `<section class="sec"><div class="sec-head"><h2>${t('At other supermarkets')}</h2></div>
    ${alts.length ? `<div class="card"><div class="rows">${alts.map((a) => {
      const diff = a.p.price - p.price;
      const dn = nearest(a.p.chain);
      return productRow(a.p, ` · ${esc(CHAINS[a.p.chain].name)}${dn ? ` · ${km(dn.d)}` : ''} <span class="pill ${a.kind === 'similar' ? 'plain' : 'good'}">${label[a.kind]}</span>${a.kind !== 'similar' && Math.abs(diff) >= 0.005 ? ` <span class="pill ${diff < 0 ? 'good' : 'plain'}">${diff < 0 ? '−' : '+'}${euro(Math.abs(diff))}</span>` : ''}`);
    }).join('')}</div></div><p class="note">${t('Matched by name and size, so check the pack before you buy.')}</p>` : `<div class="empty"><p>${t('We could not find this product at other supermarkets.')}</p></div>`}</section>`;
  return html;
}

function viewChain(id, q = '') {
  const c = CHAINS[id];
  if (!c) return viewHome();
  const n = nearest(id);
  const stores = state.stores.filter((s) => s.chain === id).map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d);
  const deals = offersFor(id);
  const count = (state.byChain.get(id) || []).length;
  let html = `<a class="back" href="#/">${t('Home')}</a>
    <div class="chainhero enter" style="${chainVars(id)}"><div class="top">${logo(id, 'lg')}<div><h1>${esc(c.name)}</h1><p>${n ? `${t('Nearest store')} ${away(n.d)} · ${esc(n.s.address || '')}` : t('Prices and deals')}</p></div></div>
      <div class="stats"><div><strong>${stores.length || '–'}</strong>${t('stores in Amsterdam')}</div><div><strong>${state.ready ? count.toLocaleString(locale()) : '…'}</strong>${t('products')}</div><div><strong>${deals.length}</strong>${t('deals this week')}</div></div></div>`;

  const inner = q.trim();
  let products = '';
  if (state.ready) {
    if (inner) {
      const pool = state.byChain.get(id) || [];
      const r = find(inner, pool).results;
      const g = bestPerChain(r, state.sortBy)[0];
      products = g ? g.items.concat(r.filter((p) => !g.items.includes(p))).slice(0, 30).map((p) => productRow(p.ref)).join('') : `<div class="empty"><h3>${t('Not found at {chain}', { chain: esc(c.name) })}</h3></div>`;
    } else {
      products = staples().filter((x) => x.by.get(id)).map((x) => productRow(x.by.get(id).ref, ` · <span class="muted">${esc(x.q)}</span>`)).join('')
        || `<div class="empty"><h3>${t('No online prices')}</h3><p>${t('{chain} doesn’t publish its prices online, so we can only show stores and deals.', { chain: esc(c.name) })}</p></div>`;
    }
  }

  const fol = folderOf(id);
  html += `${fol ? `<section class="sec"><div class="sec-head"><h2>${t('This week’s folder')}</h2><span class="sub">${fol.validUntil ? t('Valid until {day}', { day: dayLabel(fol.validUntil) }) : ''}</span><a class="more" href="${esc(fol.url)}" target="_blank" rel="noopener">${t('Open')}</a></div><div class="rail pages">${folderTiles(id, fol, 40)}</div></section>` : ''}
    <div class="two" style="margin-top:20px"><div>
      ${deals.length ? `<section class="sec" style="margin-top:0"><div class="sec-head"><h2>${t('Deals this week')}</h2><span class="sub">${state.offers.chains[id]?.status === 'stale' ? t('Last known deals') : ''}</span></div><div class="grid">${deals.slice(0, 24).map((o, i) => dealTile({ ...o, chain: id }, i)).join('')}</div></section>` : ''}
      <section class="sec" ${deals.length ? '' : 'style="margin-top:0"'}><div class="sec-head"><h2>${inner ? t('Results') : t('Everyday prices')}</h2></div>
        <form class="innersearch" data-chain-search="${id}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg><input name="q" value="${esc(inner)}" placeholder="${t('Search at {chain}', { chain: esc(c.name) })}" autocomplete="off"></form>
        <div class="card"><div class="rows" id="chain-products">${products || skeletons(3, 60)}</div></div></section>
    </div>
    <div><section class="sec" style="margin-top:0"><div class="sec-head"><h2>${t('Stores')}</h2><span class="sub">${t('{n} in Amsterdam', { n: stores.length })}</span></div>
      <div class="mapbox" data-map="${id}"></div>
      ${stores.length ? `<div class="card" style="margin-top:12px"><div class="rows">${stores.slice(0, 8).map(({ s, d }) => storeRow(s, d, id)).join('')}</div></div>` : ''}
    </section></div></div>`;
  return html + footer();
}

function itemRow(item) {
  const p = item.pin && state.byId.get(pid(item.pin));
  const pic = p ? pictureHtml(p, 'row') : pictureHtml({ name: item.pin?.name || item.q }, 'row');
  return `<div class="row item"><span class="thumb">${pic}${item.pin ? logo(item.pin.chain, 'badge') : ''}</span>
    <div class="main">${p ? `<a class="n" href="${pHref(p)}">${esc(p.name)}</a>` : `<div class="n">${esc(item.pin?.name || item.q)}</div>`}<div class="s">${item.pin ? t('Exact product at {chain}', { chain: esc(CHAINS[item.pin.chain]?.name || item.pin.chain) }) : (translate(item.q) ? `“${esc(translate(item.q))}” · ` : '') + t('Cheapest match at each supermarket')}</div></div>
    <div class="stepper"><button data-qty="${item.id}:-1" aria-label="${t('Less')}">−</button><span class="num">${item.qty}</span><button data-qty="${item.id}:1" aria-label="${t('More')}">+</button></div>
    <button class="x" data-remove="${item.id}" aria-label="${t('Remove')}">×</button></div>`;
}

function tripCard(rows) {
  const complete = rows.filter((r) => r.complete && r.n);
  if (complete.length < 2) return '';
  const cheapest = [...complete].sort((a, b) => a.total - b.total)[0];
  const near = [...complete].sort((a, b) => a.n.d - b.n.d)[0];
  if (cheapest.c === near.c) return `<div class="tip good rise"><strong>${t('Your nearest option is also the cheapest')}</strong><span>${t('{chain}, {away}.', { chain: esc(CHAINS[near.c].name), away: away(near.n.d) })}</span></div>`;
  const saving = near.total - cheapest.total;
  const extraKm = Math.max(0, cheapest.n.d - near.n.d);
  const extra = bikeMin(extraKm) * 2;
  const worth = saving >= 1 && saving / Math.max(extra, 1) >= 0.2;
  return `<div class="tip ${worth ? 'good' : ''} rise"><strong>${worth ? t('Worth the trip: save {amount} at {chain}', { amount: euro(saving), chain: esc(CHAINS[cheapest.c].name) }) : t('Probably not worth the trip')}</strong>
    <span>${t('{cheap} is {amount} cheaper than {near}, your nearest complete option, and about {min} minutes extra by bike there and back.', { cheap: esc(CHAINS[cheapest.c].name), amount: euro(saving), near: esc(CHAINS[near.c].name), min: extra })}</span></div>`;
}
function splitCard(rows) {
  if (state.list.length < 2) return '';
  const s = bestSplit(rows);
  if (!s) return '';
  const single = rows.filter((r) => r.found >= s.found).sort((a, b) => a.total - b.total)[0];
  const saving = single ? single.total - s.total : 0;
  if (single && saving < 1) return '';
  const part = (r, items) => `<div class="splitcol">${logo(r.c, 'sm')}<div><b>${esc(CHAINS[r.c].name)}</b> <span class="muted">${km(r.n.d)}</span><ul>${items.map((x) => `<li>${x.item.qty > 1 ? x.item.qty + '× ' : ''}${esc(x.p.name)} <span class="num">${euro(x.p.price * x.item.qty)}</span></li>`).join('')}</ul></div></div>`;
  return `<div class="tip rise"><strong>${single ? t('Split it over two stores and save {amount} more', { amount: euro(saving) }) : t('Two stores together have everything')}</strong>
    <span>${t('Total {total} at {a} and {b}.', { total: euro(s.total), a: esc(CHAINS[s.a.c].name), b: esc(CHAINS[s.b.c].name) })}</span>
    <details><summary>${t('What to buy where')}</summary><div class="split">${part(s.a, s.at[0])}${part(s.b, s.at[1])}</div></details></div>`;
}

function favSection() {
  if (!state.favs.length) return '';
  const canAlert = 'Notification' in window;
  const alertsOn = canAlert && Notification.permission === 'granted';
  return `<section class="sec"><div class="sec-head"><div class="titles"><h2>${t('Favourites')}</h2><div class="sub">${t('We check these against the deals every morning.')}</div></div>
    ${canAlert && Notification.permission !== 'denied' ? `<button class="linkbtn more-btn" data-alerts ${alertsOn ? 'disabled' : ''}>${alertsOn ? t('Alerts on') : t('Turn on alerts')}</button>` : ''}</div>
    <div class="card"><div class="rows">${state.favs.map((f) => {
      const p = state.byId.get(pid(f));
      if (!p) return `<div class="row"><div class="main"><div class="n">${esc(f.name)}</div><div class="s">${t('No longer listed')}</div></div><button class="x" data-fav="${esc(pid(f))}" aria-label="${t('Remove')}">×</button></div>`;
      const d = dealFor(p);
      return productRow(p, ` · ${esc(CHAINS[p.chain].name)}${d ? ` <span class="pill deal">${esc(d.mechanism)}</span>` : ''}`);
    }).join('')}</div></div>
    ${alertsOn ? `<p class="note">${t('You get an alert when you open the app and a favourite is newly on offer.')}</p>` : ''}</section>`;
}

function viewList(params) {
  const shop = params.get('shop');
  if (shop && CHAINS[shop] && state.list.length) return viewShop(shop);
  let html = `<div class="pagehead"><div><h1>${t('Shopping list')}</h1><p>${t('See which supermarket is cheapest for everything you need.')}</p></div>
    ${state.list.length ? `<button class="locbtn" data-share><svg viewBox="0 0 24 24"><path d="M12 15V3m0 0L8 7m4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>${t('Share')}</button>` : ''}</div>`;
  if (state.incoming) html += `<div class="tip rise"><strong>${t('Someone shared a list of {n} items with you', { n: state.incoming.length })}</strong><span>${esc(state.incoming.slice(0, 6).map((i) => i.pin?.name || i.q).join(', '))}${state.incoming.length > 6 ? '…' : ''}</span>
    <div class="actions"><button class="btn" data-import="${state.list.length ? 'add' : 'replace'}">${state.list.length ? t('Add to my list') : t('Use this list')}</button>${state.list.length ? `<button class="btn ghost" data-import="replace">${t('Replace my list')}</button>` : ''}<button class="btn ghost" data-import="dismiss">${t('No thanks')}</button></div></div>`;
  html += `<form class="addrow" id="addform" autocomplete="off"><input id="additem" placeholder="${t('Add an item, like eieren')}" enterkeyhint="done"><button class="btn">${t('Add')}</button></form>`;
  if (!state.list.length) return html + `<div class="empty"><h3>${t('Your list is empty')}</h3><p>${t('Start with a few basics, or tap + on any product.')}</p></div><div class="suggest" style="justify-content:center">${['eieren', 'halfvolle melk', 'bananen', 'pasta', 'jonge kaas'].map((s) => `<button data-add="${s}">+ ${s}</button>`).join('')}</div>` + (state.ready ? favSection() : '');
  html += `<div class="card"><div class="rows">${state.list.map(itemRow).join('')}</div></div>`;
  if (!state.ready) return html + skeletons(3, 80);

  const rows = baskets();
  const N = state.list.length;
  html += tripCard(rows);
  html += `<div class="sec-head" style="margin-top:26px"><h2>${t('Total per supermarket')}</h2></div><div class="card"><div class="rows">${rows.map((r, i) => `
    <div class="row ${i === 0 && r.complete ? 'win' : ''} rise" style="--i:${i}">${logo(r.c)}
      <div class="main"><div class="n">${esc(CHAINS[r.c].name)} ${i === 0 && r.complete ? `<span class="pill good">${t('Cheapest')}</span>` : ''}${r.deals ? ` <span class="pill deal">${t('{n} on offer', { n: r.deals })}</span>` : ''}</div>
      <div class="s">${t('{found}/{n} items', { found: r.found, n: N })}${r.n ? ` · ${away(r.n.d)}` : ''}</div></div>
      <div class="price">${price(r.total)}<span>${r.complete ? t('total') : t('incomplete')}</span></div></div>
    <details class="rise basket" style="--i:${i}"><summary>${t('What’s in it')}</summary><ul class="picks">${r.picks.map((x) => `<li><span class="pickname">${x.p ? `${pictureHtml(x.p, 'xs')}<a href="${pHref(x.p)}">${x.item.qty > 1 ? x.item.qty + '× ' : ''}${esc(x.p.name)}</a>` : `<em>${t('{item}: not found', { item: esc(x.item.pin?.name || x.item.q) })}</em>`}</span><span class="num">${x.p ? euro(x.p.price * x.item.qty) : ''}</span></li>`).join('')}</ul>
      <button class="btn small" data-go="#/list?shop=${r.c}">${t('Shop here')}</button></details>`).join('')}</div></div>`;
  html += splitCard(rows);
  html += `<p class="note">${t('Uses your exact product where that supermarket sells it, otherwise the cheapest match. Baskets with missing items rank lower.')}</p>`;
  return html + favSection();
}

// Shopping mode: one store, big rows, tick things off as they go in the basket.
function viewShop(chain) {
  const c = CHAINS[chain];
  if (!state.ready) return skeletons(4, 70);
  const rows = state.list.map((item) => ({ item, p: picksFor(item).get(chain) }));
  const left = rows.filter((r) => !r.item.done);
  const leftTotal = left.reduce((s, r) => s + (r.p ? r.p.price * r.item.qty : 0), 0);
  const n = nearest(chain);
  const line = ({ item, p }) => `<button class="row rowbtn check ${item.done ? 'done' : ''}" data-done="${item.id}" aria-pressed="${item.done}"><span class="box">${item.done ? '✓' : ''}</span>
    ${p ? pictureHtml(p, 'row') : pictureHtml({ name: item.q }, 'row')}
    <div class="main"><div class="n">${item.qty > 1 ? item.qty + '× ' : ''}${esc(p ? p.name : item.pin?.name || item.q)}</div><div class="s">${p ? esc(p.size) : t('Not sold here, look for something similar')}</div></div>
    <span class="num">${p ? euro(p.price * item.qty) : ''}</span></button>`;
  return `<a class="back" href="#/list">${t('Shopping list')}</a>
    <div class="chainhero enter slim" style="${chainVars(chain)}"><div class="top">${logo(chain, 'lg')}<div><h1>${esc(c.name)}</h1><p>${n ? `${esc(n.s.address || n.s.name)} · ${away(n.d)}` : ''}</p></div></div>
      <div class="stats"><div><strong>${rows.length - left.length}/${rows.length}</strong>${t('in your basket')}</div><div>${price(leftTotal)}${t('still to go')}</div></div></div>
    <div class="card" style="margin-top:16px"><div class="rows">${rows.filter((r) => !r.item.done).map(line).join('')}${rows.filter((r) => r.item.done).map(line).join('')}</div></div>
    ${left.length ? '' : `<div class="tip good"><strong>${t('All done!')}</strong><div class="actions"><button class="btn" data-clear-done>${t('Clear the list')}</button><button class="btn ghost" data-untick>${t('Keep it for next time')}</button></div></div>`}`;
}

function viewMap() {
  const list = state.stores.filter((s) => s.chain !== 'other');
  return `<div class="pagehead"><div><h1>${t('Map')}</h1><p>${t('{n} supermarkets in Amsterdam. Tap the map to set your location.', { n: list.length || '' })}</p></div>${locButton()}</div>
    <div class="two"><div class="mapbox tall" data-map="all"></div>
    <div class="card"><div class="rows">${list.map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d).slice(0, 10)
      .map(({ s, d }) => `<button class="row rowbtn" data-focus="${esc(s.id)}">${logo(s.chain, 'sm')}<div class="main"><div class="n">${esc(CHAINS[s.chain].name)}</div><div class="s">${esc(s.address || '')}${openHtml(s) ? ' · ' + openHtml(s) : ''}</div></div><span class="num muted dist">${km(d)}<small>${travel(d)}</small></span></button>`).join('') || `<div class="empty">${t('Finding stores…')}</div>`}</div></div></div>`;
}

const locButton = () => `<button class="locbtn" data-loc-open><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span>${esc(state.here.label === 'Your location' || state.here.label === 'Pinned location' ? t(state.here.label) : state.here.label)}</span></button>`;
const footer = () => `<p class="note" style="margin-top:40px">${t('Prices: {source}, updated daily; online prices can differ in store. Deals checked every morning. Stores and map © {osm}.', { source: `<a href="https://github.com/supermarkt/checkjebon" target="_blank" rel="noopener">Checkjebon open data</a>`, osm: `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>` })}
  ${state.installEvent ? ` <button class="linkbtn" data-install>${t('Install as an app')}</button>` : ''}</p>`;

// ---------- location sheet ----------
let placeResults = [];
function openSheet() {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.id = 'sheet';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${t('Your location')}">
    <div class="sheet-head"><h2>${t('Where are you?')}</h2><button class="x" data-sheet-close aria-label="${t('Close')}">×</button></div>
    <form class="innersearch" id="placeform" autocomplete="off"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg><input id="place" placeholder="${t('Street, address or postcode')}" enterkeyhint="search"></form>
    <div class="rows" id="places"></div>
    <div class="sheet-actions"><button class="btn" data-loc-gps>${t('Use my current location')}</button><button class="btn ghost" data-go="#/map" data-sheet-close>${t('Pick on the map')}</button></div>
    <p class="note">${t('Your location stays on this device.')}</p></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const input = $('#place', el);
  input.focus();
  let timer; let seq = 0;
  const run = async () => {
    const q = input.value.trim();
    const box = $('#places', el);
    if (q.length < 3) { box.innerHTML = ''; return; }
    const mine = ++seq;
    try {
      const found = await findPlaces(q);
      if (mine !== seq) return;
      placeResults = found;
      box.innerHTML = found.length ? found.map((p, i) => `<button class="row rowbtn" data-place="${i}"><div class="main"><div class="n">${esc(p.label)}</div>${p.near ? '' : `<div class="s">${t('Outside Amsterdam')}</div>`}</div></button>`).join('') : `<p class="note">${t('No address found. Try a street name or postcode.')}</p>`;
    } catch {
      if (mine === seq) box.innerHTML = `<p class="note">${t('Address search is not reachable right now. Use your current location or pick a spot on the map.')}</p>`;
    }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  $('#placeform', el).addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); run(); });
  el.addEventListener('click', (e) => { if (e.target === el) closeSheet(); });
}
function closeSheet() { $('#sheet')?.remove(); }

let toastTimer;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('in'), 2600);
}

// ---------- map ----------
function ensureMap() {
  if (state.map || !window.L) return;
  const host = $('#map-host');
  host.hidden = false;
  state.map = L.map('map', { scrollWheelZoom: false }).setView([state.here.lat, state.here.lon], 13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>' }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
  state.you = L.marker([state.here.lat, state.here.lon], { icon: L.divIcon({ className: '', html: '<div class="you"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000 }).addTo(state.map);
  state.map.on('click', (e) => setHere(e.latlng.lat, e.latlng.lng, 'Pinned location'));
}

function drawStores(chain) {
  if (!state.layer) return;
  state.layer.clearLayers();
  const list = state.stores.filter((s) => chain === 'all' || s.chain === chain);
  for (const s of list) {
    const known = s.chain !== 'other';
    const html = known ? `<div class="pin" style="${chainVars(s.chain)}">${state.logos[s.chain] ? `<img src="${esc(state.logos[s.chain])}" alt="" onerror="this.parentNode.classList.add('fail')">` : ''}<b>${esc(CHAINS[s.chain].short)}</b></div>` : '<div class="dot"></div>';
    const m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html, iconSize: known ? [26, 26] : [9, 9], iconAnchor: known ? [13, 13] : [5, 5] }) });
    m.bindPopup(() => { const d = distanceKm(state.here, s); return `<strong>${esc(s.name)}</strong><br>${s.address ? esc(s.address) + '<br>' : ''}${openHtml(s) ? openHtml(s) + '<br>' : ''}${away(d)}<br><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener" class="route">${t('Route')}</a>`; });
    m.storeId = s.id;
    m.addTo(state.layer);
  }
  return list;
}

function mountMap() {
  const box = $('[data-map]', view);
  const host = $('#map-host');
  if (!box) { host.hidden = true; document.body.appendChild(host); return; }
  ensureMap();
  if (!state.map) return;
  host.hidden = false;
  box.appendChild(host);
  const chain = box.dataset.map;
  state.mapChain = chain;
  const list = drawStores(chain) || [];
  requestAnimationFrame(() => {
    state.map.invalidateSize();
    const near = list.map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d).slice(0, chain === 'all' ? 12 : 4);
    const pts = near.map(({ s }) => [s.lat, s.lon]).concat([[state.here.lat, state.here.lon]]);
    if (pts.length > 1) state.map.fitBounds(pts, { padding: [36, 36], maxZoom: 15, animate: false });
  });
}

function focusStore(id) {
  const s = state.stores.find((x) => x.id === id);
  if (!s || !state.map) return;
  state.map.flyTo([s.lat, s.lon], 16, { duration: .7 });
  state.layer.eachLayer((l) => { if (l.storeId === id) setTimeout(() => l.openPopup(), 750); });
  $('[data-map]', view)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setHere(lat, lon, label) {
  state.here = { lat, lon, label };
  store(HERE_KEY, state.here);
  state.you?.setLatLng([lat, lon]);
  render({ keepScroll: true });
}

// ---------- router ----------
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  let arg2 = parts[2];
  try { arg2 = arg2 && decodeURIComponent(arg2); } catch { /* keep as is */ }
  return { name: parts[0] || 'home', arg: parts[1], arg2, q: params.get('q') || '', params };
}

let lastRoute = '';
function render({ keepScroll = false } = {}) {
  const r = parse();
  if (r.name === 'list' && r.params.get('share')) {
    state.incoming = decodeShare(r.params.get('share'));
    history.replaceState(null, '', '#/list');
    if (!state.incoming) toast(t('That shared list could not be read.'));
  }
  const key = `${r.name}/${r.arg || ''}/${r.arg2 || ''}/${r.params.get('shop') || ''}`;
  const html = r.name === 'search' ? viewSearch(r.q, r.params.has('exact')) : r.name === 'list' ? viewList(r.params) : r.name === 'map' ? viewMap()
    : r.name === 'chain' ? viewChain(r.arg, r.q) : r.name === 'p' ? viewProduct(r.arg, r.arg2) : viewHome();
  const host = $('#map-host');
  if (host.parentNode !== document.body) document.body.appendChild(host);
  view.innerHTML = html;
  if (key !== lastRoute) {
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    if (!keepScroll) window.scrollTo({ top: 0 });
  }
  lastRoute = key;
  if (r.name !== 'search' && document.activeElement !== $('#q')) $('#q').value = '';
  const nav = r.name === 'chain' ? 'home' : r.name === 'p' ? 'search' : r.name;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
  mountMap();
}

function updateCounts() {
  const n = state.list.filter((i) => !i.done).length;
  document.querySelectorAll('[data-list-count]').forEach((el) => { el.textContent = n || ''; });
  const hot = favDeals().length > 0;
  document.querySelectorAll('[data-nav="list"]').forEach((el) => el.classList.toggle('hot', hot));
}

function applyStatic() {
  document.documentElement.lang = lang();
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-tp]').forEach((el) => { el.placeholder = t(el.dataset.tp); el.setAttribute('aria-label', t(el.dataset.tp)); });
  $('#lang').textContent = lang() === 'nl' ? 'EN' : 'NL';
  $('#lang').setAttribute('aria-label', lang() === 'nl' ? 'Switch to English' : 'Schakel naar Nederlands');
}

// ---------- favourites and alerts ----------
async function notifyFavDeals() {
  const deals = favDeals();
  updateCounts();
  if (!deals.length || !('Notification' in window) || Notification.permission !== 'granted') return;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { /* ignore */ }
  const keyOf = (x) => `${pid(x.p)}|${x.d.validUntil || x.d.mechanism}`;
  const fresh = deals.filter((x) => !seen.includes(keyOf(x)));
  if (!fresh.length) return;
  store(SEEN_KEY, [...seen, ...fresh.map(keyOf)].slice(-200));
  const title = fresh.length === 1 ? t('{name} is on offer', { name: fresh[0].p.name }) : t('{n} of your favourites are on offer', { n: fresh.length });
  const body = fresh.slice(0, 3).map((x) => `${CHAINS[x.p.chain].name}: ${x.p.name} (${x.d.mechanism})`).join('\n');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'fav-deals', data: { url: './#/list' } });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch { /* alerts are a bonus */ }
}

function togglePin(key) {
  const p = state.byId.get(key);
  if (!p) return;
  const i = state.list.findIndex((x) => x.pin && pid(x.pin) === key);
  if (i >= 0) { state.list.splice(i, 1); toast(t('Removed from your list')); } else { state.list.push(newItem(p.name, { chain: p.chain, link: p.link, name: p.name })); toast(t('Added to your list')); }
  persistList();
  render({ keepScroll: true });
}
function toggleFav(key) {
  const i = state.favs.findIndex((x) => pid(x) === key);
  if (i >= 0) state.favs.splice(i, 1);
  else { const p = state.byId.get(key); if (!p) return; state.favs.push({ chain: p.chain, link: p.link, name: p.name }); toast(t('Saved to favourites. We’ll flag it when it’s on offer.')); }
  saveFavs(state.favs);
  updateCounts();
  render({ keepScroll: true });
}
async function shareList() {
  const url = `${location.origin}${location.pathname}#/list?share=${encodeShare(state.list)}`;
  try {
    if (navigator.share) { await navigator.share({ title: t('Shopping list'), text: t('My shopping list on Prijsradar'), url }); return; }
    await navigator.clipboard.writeText(url);
    toast(t('Link copied. Anyone who opens it gets your list.'));
  } catch (e) {
    if (e?.name !== 'AbortError') prompt(t('Copy this link:'), url);
  }
}

// ---------- events ----------
function wire() {
  window.addEventListener('hashchange', () => { closeSheet(); render(); });
  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = e.target.value.trim();
      const target = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
      if (parse().name !== 'search') history.pushState(null, '', target);
      else if (location.hash !== target) history.replaceState(null, '', target);
      render({ keepScroll: true });
    }, 160);
  });
  $('#searchbox').addEventListener('submit', (e) => { e.preventDefault(); $('#q').blur(); });
  $('#lang').addEventListener('click', () => { setLang(lang() === 'nl' ? 'en' : 'nl'); applyStatic(); render({ keepScroll: true }); });

  view.addEventListener('submit', (e) => {
    if (e.target.id === 'addform') {
      e.preventDefault();
      const v = $('#additem').value.trim();
      if (v) { state.list.push(newItem(v)); persistList(); render({ keepScroll: true }); $('#additem').focus(); }
    } else if (e.target.dataset.chainSearch) {
      e.preventDefault();
      const q = e.target.q.value.trim();
      location.hash = `#/chain/${e.target.dataset.chainSearch}${q ? '?q=' + encodeURIComponent(q) : ''}`;
    }
  });
  let chainTimer;
  view.addEventListener('input', (e) => {
    const form = e.target.closest('[data-chain-search]');
    if (!form) return;
    clearTimeout(chainTimer);
    chainTimer = setTimeout(() => {
      const r = parse();
      const q = e.target.value.trim();
      history.replaceState(null, '', `#/chain/${r.arg}${q ? '?q=' + encodeURIComponent(q) : ''}`);
      const tmp = document.createElement('div');
      tmp.innerHTML = viewChain(r.arg, q);
      $('#chain-products').innerHTML = $('#chain-products', tmp).innerHTML;
    }, 160);
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, [data-go]');
    if (!b) return;
    const d = b.dataset;
    if ('sheetClose' in d) closeSheet();
    if (d.go) { location.hash = d.go; if (d.focusAfter) setTimeout(() => focusStore(d.focusAfter), 450); }
    else if ('back' in d) { if (history.length > 1) history.back(); else location.hash = '#/'; }
    else if (d.sort) { state.sortBy = d.sort; render({ keepScroll: true }); }
    else if (d.filter) {
      const f = state.filter;
      if (d.filter === 'clear') Object.assign(f, { group: null, organic: false, offer: false });
      else if (d.filter === 'organic') f.organic = !f.organic;
      else if (d.filter === 'offer') f.offer = !f.offer;
      else { const g = d.filter.slice(6); f.group = f.group === g ? null : g; }
      render({ keepScroll: true });
    }
    else if (d.pin) togglePin(d.pin);
    else if (d.fav) toggleFav(d.fav);
    else if (d.qty) {
      const [id, step] = d.qty.split(':');
      const item = state.list.find((i) => i.id === id);
      if (item) { item.qty = Math.max(1, Math.min(99, item.qty + Number(step))); persistList(); render({ keepScroll: true }); }
    }
    else if (d.remove) { state.list = state.list.filter((i) => i.id !== d.remove); persistList(); render({ keepScroll: true }); }
    else if (d.done) { const item = state.list.find((i) => i.id === d.done); if (item) { item.done = !item.done; persistList(); render({ keepScroll: true }); } }
    else if ('clearDone' in d) { state.list = []; persistList(); location.hash = '#/list'; }
    else if ('untick' in d) { state.list.forEach((i) => { i.done = false; }); persistList(); location.hash = '#/list'; }
    else if ('staples' in d) { for (const q of STAPLES) if (!state.list.some((i) => i.q === q)) state.list.push(newItem(q)); persistList(); location.hash = '#/list'; }
    else if (d.add) { state.list.push(newItem(d.add)); persistList(); render({ keepScroll: true }); }
    else if ('share' in d) shareList();
    else if (d.import) {
      if (d.import === 'replace') state.list = state.incoming;
      else if (d.import === 'add') state.list.push(...state.incoming);
      state.incoming = null; persistList(); render({ keepScroll: true });
    }
    else if (d.focus) focusStore(d.focus);
    else if ('locOpen' in d) openSheet();
    else if (d.place != null) { const p = placeResults[Number(d.place)]; if (p) { closeSheet(); setHere(p.lat, p.lon, p.label.split(',')[0]); } }
    else if ('locGps' in d) {
      if (!navigator.geolocation) { toast(t('This browser cannot share its location.')); return; }
      b.textContent = t('Locating…');
      navigator.geolocation.getCurrentPosition(
        (p) => { closeSheet(); setHere(p.coords.latitude, p.coords.longitude, 'Your location'); },
        () => { b.textContent = t('Use my current location'); toast(t('We could not get your location. Search for your address instead.')); },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
    else if ('alerts' in d) Notification.requestPermission().then((perm) => { if (perm === 'granted') { toast(t('Alerts are on.')); notifyFavDeals(); } render({ keepScroll: true }); });
    else if ('install' in d) { state.installEvent?.prompt(); state.installEvent = null; render({ keepScroll: true }); }
  });

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvent = e; if (parse().name === 'home') render({ keepScroll: true }); });
}

async function main() {
  saveList(state.list); // keeps a list from the first version in the new format
  applyStatic();
  wire();
  updateCounts();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { /* the site works without it */ });
  loadImages().then(() => { if (state.ready) render({ keepScroll: true }); });
  loadOffers().then((o) => { state.offers = o; if (state.ready) { render({ keepScroll: true }); notifyFavDeals(); } });
  loadStores().then(({ stores }) => {
    state.stores = stores;
    if (stores.length) state.storeChains = new Set(stores.map((s) => s.chain));
    render({ keepScroll: true });
  });
  try {
    const { products, chainsWithData, logos } = await loadPrices();
    const byChain = new Map(); const byId = new Map();
    for (const p of products) {
      if (!byChain.has(p.chain)) byChain.set(p.chain, []);
      byChain.get(p.chain).push(p);
      byId.set(pid(p), p);
    }
    Object.assign(state, { products, byChain, byId, chainsWithData, logos, ready: true });
    render({ keepScroll: true });
    notifyFavDeals();
  } catch (err) {
    console.error(err);
    view.insertAdjacentHTML('afterbegin', `<div class="empty"><h3>${t('Prices could not load')}</h3><p>${t('Please try again in a moment.')}</p></div>`);
  }
}

main();
