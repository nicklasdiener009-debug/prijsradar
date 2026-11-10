// Supermarket chains: id matches the price dataset, `match` recognises the chain
// in OpenStreetMap brand/name tags.
export const CHAINS = {
  ah:        { name: 'Albert Heijn', short: 'AH', color: '#00a0e2', match: /albert\s*heijn|^ah\b|^ah to go/i },
  jumbo:     { name: 'Jumbo',        short: 'J', ink: '#000', color: '#f7c600', match: /jumbo/i },
  lidl:      { name: 'Lidl',         short: 'L', color: '#0050aa', match: /lidl/i },
  aldi:      { name: 'ALDI',         short: 'A', color: '#00205b', match: /aldi/i },
  dirk:      { name: 'Dirk',         short: 'D', color: '#e30613', match: /^dirk\b|dirk van den broek/i },
  vomar:     { name: 'Vomar',        short: 'V', color: '#e2001a', match: /vomar/i },
  plus:      { name: 'PLUS',         short: '+', color: '#5ba92d', match: /^plus\b/i },
  spar:      { name: 'SPAR',         short: 'S', color: '#008a4b', match: /spar\b/i },
  dekamarkt: { name: 'DekaMarkt',    short: 'D', color: '#d6001c', match: /deka/i },
  hoogvliet: { name: 'Hoogvliet',    short: 'H', color: '#00539f', match: /hoogvliet/i },
  ekoplaza:  { name: 'Ekoplaza',     short: 'E', color: '#7ab51d', match: /ekoplaza|foodmarqt/i },
  amazing:   { name: 'Amazing Oriental', short: 'AO', color: '#c8102e', match: /amazing oriental/i },
  wahnamhong:{ name: 'Wah Nam Hong', short: 'WN', color: '#b5121b', match: /wah nam hong/i },
  tanger:    { name: 'Tanger Markt', short: 'T', color: '#0b7a3e', match: /tanger\s*markt/i },
  genco:     { name: 'Genco',        short: 'G', color: '#1f5fa8', match: /genco/i },
};

export function chainForTags(tags = {}) {
  const label = [tags.brand, tags.name, tags.operator].filter(Boolean).join(' | ');
  for (const [id, c] of Object.entries(CHAINS)) {
    if (c.match.test(tags.brand || '') || c.match.test(tags.name || '')) return id;
  }
  return label ? 'other' : null;
}
