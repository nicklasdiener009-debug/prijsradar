// Product pictures: a real photo when we have one (data/images.json), otherwise a
// product-type picture picked from the name, so no product is ever without one.

let index = null;

export async function loadImages() {
  try {
    const r = await fetch('data/images.json', { cache: 'force-cache' });
    if (r.ok) index = await r.json();
  } catch { /* photos are optional */ }
  return index;
}

export function photoFor(chain, link) {
  const v = index?.img?.[`${chain}|${link}`];
  if (!v) return null;
  const prefix = index.prefixes?.[v[0]];
  if (!prefix) return null;
  let url = prefix + v.slice(1);
  // AH images come in several renditions; ask for a small one.
  if (v[0] === 'a') url = url.replace(/rendition=[^&]+/, 'rendition=200x200_JPG_Q85');
  if (v[0] === 'd' || v[0] === 'k') url += '?width=400'; // Dirk and DekaMarkt resize on request
  return url;
}

// [pattern, emoji, background tint]
const TYPES = [
  [/koffie/, '☕', '#efe7df'],
  [/pindakaas|pinda|notenpasta/, '🥜', '#f6ead9'],
  [/hagelslag|chocopasta|nutella|hazelnootpasta|jam\b|confiture|honing|stroop/, '🍯', '#fbefd9'],
  [/kaasstengel|kaaskoek/, '🥨', '#fbf0dc'],
  [/chocolademelk|chocomel/, '🍫', '#f6e9e1'],
  [/melk|karnemelk|chocomel|zuivel|yoghurt|kwark|vla|room\b|slagroom|skyr/, '🥛', '#e8f1fb'],
  [/kaas|brie|mozzarella|parmezaan|feta|camembert|geitenkaas/, '🧀', '#fff4d6'],
  [/\bei\b|eieren|scharrel/, '🥚', '#fdf3e3'],
  [/boter|margarine|halvarine/, '🧈', '#fff6db'],
  [/brood|bolletje|bollen|stokbrood|croissant|beschuit|crackers|toast|wrap|pistolet|baguette/, '🍞', '#f8eddf'],
  [/banaan|bananen/, '🍌', '#fff7d1'],
  [/appel(?!moes|taart|sap)|appels/, '🍎', '#fde8e8'],
  [/peer|peren/, '🍐', '#eef6dd'],
  [/sinaasappel|mandarijn|clementine|citroen|limoen/, '🍊', '#fff0dc'],
  [/druif|druiven/, '🍇', '#f1e8f8'],
  [/aardbei|framboos|bessen|blauwe bes|kers/, '🍓', '#fde8ec'],
  [/ananas|mango|kiwi|meloen|watermeloen|avocado/, '🥭', '#fff3d9'],
  [/tomaat|tomaten/, '🍅', '#fde6e3'],
  [/komkommer|courgette|sla\b|spinazie|broccoli|boerenkool|andijvie|prei|kool|groente|paprika|wortel|ui\b|uien|knoflook|champignon|aubergine|bloemkool|snackgroente|bonen|erwten/, '🥦', '#e7f5e9'],
  [/aardappel|friet|patat|puree|krieltjes/, '🥔', '#f6eedf'],
  [/pasta|spaghetti|macaroni|penne|fusilli|lasagne|tagliatelle|noedels|mie/, '🍝', '#fbf0de'],
  [/rijst|couscous|quinoa/, '🍚', '#f4f4f0'],
  [/pizza/, '🍕', '#fdeede'],
  [/kip|kipfilet|kippen|drumstick/, '🍗', '#fbefe2'],
  [/gehakt|biefstuk|rund|varken|hamburger|worst|rookworst|spek|ham\b|vlees|schnitzel|filet americain|salami|bacon/, '🥩', '#fbe7e4'],
  [/vis|zalm|tonijn|kabeljauw|garnalen|haring|makreel|pangasius|sushi/, '🐟', '#e4f1f8'],
  [/koffie|espresso|cappuccino/, '☕', '#efe7df'],
  [/thee\b|thee |rooibos/, '🍵', '#eaf4e6'],
  [/bier|pils|heineken|grolsch|hertog jan|amstel|radler/, '🍺', '#fff2d3'],
  [/wijn|rose|cava|prosecco|champagne/, '🍷', '#f7e4ea'],
  [/water|spa\b|sourcy|bronwater/, '💧', '#e5f2fb'],
  [/sap|juice|smoothie|limonade|siroop|cola|fanta|sprite|frisdrank|ice tea|energy|red bull|7up/, '🧃', '#fff0e0'],
  [/chips|nootjes|pinda|noten|borrel|popcorn|zoutjes|tortilla/, '🥨', '#fbf0dc'],
  [/chocola|reep|snoep|drop|winegum|koek|koekjes|biscuit|taart|gebak|wafel|stroopwafel|muffin|cake|ijs\b|ijsjes|magnum|hagelslag|pindakaas|jam|nutella|hazelnootpasta|honing|stroop/, '🍫', '#f6e9e1'],
  [/ontbijtgranen|cruesli|muesli|havermout|cornflakes|granola/, '🥣', '#f8f0e2'],
  [/saus|ketchup|mayonaise|mosterd|dressing|olie|azijn|kruiden|peper|zout|bouillon|soep/, '🥫', '#fbebe2'],
  [/baby|luier|pampers|zuigeling/, '🍼', '#eef3fb'],
  [/hond|kat|dieren|whiskas|pedigree|felix|sheba/, '🐾', '#f2eee8'],
  [/shampoo|douche|zeep|tandpasta|deodorant|scheer|verzorging|crème|creme|lotion|tandenborstel|maandverband/, '🧴', '#eef1f8'],
  [/wasmiddel|afwas|vaatwas|schoonmaak|toiletpapier|keukenpapier|allesreiniger|wc |bleek|wasverzachter|vuilniszak|tissues/, '🧽', '#eaf3f5'],
  [/bloem|plant|tulp|rozen|boeket/, '💐', '#f9e8ef'],
  [/diepvries|bevroren/, '🧊', '#e7f3fa'],
];

export function typeFor(name) {
  const n = String(name || '').toLowerCase();
  for (const [re, emoji, bg] of TYPES) if (re.test(n)) return { emoji, bg };
  return { emoji: '🛒', bg: '#eef0f3' };
}

// HTML for a picture box. `cls` sizes it via CSS.
export function pictureHtml({ chain, link, name, image }, cls = '') {
  const src = image || photoFor(chain, link);
  const t = typeFor(name);
  const fallback = `<span class="pic-type" style="background:${t.bg}">${t.emoji}</span>`;
  if (!src) return `<span class="pic ${cls}">${fallback}</span>`;
  return `<span class="pic ${cls}"><img src="${src.replace(/"/g, '&quot;')}" alt="" loading="lazy" onerror="this.remove()">${fallback}</span>`;
}

// Product groups for the search filters (English names; translated in i18n.js).
const GROUPS = {
  '🥜': 'Nuts and spreads', '🍯': 'Nuts and spreads', '🥨': 'Snacks', '🍫': 'Sweets and biscuits', '🥛': 'Dairy', '🧀': 'Cheese',
  '🥚': 'Eggs', '🧈': 'Dairy', '🍞': 'Bread', '🍌': 'Fruit', '🍎': 'Fruit', '🍐': 'Fruit', '🍊': 'Fruit', '🍇': 'Fruit', '🍓': 'Fruit', '🥭': 'Fruit',
  '🍅': 'Vegetables', '🥦': 'Vegetables', '🥔': 'Vegetables', '🍝': 'Pasta and rice', '🍚': 'Pasta and rice', '🍕': 'Pizza', '🍗': 'Meat and chicken',
  '🥩': 'Meat and chicken', '🐟': 'Fish', '☕': 'Coffee and tea', '🍵': 'Coffee and tea', '🍺': 'Beer and wine', '🍷': 'Beer and wine', '💧': 'Drinks',
  '🧃': 'Drinks', '🥣': 'Cereal', '🥫': 'Sauces and soup', '🍼': 'Baby', '🐾': 'Pets', '🧴': 'Personal care', '🧽': 'Household', '💐': 'Flowers', '🧊': 'Frozen',
};
export function groupFor(product) {
  product.group ??= GROUPS[typeFor(product.name).emoji] || 'Other';
  return product.group;
}
export const isOrganic = (product) => /\b(bio|biologisch|biologische|organic|eko|demeter)\b/i.test(product.name);
