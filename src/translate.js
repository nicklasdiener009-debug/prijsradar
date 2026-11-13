// English grocery words -> the Dutch words the supermarkets use, so that
// "milk" finds melk and "peanut butter" finds pindakaas. Longer phrases win.
const PHRASES = {
  'peanut butter': 'pindakaas', 'semi skimmed milk': 'halfvolle melk', 'skimmed milk': 'magere milk', 'whole milk': 'volle melk', 'full fat milk': 'volle melk',
  'oat milk': 'haverdrink', 'soy milk': 'sojadrink', 'almond milk': 'amandeldrink', 'chocolate milk': 'chocolademelk', 'buttermilk': 'karnemelk',
  'whipped cream': 'slagroom', 'whipping cream': 'slagroom', 'sour cream': 'zure room', 'cream cheese': 'roomkaas', 'cottage cheese': 'huttenkase', 'goat cheese': 'geitenkaas',
  'young cheese': 'jonge kaas', 'old cheese': 'oude kaas', 'mature cheese': 'belegen kaas', 'grated cheese': 'geraspte kaas', 'sliced cheese': 'kaas plakken',
  'olive oil': 'olijfolie', 'sunflower oil': 'zonnebloemolie', 'coconut milk': 'kokosmelk', 'coconut oil': 'kokosolie',
  'toilet paper': 'toiletpapier', 'toilet roll': 'toiletpapier', 'kitchen roll': 'keukenpapier', 'kitchen paper': 'keukenpapier', 'paper towels': 'keukenpapier',
  'washing up liquid': 'afwasmiddel', 'dish soap': 'afwasmiddel', 'dishwasher tablets': 'vaatwastabletten', 'laundry detergent': 'wasmiddel', 'washing powder': 'waspoeder',
  'fabric softener': 'wasverzachter', 'bin bags': 'vuilniszakken', 'trash bags': 'vuilniszakken', 'garbage bags': 'vuilniszakken', 'all purpose cleaner': 'allesreiniger',
  'shower gel': 'douchegel', 'body wash': 'douchegel', 'hand soap': 'handzeep', 'toothpaste': 'tandpasta', 'toothbrush': 'tandenborstel', 'sanitary pads': 'maandverband',
  'whole wheat bread': 'volkoren brood', 'wholemeal bread': 'volkoren brood', 'brown bread': 'bruin brood', 'white bread': 'wit brood', 'sourdough bread': 'desem brood',
  'bread rolls': 'broodjes', 'french fries': 'friet', 'sweet potato': 'zoete aardappel', 'sweet potatoes': 'zoete aardappel', 'mashed potatoes': 'aardappelpuree',
  'bell pepper': 'paprika', 'bell peppers': 'paprika', 'green beans': 'sperziebonen', 'kidney beans': 'kidneybonen', 'baked beans': 'witte bonen tomatensaus',
  'brown beans': 'bruine bonen', 'chick peas': 'kikkererwten', 'spring onion': 'bosui', 'spring onions': 'bosui', 'red onion': 'rode ui', 'red cabbage': 'rode kool',
  'brussels sprouts': 'spruitjes', 'bean sprouts': 'taugé', 'sweet corn': 'mais', 'cherry tomatoes': 'cherrytomaten', 'tomato sauce': 'tomatensaus', 'tomato paste': 'tomatenpuree',
  'tomato puree': 'tomatenpuree', 'tomato soup': 'tomatensoep', 'chicken soup': 'kippensoep', 'chicken breast': 'kipfilet', 'chicken fillet': 'kipfilet',
  'chicken thighs': 'kipdijfilet', 'chicken thigh': 'kipdijfilet', 'chicken wings': 'kipvleugels', 'chicken legs': 'kippenbouten', 'minced meat': 'gehakt', 'ground beef': 'rundergehakt',
  'minced beef': 'rundergehakt', 'pork chop': 'karbonade', 'pork chops': 'karbonade', 'smoked sausage': 'rookworst', 'smoked salmon': 'gerookte zalm', 'fish fingers': 'vissticks',
  'orange juice': 'sinaasappelsap', 'apple juice': 'appelsap', 'apple sauce': 'appelmoes', 'applesauce': 'appelmoes', 'sparkling water': 'bruisend water', 'still water': 'bronwater',
  'mineral water': 'mineraalwater', 'iced tea': 'ice tea', 'soft drink': 'frisdrank', 'energy drink': 'energy drink', 'red wine': 'rode wijn', 'white wine': 'witte wijn',
  'coffee beans': 'koffiebonen', 'ground coffee': 'filterkoffie', 'coffee pads': 'koffiepads', 'coffee capsules': 'koffiecups', 'coffee cups': 'koffiecups', 'green tea': 'groene thee',
  'chocolate sprinkles': 'hagelslag', 'sprinkles': 'hagelslag', 'chocolate spread': 'chocoladepasta', 'chocolate bar': 'chocolade reep', 'dark chocolate': 'pure chocolade',
  'milk chocolate': 'melkchocolade', 'ice cream': 'ijs', 'whole grain': 'volkoren', 'self raising flour': 'zelfrijzend bakmeel', 'baking powder': 'bakpoeder',
  'icing sugar': 'poedersuiker', 'powdered sugar': 'poedersuiker', 'brown sugar': 'basterdsuiker', 'cane sugar': 'rietsuiker', 'maple syrup': 'ahornsiroop',
  'soy sauce': 'sojasaus', 'curry paste': 'currypasta', 'stock cubes': 'bouillonblokjes', 'stock cube': 'bouillonblokjes', 'garlic sauce': 'knoflooksaus', 'peanut sauce': 'satesaus',
  'potato chips': 'chips', 'crisps': 'chips', 'rice cakes': 'rijstwafels', 'mixed nuts': 'gemengde noten', 'dog food': 'hondenvoer', 'cat food': 'kattenvoer', 'cat litter': 'kattenbakvulling',
  'baby food': 'babyvoeding', 'baby wipes': 'billendoekjes', 'frozen pizza': 'diepvries pizza', 'frozen vegetables': 'diepvries groente', 'free range eggs': 'vrije uitloop eieren',
  'organic eggs': 'biologische eieren', 'oat flakes': 'havermout', 'rolled oats': 'havermout', 'spaghetti sauce': 'pastasaus', 'pasta sauce': 'pastasaus', 'egg noodles': 'eiermie',
  'lunch meat': 'vleeswaren', 'cold cuts': 'vleeswaren', 'pine nuts': 'pijnboompitten', 'sunflower seeds': 'zonnebloempitten', 'pumpkin seeds': 'pompoenpitten',
};
const WORDS = {
  milk: 'melk', eggs: 'eieren', egg: 'ei', bread: 'brood', butter: 'boter', cheese: 'kaas', yoghurt: 'yoghurt', yogurt: 'yoghurt', cream: 'room', custard: 'vla', quark: 'kwark',
  apple: 'appel', apples: 'appels', banana: 'banaan', bananas: 'bananen', orange: 'sinaasappel', oranges: 'sinaasappels', lemon: 'citroen', lemons: 'citroenen', lime: 'limoen',
  pear: 'peer', pears: 'peren', grapes: 'druiven', grape: 'druiven', strawberries: 'aardbeien', strawberry: 'aardbei', raspberries: 'frambozen', blueberries: 'blauwe bessen',
  cherries: 'kersen', pineapple: 'ananas', peach: 'perzik', peaches: 'perziken', plum: 'pruim', plums: 'pruimen', tangerines: 'mandarijnen', mandarins: 'mandarijnen', fruit: 'fruit',
  potato: 'aardappel', potatoes: 'aardappelen', tomato: 'tomaat', tomatoes: 'tomaten', cucumber: 'komkommer', lettuce: 'sla', spinach: 'spinazie', carrot: 'wortel', carrots: 'wortelen',
  onion: 'ui', onions: 'uien', garlic: 'knoflook', mushrooms: 'champignons', mushroom: 'champignons', zucchini: 'courgette', eggplant: 'aubergine', cauliflower: 'bloemkool',
  cabbage: 'kool', kale: 'boerenkool', leek: 'prei', leeks: 'prei', peas: 'erwten', beans: 'bonen', lentils: 'linzen', chickpeas: 'kikkererwten', corn: 'mais', pumpkin: 'pompoen',
  beetroot: 'bieten', beets: 'bieten', celery: 'bleekselderij', ginger: 'gember', parsley: 'peterselie', basil: 'basilicum', chives: 'bieslook', coriander: 'koriander', cilantro: 'koriander',
  vegetables: 'groente', veggies: 'groente', salad: 'salade', herbs: 'kruiden', spices: 'kruiden',
  chicken: 'kip', beef: 'rundvlees', pork: 'varkensvlees', meat: 'vlees', mince: 'gehakt', sausage: 'worst', sausages: 'worstjes', bacon: 'bacon', ham: 'ham', steak: 'biefstuk',
  turkey: 'kalkoen', lamb: 'lamsvlees', meatballs: 'gehaktballen', burger: 'hamburger', burgers: 'hamburgers', fish: 'vis', salmon: 'zalm', tuna: 'tonijn', cod: 'kabeljauw',
  shrimp: 'garnalen', shrimps: 'garnalen', prawns: 'garnalen', herring: 'haring', mackerel: 'makreel', mussels: 'mosselen',
  rice: 'rijst', noodles: 'noedels', flour: 'bloem', sugar: 'suiker', salt: 'zout', pepper: 'peper', oil: 'olie', vinegar: 'azijn', mustard: 'mosterd', mayonnaise: 'mayonaise',
  mayo: 'mayonaise', sauce: 'saus', soup: 'soep', stock: 'bouillon', broth: 'bouillon', honey: 'honing', jam: 'jam', syrup: 'stroop', cereal: 'ontbijtgranen', oats: 'havermout',
  oatmeal: 'havermout', porridge: 'havermout', pancakes: 'pannenkoeken', waffles: 'wafels', yeast: 'gist', breadcrumbs: 'paneermeel', cinnamon: 'kaneel', nutmeg: 'nootmuskaat',
  water: 'water', juice: 'sap', beer: 'bier', wine: 'wijn', coffee: 'koffie', tea: 'thee', lemonade: 'limonade', squash: 'siroop',
  cookies: 'koekjes', biscuits: 'koekjes', cookie: 'koek', cake: 'cake', pie: 'taart', chocolate: 'chocolade', candy: 'snoep', sweets: 'snoep', licorice: 'drop', liquorice: 'drop',
  gum: 'kauwgom', nuts: 'noten', peanuts: 'pinda', almonds: 'amandelen', walnuts: 'walnoten', cashews: 'cashewnoten', hazelnuts: 'hazelnoten', raisins: 'rozijnen', dates: 'dadels',
  crackers: 'crackers', rusk: 'beschuit', rusks: 'beschuit', gingerbread: 'ontbijtkoek',
  soap: 'zeep', shampoo: 'shampoo', conditioner: 'conditioner', deodorant: 'deodorant', razor: 'scheermesjes', razors: 'scheermesjes', tissues: 'tissues', diapers: 'luiers',
  nappies: 'luiers', tampons: 'tampons', sunscreen: 'zonnebrand', detergent: 'wasmiddel', bleach: 'bleek', sponge: 'spons', sponges: 'sponzen', candles: 'kaarsen', batteries: 'batterijen',
  flowers: 'bloemen', frozen: 'diepvries', organic: 'biologisch', vegetarian: 'vegetarisch', vegan: 'vegan', fresh: 'vers', smoked: 'gerookt', sliced: 'plakken', grated: 'geraspt',
  unsalted: 'ongezouten', salted: 'gezouten', sparkling: 'bruisend', wholemeal: 'volkoren', skimmed: 'magere', lactosefree: 'lactosevrij', glutenfree: 'glutenvrij', sugarfree: 'suikervrij',
  red: 'rode', white: 'witte', green: 'groene', black: 'zwarte', brown: 'bruine', sweet: 'zoete', small: 'kleine', large: 'grote', dried: 'gedroogde',
  strawberryjam: 'aardbeienjam', tofu: 'tofu', hummus: 'hummus', wraps: 'wraps', tortillas: 'tortilla', lasagna: 'lasagne', lasagne: 'lasagne',
};
// Colour and size words only count as English next to another English word ("red wine"), never on their own.
const WEAK = new Set(['red', 'white', 'green', 'black', 'brown', 'sweet', 'small', 'large', 'dried', 'fresh', 'frozen', 'sliced', 'ham', 'water', 'fruit', 'bacon', 'cake', 'jam', 'shampoo', 'deodorant', 'tissues', 'crackers', 'tofu', 'hummus', 'wraps', 'lasagne', 'conditioner', 'tampons', 'vegan', 'yoghurt']);
PHRASES['skimmed milk'] = 'magere melk';

const clean = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const cache = new Map();

// -> the Dutch query, or null when the text does not look like English groceries.
export function translate(query) {
  const q = clean(query);
  if (cache.has(q)) return cache.get(q);
  const words = q.split(' ').filter(Boolean);
  const out = [];
  let strong = 0;
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (let n = Math.min(4, words.length - i); n >= 2 && !hit; n--) {
      const p = PHRASES[words.slice(i, i + n).join(' ')];
      if (p) hit = [p, n];
    }
    if (hit) { out.push(hit[0]); i += hit[1]; strong++; continue; }
    const w = words[i];
    if (WORDS[w] && WORDS[w] !== w) { out.push(WORDS[w]); if (!WEAK.has(w)) strong++; } else out.push(w);
    i++;
  }
  const result = strong ? out.join(' ') : null;
  cache.set(q, result && result !== q ? result : null);
  return cache.get(q);
}
