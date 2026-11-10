import { CHAINS } from './chains.js';
import { BASE_LABEL } from './units.js';
import { loadPrices, loadStores, loadOffers, distanceKm, normalize } from './data.js';
import { search, bestPerChain } from './search.js';

const DEFAULT_LOCATION = { lat: 52.3791, lon: 4.9003, label: 'Amsterdam Centraal' };
const LIST_KEY = 'ams-shopping-list-v1';
const STAPLES = ['halfvolle melk', 'eieren', 'bananen', 'volkoren brood', 'pindakaas', 'jonge kaas', 'spaghetti', 'koffiebonen'];

const state = {
  ready: false, products: [], chainsWithData: [], logos: {}, stores: [], storeChains: null,
  offers: { chains: {} }, here: { ...DEFAULT_LOCATION }, sortBy: 'unit', list: readList(),
  staples: null, map: null, layer: null, you: null, mapChain: null,
};

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const euro = (v) => '€' + v.toFixed(2).replace('.', ',');
const km = (d) => (d < 1 ? `${Math.round(d * 100) * 10} m` : `${d.toFixed(1).replace('.', ',')} km`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unitText = (u) => (u ? `${euro(u.value)} / ${BASE_LABEL[u.unit]}` : '');
const dayLabel = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const today = () => new Date().toISOString().slice(0, 10);
function readList() { try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; } }
function saveList() { try { localStorage.setItem(LIST_KEY, JSON.stringify(state.list)); } catch { /* ignore */ } updateCounts(); }
const chainVars = (id) => `--chain:${CHAINS[id]?.color || '#999'};--chain-ink:${CHAINS[id]?.ink || '#fff'}`;

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
  const t = today();
  const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10); // include next week's folder a day or two early
  return (state.offers.chains?.[chain]?.offers || []).filter((o) => (!o.validUntil || o.validUntil >= t) && (!o.validFrom || o.validFrom <= soon));
}
function matchOffers(chain, q) {
  const tokens = normalize(q).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return offersFor(chain).filter((o) => { o._k ??= normalize(o.title).split(' '); return tokens.every((t) => o._k.some((w) => w.startsWith(t))); });
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
    <div class="pg"><img src="${esc(p.image)}" alt="Folder page ${p.n}" loading="lazy"></div><div class="bd"><span class="u">Page ${p.n}</span></div></a>`).join('');
}

function dealTile(o, i = 0) {
  return `<a class="tile rise" style="--i:${Math.min(i, 12)};${chainVars(o.chain)}" href="${esc(o.url || '#/chain/' + o.chain)}" ${o.url ? 'target="_blank" rel="noopener"' : ''}>
    <div class="ph ${o.image ? '' : 'word'}">${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">` : `<span>${esc(o.title.split(' ').slice(0, 3).join(' '))}</span>`}<span class="ribbon">${esc(o.mechanism)}</span></div>
    <div class="bd"><span class="t">${esc(o.title)}</span>
      <span class="p">${o.price ? `<strong>${euro(o.price)}</strong>` : ''}${o.was && o.price && o.was > o.price ? `<s>${euro(o.was)}</s>` : ''}</span>
      ${o.validFrom && o.validFrom > today() ? `<span class="u">From ${dayLabel(o.validFrom)}</span>` : o.validUntil ? `<span class="u">Until ${dayLabel(o.validUntil)}</span>` : ''}</div></a>`;
}
function productTile(p, label, i = 0) {
  return `<a class="tile rise" style="--i:${i};${chainVars(p.chain)}" href="${p.url ? esc(p.url) : '#'}" target="_blank" rel="noopener">
    <div class="ph word"><span>${esc(label)}</span></div>
    <div class="bd"><span class="t">${esc(p.name)}</span><span class="p"><strong>${euro(p.price)}</strong></span><span class="u">${esc(p.size)}${p.unit ? ' · ' + unitText(p.unit) : ''}</span></div></a>`;
}
function productRow(p, extra = '') {
  return `<a class="row" href="${p.url ? esc(p.url) : '#'}" target="_blank" rel="noopener">${logo(p.chain)}
    <div class="main"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.size)}${extra}</div></div>
    <div class="price"><strong>${euro(p.price)}</strong><span>${unitText(p.unit)}</span></div></a>`;
}
const skeletons = (n, h = 120) => Array.from({ length: n }, () => `<div class="skel" style="height:${h}px;margin-top:14px"></div>`).join('');

// ---------- views ----------
function viewHome() {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  let html = `<div class="greeting"><div><h1>${hello}</h1><p>Every supermarket in Amsterdam, in one place.</p></div>${locButton()}</div>`;
  if (!state.ready) return html + skeletons(3, 220);

  const chains = chainsByDistance(true);
  html += `<section class="sec"><div class="sec-head"><h2>Supermarkets near you</h2><span class="sub">${chains.length} chains</span></div><div class="rail">${chains.map(({ c, n }, i) => {
    const deals = offersFor(c).length;
    return `<a class="storecard rise" style="--i:${i};${chainVars(c)}" href="#/chain/${c}">${logo(c)}<div><div class="n">${esc(CHAINS[c].name)}</div><div class="d">${n ? `${km(n.d)} away` : 'Prices only'}${state.chainsWithData.includes(c) ? '' : ' · no online prices'}</div></div>${deals ? `<span class="tag">${deals} deals</span>` : ''}</a>`;
  }).join('')}</div></section>`;

  const st = staples();
  for (const [ci, { c, n }] of chains.entries()) {
    const deals = offersFor(c);
    const hasPrices = state.chainsWithData.includes(c);
    const storeTiles = () => state.stores.filter((s) => s.chain === c).map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d).slice(0, 6)
      .map(({ s, d }, i) => `<button class="storecard rise" style="--i:${i};${chainVars(c)};text-align:left;border:0;cursor:pointer" data-go="#/chain/${c}">${logo(c, 'sm')}<div><div class="n">${esc(s.address || s.name)}</div><div class="d">${km(d)} away</div></div></button>`).join('');
    const tiles = deals.length
      ? deals.slice(0, 12).map((o, i) => dealTile({ ...o, chain: c }, i)).join('')
      : hasPrices ? st.filter((x) => x.by.get(c)).map((x, i) => productTile(x.by.get(c), x.q, i)).join('') : storeTiles();
    html += `<section class="chainsec rise" style="--i:${ci}">
      <div class="sec-head">${logo(c)}<div class="titles"><h2>${esc(CHAINS[c].name)}</h2><div class="sub">${n ? `${km(n.d)} · ${esc(n.s.address || n.s.name)}` : 'No store location found'}${deals.length ? ` · ${deals.length} deals this week` : hasPrices ? ' · Everyday prices' : ' · Stores (no online prices)'}</div></div><a class="more" href="#/chain/${c}">View</a></div>
      <div class="rail">${tiles}<a class="tile add" href="#/chain/${c}">See everything at ${esc(CHAINS[c].name)}</a></div>
      ${folderOf(c) ? `<div class="subhead">This week’s folder${folderOf(c).validUntil ? ` · until ${dayLabel(folderOf(c).validUntil)}` : ''}</div><div class="rail pages">${folderTiles(c, folderOf(c), 10)}</div>` : ''}</section>`;
  }
  const locals = state.stores.filter((s) => s.chain === 'other').map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d).slice(0, 14);
  if (locals.length) {
    html += `<section class="sec"><div class="sec-head"><div class="titles"><h2>Local and speciality shops</h2><div class="sub">Turkish, Moroccan, Asian, organic and independent supermarkets near you</div></div><a class="more" href="#/map">Map</a></div>
      <div class="rail">${locals.map(({ s, d }, i) => `<button class="storecard rise" style="--i:${i};--chain:#8e8e93;text-align:left;border:0;cursor:pointer" data-go="#/map" data-focus-after="${esc(s.id)}"><span class="logo" style="--chain:#8e8e93"><b>${esc((s.name || '?').trim()[0].toUpperCase())}</b></span><div><div class="n">${esc(s.name)}</div><div class="d">${km(d)} away${s.address ? ' · ' + esc(s.address) : ''}</div></div></button>`).join('')}</div></section>`;
  }
  return html + footer();
}

function viewSearch(q) {
  $('#q').value = q;
  if (!q) return `<div class="pagehead"><div><h1>Search</h1><p>Compare any product across every supermarket.</p></div></div>
    <div class="suggest">${STAPLES.map((s) => `<button data-go="#/search?q=${encodeURIComponent(s)}">${s}</button>`).join('')}</div>`;
  if (!state.ready) return `<div class="pagehead"><div><h1>“${esc(q)}”</h1></div></div>` + skeletons(4, 90);
  const active = new Set(activeChains());
  const groups = bestPerChain(search(state.products, q).filter((p) => active.has(p.chain)), state.sortBy);
  let html = `<div class="pagehead"><div><h1>“${esc(q)}”</h1><p>${groups.length ? `Found at ${groups.length} supermarkets` : 'No results'}</p></div>
    <div class="seg" role="group" aria-label="Sort"><button data-sort="unit" class="${state.sortBy === 'unit' ? 'on' : ''}">Per kg / l</button><button data-sort="price" class="${state.sortBy === 'price' ? 'on' : ''}">Pack price</button></div></div>`;
  if (!groups.length) return html + `<div class="empty"><h3>Nothing found</h3><p>Try fewer or simpler words.</p></div>`;

  const best = groups[0];
  const near = groups.map((g) => ({ g, n: nearest(g.chain) })).filter((x) => x.n).sort((a, b) => a.n.d - b.n.d)[0];
  html += `<div class="summary">
    <div class="stat rise"><div class="k">Cheapest</div><div class="v">${euro(best.best.price)}<small>${esc(CHAINS[best.chain].name)}</small></div></div>
    ${near ? `<div class="stat rise" style="--i:1"><div class="k">Closest with it</div><div class="v">${km(near.n.d)}<small>${esc(CHAINS[near.g.chain].name)}</small></div></div>` : ''}
    ${groups.length > 1 ? `<div class="stat rise" style="--i:2"><div class="k">You save up to</div><div class="v">${euro(Math.max(0, groups[groups.length - 1].best.price - best.best.price))}</div></div>` : ''}</div>`;

  html += groups.map((g, i) => {
    const n = nearest(g.chain);
    const deal = matchOffers(g.chain, q)[0];
    const extra = ` · ${esc(CHAINS[g.chain].name)}${n ? ` · ${km(n.d)}` : ''}`;
    const tags = `${i === 0 ? ' <span class="pill good">Best price</span>' : ''}${deal ? ` <span class="pill deal">${esc(deal.mechanism)}</span>` : ''}`;
    const more = g.items.slice(1, 8);
    return `<div class="card compare-group rise" style="--i:${i}"><div class="rows">${productRow(g.best, extra + tags).replace('class="row"', `class="row ${i === 0 ? 'win' : ''}"`)}</div>
      ${more.length ? `<details><summary>${g.items.length - 1 + g.others} more at ${esc(CHAINS[g.chain].name)}</summary><div class="rows">${more.map((p) => productRow(p)).join('')}</div></details>` : ''}</div>`;
  }).join('');
  const missing = activeChains().filter((c) => !groups.some((g) => g.chain === c));
  if (missing.length) html += `<p class="note">Not found at ${missing.map((c) => CHAINS[c].name).join(', ')}.</p>`;
  return html;
}

function viewChain(id, q = '') {
  const c = CHAINS[id];
  if (!c) return viewHome();
  const n = nearest(id);
  const stores = state.stores.filter((s) => s.chain === id).map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d);
  const deals = offersFor(id);
  const count = state.products.filter((p) => p.chain === id).length;
  let html = `<a class="back" href="#/">Home</a>
    <div class="chainhero enter" style="${chainVars(id)}"><div class="top">${logo(id, 'lg')}<div><h1>${esc(c.name)}</h1><p>${n ? `Nearest store ${km(n.d)} away · ${esc(n.s.address || '')}` : 'Prices and deals'}</p></div></div>
      <div class="stats"><div><strong>${stores.length || '–'}</strong>stores in Amsterdam</div><div><strong>${state.ready ? count.toLocaleString('en-GB') : '…'}</strong>products</div><div><strong>${deals.length}</strong>deals this week</div></div></div>`;

  const inner = q.trim();
  let products = '';
  if (state.ready) {
    if (inner) {
      const r = search(state.products, inner).filter((p) => p.chain === id);
      const g = bestPerChain(r, state.sortBy)[0];
      products = g ? g.items.concat(r.filter((p) => !g.items.includes(p))).slice(0, 30).map((p) => productRow(p)).join('') : `<div class="empty"><h3>Not found at ${esc(c.name)}</h3></div>`;
    } else {
      products = staples().filter((x) => x.by.get(id)).map((x) => productRow(x.by.get(id), ` · <span class="muted">${esc(x.q)}</span>`)).join('')
        || `<div class="empty"><h3>No online prices</h3><p>${esc(c.name)} doesn’t publish its prices online, so we can only show stores${deals.length ? ' and deals' : ''}.</p></div>`;
    }
  }

  const fol = folderOf(id);
  html += `${fol ? `<section class="sec"><div class="sec-head"><h2>This week’s folder</h2><span class="sub">${fol.validUntil ? `Valid until ${dayLabel(fol.validUntil)}` : ''}</span><a class="more" href="${esc(fol.url)}" target="_blank" rel="noopener">Open</a></div><div class="rail pages">${folderTiles(id, fol, 40)}</div></section>` : ''}
    <div class="two" style="margin-top:20px"><div>
      ${deals.length ? `<section class="sec" style="margin-top:0"><div class="sec-head"><h2>Deals this week</h2><span class="sub">${state.offers.chains[id]?.status === 'stale' ? 'Last known deals' : ''}</span></div><div class="grid">${deals.slice(0, 24).map((o, i) => dealTile({ ...o, chain: id }, i)).join('')}</div></section>` : ''}
      <section class="sec" ${deals.length ? '' : 'style="margin-top:0"'}><div class="sec-head"><h2>${inner ? 'Results' : 'Everyday prices'}</h2></div>
        <form class="innersearch" data-chain-search="${id}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg><input name="q" value="${esc(inner)}" placeholder="Search at ${esc(c.name)}" autocomplete="off"></form>
        <div class="card"><div class="rows" id="chain-products">${products || skeletons(3, 60)}</div></div></section>
    </div>
    <div><section class="sec" style="margin-top:0"><div class="sec-head"><h2>Stores</h2><span class="sub">${stores.length} in Amsterdam</span></div>
      <div class="mapbox" data-map="${id}"></div>
      ${stores.length ? `<div class="card" style="margin-top:12px"><div class="rows">${stores.slice(0, 8).map(({ s, d }) => `<button class="row" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;text-align:left;cursor:pointer" data-focus="${esc(s.id)}">${logo(id, 'sm')}<div class="main"><div class="n">${esc(s.address || s.name)}</div><div class="s">${esc(s.hours || s.postcode || '')}</div></div><span class="num muted">${km(d)}</span></button>`).join('')}</div></div>` : ''}
    </section></div></div>`;
  return html + footer();
}

function viewList() {
  let html = `<div class="pagehead"><div><h1>Shopping list</h1><p>See which supermarket is cheapest for everything you need.</p></div></div>
    <form class="addrow" id="addform" autocomplete="off"><input id="additem" placeholder="Add an item, like eieren" enterkeyhint="done"><button class="btn">Add</button></form>`;
  html += state.list.length ? `<div class="chips">${state.list.map((q, i) => `<span class="chipx">${esc(q)}<button data-remove="${i}" aria-label="Remove ${esc(q)}">×</button></span>`).join('')}</div>` : '';
  if (!state.list.length) return html + `<div class="empty"><h3>Your list is empty</h3><p>Start with a few basics.</p></div><div class="suggest" style="justify-content:center">${['eieren', 'halfvolle melk', 'bananen', 'pasta', 'jonge kaas'].map((s) => `<button data-add="${s}">+ ${s}</button>`).join('')}</div>`;
  if (!state.ready) return html + skeletons(3, 80);

  const per = state.list.map((q) => new Map(bestPerChain(search(state.products, q)).map((g) => [g.chain, g.best])));
  const N = state.list.length;
  const rows = activeChains().map((c) => {
    let total = 0; let found = 0; let deals = 0;
    const picks = state.list.map((q, i) => { const p = per[i].get(c); const d = matchOffers(c, q)[0]; if (p) { total += p.price; found++; } if (d) deals++; return { q, p, d }; });
    return { c, total, found, deals, picks, n: nearest(c) };
  }).filter((r) => r.found).sort((a, b) => b.found - a.found || a.total - b.total);

  html += `<div class="card"><div class="rows">${rows.map((r, i) => `
    <div class="row ${i === 0 && r.found === N ? 'win' : ''} rise" style="--i:${i}">${logo(r.c)}
      <div class="main"><div class="n">${esc(CHAINS[r.c].name)} ${i === 0 && r.found === N ? '<span class="pill good">Cheapest</span>' : ''}${r.deals ? ` <span class="pill deal">${r.deals} on offer</span>` : ''}</div>
      <div class="s">${r.found}/${N} items${r.n ? ` · ${km(r.n.d)} away` : ''}</div></div>
      <div class="price"><strong>${euro(r.total)}</strong><span>${r.found < N ? 'incomplete' : 'total'}</span></div></div>
    <details class="rise" style="--i:${i}"><summary class="picks" style="cursor:pointer;color:var(--accent);font-weight:600;list-style:none">What’s in it</summary><ul class="picks">${r.picks.map((x) => `<li><span>${x.p ? esc(x.p.name) : `<em>${esc(x.q)}: not found</em>`}</span><span class="num">${x.p ? euro(x.p.price) : ''}</span></li>`).join('')}</ul></details>`).join('')}</div></div>
    <p class="note">Uses the cheapest matching product per item. Baskets with missing items rank lower.</p>`;
  return html;
}

function viewMap() {
  return `<div class="pagehead"><div><h1>Map</h1><p>${state.stores.filter((s) => s.chain !== 'other').length || 'All'} supermarkets in Amsterdam. Tap the map to set your location.</p></div>${locButton()}</div>
    <div class="two"><div class="mapbox tall" data-map="all"></div>
    <div class="card"><div class="rows">${state.stores.filter((s) => s.chain !== 'other').map((s) => ({ s, d: distanceKm(state.here, s) })).sort((a, b) => a.d - b.d).slice(0, 10)
      .map(({ s, d }) => `<button class="row" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;text-align:left;cursor:pointer" data-focus="${esc(s.id)}">${logo(s.chain, 'sm')}<div class="main"><div class="n">${esc(CHAINS[s.chain].name)}</div><div class="s">${esc(s.address || '')}</div></div><span class="num muted">${km(d)}</span></button>`).join('') || '<div class="empty">Finding stores…</div>'}</div></div></div>`;
}

const locButton = () => `<button class="locbtn" data-locate><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>${esc(state.here.label)}</button>`;
const footer = () => `<p class="note" style="margin-top:40px">Prices: <a href="https://github.com/supermarkt/checkjebon" target="_blank" rel="noopener" style="text-decoration:underline">Checkjebon open data</a>, updated daily; online prices can differ in store. Deals checked every morning. Stores and map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="text-decoration:underline">OpenStreetMap</a>.</p>`;

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
    m.bindPopup(() => `<strong>${esc(s.name)}</strong><br>${s.address ? esc(s.address) + '<br>' : ''}${s.hours ? `<span class="muted">${esc(s.hours)}</span><br>` : ''}${km(distanceKm(state.here, s))} away`);
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
  state.you?.setLatLng([lat, lon]);
  render({ keepScroll: true });
}

// ---------- router ----------
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'home', arg: parts[1], q: params.get('q') || '' };
}

let lastRoute = '';
function render({ keepScroll = false } = {}) {
  const r = parse();
  const key = `${r.name}/${r.arg || ''}`;
  const html = r.name === 'search' ? viewSearch(r.q) : r.name === 'list' ? viewList() : r.name === 'map' ? viewMap() : r.name === 'chain' ? viewChain(r.arg, r.q) : viewHome();
  const host = $('#map-host');
  if (host.parentNode !== document.body) document.body.appendChild(host);
  view.innerHTML = html;
  if (key !== lastRoute) {
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    if (!keepScroll) window.scrollTo({ top: 0 });
  }
  lastRoute = key;
  if (r.name !== 'search' && document.activeElement !== $('#q')) $('#q').value = '';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (r.name === 'chain' ? 'home' : r.name)));
  mountMap();
}

function updateCounts() {
  document.querySelectorAll('[data-list-count]').forEach((el) => { el.textContent = state.list.length || ''; });
}

// ---------- events ----------
function wire() {
  window.addEventListener('hashchange', () => render());
  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = e.target.value.trim();
      const target = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
      if (location.hash !== target) history.replaceState(null, '', target);
      render({ keepScroll: parse().name === 'search' });
    }, 160);
  });
  $('#searchbox').addEventListener('submit', (e) => { e.preventDefault(); $('#q').blur(); });

  view.addEventListener('submit', (e) => {
    if (e.target.id === 'addform') {
      e.preventDefault();
      const v = $('#additem').value.trim();
      if (v) { state.list.push(v); saveList(); render({ keepScroll: true }); $('#additem').focus(); }
    } else if (e.target.dataset.chainSearch) {
      e.preventDefault();
      const q = e.target.q.value.trim();
      location.hash = `#/chain/${e.target.dataset.chainSearch}${q ? '?q=' + encodeURIComponent(q) : ''}`;
    }
  });
  let ct;
  view.addEventListener('input', (e) => {
    const form = e.target.closest('[data-chain-search]');
    if (!form) return;
    clearTimeout(ct);
    ct = setTimeout(() => {
      const r = parse();
      const q = e.target.value.trim();
      history.replaceState(null, '', `#/chain/${r.arg}${q ? '?q=' + encodeURIComponent(q) : ''}`);
      const tmp = document.createElement('div');
      tmp.innerHTML = viewChain(r.arg, q);
      $('#chain-products').innerHTML = $('#chain-products', tmp).innerHTML;
    }, 160);
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, [data-go]');
    if (!b) return;
    if (b.dataset.go) { location.hash = b.dataset.go; if (b.dataset.focusAfter) setTimeout(() => focusStore(b.dataset.focusAfter), 400); }
    else if (b.dataset.sort) { state.sortBy = b.dataset.sort; render({ keepScroll: true }); }
    else if (b.dataset.remove != null) { state.list.splice(Number(b.dataset.remove), 1); saveList(); render({ keepScroll: true }); }
    else if (b.dataset.add) { state.list.push(b.dataset.add); saveList(); render({ keepScroll: true }); }
    else if (b.dataset.focus) focusStore(b.dataset.focus);
    else if (b.hasAttribute('data-locate')) {
      if (!navigator.geolocation) return;
      b.lastChild.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(
        (p) => setHere(p.coords.latitude, p.coords.longitude, 'Your location'),
        () => { b.lastChild.textContent = state.here.label; },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
  });
}

async function main() {
  wire();
  updateCounts();
  render();
  loadOffers().then((o) => { state.offers = o; if (state.ready) render({ keepScroll: true }); });
  loadStores().then(({ stores }) => {
    state.stores = stores;
    if (stores.length) state.storeChains = new Set(stores.map((s) => s.chain));
    render({ keepScroll: true });
  });
  try {
    const { products, chainsWithData, logos } = await loadPrices();
    Object.assign(state, { products, chainsWithData, logos, ready: true });
    render({ keepScroll: true });
  } catch (err) {
    console.error(err);
    view.insertAdjacentHTML('afterbegin', '<div class="empty"><h3>Prices could not load</h3><p>Please try again in a moment.</p></div>');
  }
}

main();
