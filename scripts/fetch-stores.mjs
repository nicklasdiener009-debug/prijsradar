#!/usr/bin/env node
// Saves all Amsterdam supermarkets from OpenStreetMap to data/stores-snapshot.json.
// The site asks OpenStreetMap live; this file is the fallback if that is slow or down.
import { writeFile } from 'node:fs/promises';

const [s, w, n, e] = [52.278, 4.728, 52.431, 5.079];
const query = `[out:json][timeout:90];(node["shop"="supermarket"](${s},${w},${n},${e});way["shop"="supermarket"](${s},${w},${n},${e}););out center tags;`;
const urls = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

for (const url of urls) {
  try {
    const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'prijsradar-amsterdam/1.0' } });
    if (!r.ok) throw new Error(String(r.status));
    const json = await r.json();
    if ((json.elements || []).length < 50) throw new Error('too few stores: ' + (json.elements || []).length);
    await writeFile(new URL('../data/stores-snapshot.json', import.meta.url), JSON.stringify({ elements: json.elements }));
    console.log(`${json.elements.length} stores saved`);
    process.exit(0);
  } catch (err) {
    console.error(url, 'failed:', err.message);
  }
}
console.error('Store snapshot not updated; keeping the previous one.');
