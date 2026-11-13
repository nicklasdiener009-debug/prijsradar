// The shopping list and favourites, kept in the browser.
// An item is { id, q, qty, done, pin? } where pin = { chain, link, name } is an exact product.

const LIST_KEY = 'ams-shopping-list-v2';
const OLD_LIST_KEY = 'ams-shopping-list-v1';
const FAV_KEY = 'ams-favourites-v1';

const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };
let seq = 0;
const newId = () => Date.now().toString(36) + (seq++).toString(36);

export function newItem(q, pin = null, qty = 1) {
  return { id: newId(), q: String(q).trim(), qty: Math.max(1, Math.min(99, qty | 0 || 1)), done: false, ...(pin ? { pin } : {}) };
}
export function readList() {
  const v2 = read(LIST_KEY);
  if (Array.isArray(v2)) return v2.filter((i) => i && i.q);
  const old = read(OLD_LIST_KEY); // first version: plain words
  return Array.isArray(old) ? old.filter((q) => typeof q === 'string' && q.trim()).map((q) => newItem(q)) : [];
}
export const saveList = (list) => write(LIST_KEY, list);
export const readFavs = () => { const f = read(FAV_KEY); return Array.isArray(f) ? f : []; };
export const saveFavs = (favs) => write(FAV_KEY, favs);

// ---------- sharing: the whole list fits in a link ----------
const toB64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function encodeShare(list) {
  return toB64(JSON.stringify(list.map((i) => (i.pin ? [i.q, i.qty, i.pin.chain, i.pin.link, i.pin.name] : [i.q, i.qty]))));
}
export function decodeShare(text) {
  try {
    const rows = JSON.parse(fromB64(text));
    if (!Array.isArray(rows)) return null;
    const items = rows.slice(0, 200).filter((r) => Array.isArray(r) && typeof r[0] === 'string' && r[0].trim())
      .map(([q, qty, chain, link, name]) => newItem(q.slice(0, 120), typeof chain === 'string' && typeof link === 'string' ? { chain, link, name: String(name || q).slice(0, 160) } : null, qty));
    return items.length ? items : null;
  } catch {
    return null;
  }
}
