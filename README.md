# Prijsradar Amsterdam

Compare supermarket prices across Amsterdam and see how far the nearest store of each chain is.

Live site: https://nicklasdiener009-debug.github.io/prijsradar/

## What works now
- **Home**: supermarkets near you, then a section per supermarket with this week's deals (or everyday prices).
- **Supermarket pages** (`#/chain/ah`): store map and list, deals, and search within that supermarket.
- **Search** (`#/search?q=...`): search ~107,000 products from Albert Heijn, Jumbo, Lidl, Dirk, PLUS, SPAR, DekaMarkt, Hoogvliet and Vomar. Best match per chain, ranked by price per kg/l (or pack price), with links to the product page.
- **Shopping list**: add items and see the basket total per chain, plus how many items each chain has.
- **Distances**: every chain shows its nearest store. Distance is measured from Amsterdam Centraal, your GPS location, or any point you click on the map.
- **Map**: all supermarkets in Amsterdam from OpenStreetMap, coloured by chain.
- Chains with no store in Amsterdam are hidden automatically.

## Data sources
| What | Source | Freshness |
|---|---|---|
| Prices | [Checkjebon.nl open data](https://github.com/supermarkt/checkjebon) (MIT), loaded live; `data/prices-snapshot.json` is the offline fallback | Daily |
| Store locations, opening hours | OpenStreetMap via the Overpass API, cached in the browser for 7 days | Live |
| Map tiles | OpenStreetMap | Live |

Prices are online prices. Distances are straight-line.

## Deals (automatic)
`.github/workflows/update-data.yml` runs every morning at 06:15 Amsterdam time, which catches every chain's change day (AH and Lidl on Monday, Jumbo and Dirk on Wednesday). It runs `scripts/fetch-offers.mjs` and commits `data/offers.json`; the site reads that file.

It is built not to break:
- each chain is fetched on its own, so one failing never affects the others
- responses are read loosely, so small changes in the chains' apps don't stop it
- if a chain fails, its last good offers stay up until they expire, and the site says "showing last known deals"
- if every chain fails, the workflow opens a GitHub issue labelled `offers-broken`

Currently: Albert Heijn and Jumbo. Add a chain by adding an adapter to `ADAPTERS` in `scripts/fetch-offers.mjs`.

## Not yet included
- ALDI and Ekoplaza: no online prices in the dataset.
- Walking/cycling distance instead of straight-line (needs a routing service).

## Run it locally
No build step. From this folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages).

## Files
- `index.html`, `styles.css`: page and styling
- `src/data.js`: loads prices and stores, distance maths
- `src/search.js`: product matching and ranking
- `src/units.js`: parses pack sizes ("0,75 l", "6 x 33 cl") into price per kg/l/piece
- `src/chains.js`: chain names, colours and how they are recognised in OpenStreetMap
- `vendor/leaflet`: map library (BSD-2)
