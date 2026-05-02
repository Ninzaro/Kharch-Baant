import { Tag } from '../types';

/**
 * Flat keyword → Tag map.
 * Keys are lowercase single words. Adding entries requires no code change.
 */
export const KEYWORD_MAP: Record<string, Tag> = {
  // Food & drink
  beer: 'Food',       whisky: 'Food',      whiskey: 'Food',
  vodka: 'Food',      rum: 'Food',         wine: 'Food',
  coffee: 'Food',     chai: 'Food',        tea: 'Food',
  pizza: 'Food',      burger: 'Food',      biryani: 'Food',
  paneer: 'Food',     chicken: 'Food',     mutton: 'Food',
  dosa: 'Food',       idli: 'Food',        roti: 'Food',
  sushi: 'Food',      pasta: 'Food',       sandwich: 'Food',
  cafe: 'Food',       restaurant: 'Food',  zomato: 'Food',
  swiggy: 'Food',     mcdonalds: 'Food',   kfc: 'Food',
  starbucks: 'Food',  dominos: 'Food',     dunkin: 'Food',
  bbq: 'Food',        shawarma: 'Food',    momos: 'Food',
  noodles: 'Food',    rice: 'Food',        dal: 'Food',
  lunch: 'Food',      dinner: 'Food',      breakfast: 'Food',
  snacks: 'Food',     dessert: 'Food',     icecream: 'Food',
  juice: 'Food',      smoothie: 'Food',    milkshake: 'Food',

  // Groceries
  grocery: 'Groceries',    groceries: 'Groceries',
  supermarket: 'Groceries', vegetables: 'Groceries',
  fruits: 'Groceries',     milk: 'Groceries',      eggs: 'Groceries',
  blinkit: 'Groceries',    bigbasket: 'Groceries',  zepto: 'Groceries',
  dmart: 'Groceries',      reliance: 'Groceries',   jiomart: 'Groceries',
  provisions: 'Groceries', ration: 'Groceries',

  // Transport
  uber: 'Transport',    ola: 'Transport',      rapido: 'Transport',
  taxi: 'Transport',    auto: 'Transport',     metro: 'Transport',
  bus: 'Transport',     cab: 'Transport',      rickshaw: 'Transport',
  parking: 'Transport', toll: 'Transport',     petrol: 'Transport',
  diesel: 'Transport',  fuel: 'Transport',     commute: 'Transport',
  ferry: 'Transport',   tram: 'Transport',

  // Travel
  flight: 'Travel',     flights: 'Travel',     airline: 'Travel',
  hotel: 'Travel',      hostel: 'Travel',      airbnb: 'Travel',
  train: 'Travel',      irctc: 'Travel',       makemytrip: 'Travel',
  goibibo: 'Travel',    visa: 'Travel',        resort: 'Travel',
  tour: 'Travel',       tourism: 'Travel',     vacation: 'Travel',
  trip: 'Travel',       luggage: 'Travel',     passport: 'Travel',

  // Housing
  rent: 'Housing',      maintenance: 'Housing', mortgage: 'Housing',
  furniture: 'Housing', repair: 'Housing',      landlord: 'Housing',
  deposit: 'Housing',   society: 'Housing',     renovation: 'Housing',

  // Utilities
  electricity: 'Utilities', internet: 'Utilities', wifi: 'Utilities',
  water: 'Utilities',       gas: 'Utilities',      recharge: 'Utilities',
  postpaid: 'Utilities',    broadband: 'Utilities', dth: 'Utilities',
  subscription: 'Utilities',

  // Entertainment
  movie: 'Entertainment',   movies: 'Entertainment',
  netflix: 'Entertainment', spotify: 'Entertainment',
  concert: 'Entertainment', tickets: 'Entertainment',
  hotstar: 'Entertainment', prime: 'Entertainment',
  gaming: 'Entertainment',  game: 'Entertainment',
  bookmyshow: 'Entertainment', theatre: 'Entertainment',
  bowling: 'Entertainment', museum: 'Entertainment',
  zoo: 'Entertainment',     amusement: 'Entertainment',

  // Shopping
  amazon: 'Shopping',   flipkart: 'Shopping',  myntra: 'Shopping',
  clothes: 'Shopping',  shoes: 'Shopping',     shirt: 'Shopping',
  laptop: 'Shopping',   phone: 'Shopping',     electronics: 'Shopping',
  gift: 'Shopping',     meesho: 'Shopping',    ajio: 'Shopping',
  jeans: 'Shopping',    dress: 'Shopping',     watch: 'Shopping',
  jewellery: 'Shopping', jewelry: 'Shopping',

  // Health
  doctor: 'Health',   medicine: 'Health',   pharmacy: 'Health',
  hospital: 'Health', gym: 'Health',        yoga: 'Health',
  dental: 'Health',   clinic: 'Health',     medplus: 'Health',
  apollo: 'Health',   vitamins: 'Health',   therapy: 'Health',
  physiotherapy: 'Health', chemist: 'Health',
};

/**
 * Returns the first Tag matched by any word in the description, or null.
 * Input must already be lowercased.
 */
export const matchKeyword = (normalizedDescription: string): Tag | null => {
  const words = normalizedDescription.split(/\s+/);
  for (const word of words) {
    const tag = KEYWORD_MAP[word];
    if (tag) return tag;
  }
  return null;
};
