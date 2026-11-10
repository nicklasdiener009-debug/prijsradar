// Parse a package size ("0,75 l", "Per 350 g", "500GR", "6 x 33 cl", "1.5 liter")
// into a base quantity so prices can be compared per kg, per litre or per piece.

const UNIT_MAP = {
  g: ['g', 1 / 1000], gr: ['g', 1 / 1000], gram: ['g', 1 / 1000], grams: ['g', 1 / 1000],
  kg: ['g', 1], kilo: ['g', 1], kilogram: ['g', 1],
  ml: ['l', 1 / 1000], milliliter: ['l', 1 / 1000],
  cl: ['l', 1 / 100], centiliter: ['l', 1 / 100],
  l: ['l', 1], lt: ['l', 1], liter: ['l', 1], litre: ['l', 1],
  st: ['st', 1], stuk: ['st', 1], stuks: ['st', 1], stk: ['st', 1], pieces: ['st', 1],
};

// unit key -> label of the base unit
export const BASE_LABEL = { g: 'kg', l: 'l', st: 'piece' };

const SIZE_RE = /(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kilogram|kilo|kg|gram|grams|gr|g|milliliter|ml|centiliter|cl|liter|litre|lt|l|stuks|stuk|stk|st|pieces)\b/i;

export function parseSize(text) {
  if (!text) return null;
  const m = String(text).toLowerCase().replace(/\)/g, ' ').match(SIZE_RE);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const amount = parseFloat(m[2].replace(',', '.'));
  const def = UNIT_MAP[m[3]];
  if (!def || !amount) return null;
  const qty = count * amount * def[1];
  if (!(qty > 0)) return null;
  return { unit: def[0], qty };
}

// Size comes from the dedicated field first, then from the product name.
export function unitPrice(product) {
  const size = parseSize(product.s) || parseSize(product.n);
  if (!size) return null;
  return { unit: size.unit, value: product.p / size.qty };
}
