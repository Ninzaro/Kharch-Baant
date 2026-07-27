import { GoogleGenAI } from '@google/genai';
import { TAGS, Tag } from '../types';

/**
 * AI expense category suggestion (optional).
 *
 * Free setup (Google AI Studio free tier):
 *   1. Open https://aistudio.google.com/apikey
 *   2. Create an API key
 *   3. In .env.local set:
 *        VITE_GEMINI_API_KEY=your_key_here
 *        VITE_GEMINI_MODEL=gemini-2.0-flash   # optional; free default
 *   4. Restart `npm run dev`
 *
 * IMPORTANT: The key MUST be prefixed with VITE_ so Vite exposes it to the browser.
 * A bare GEMINI_API_KEY=… is only available in Node scripts, not in the React app.
 *
 * Security note: VITE_* keys are bundled into the client. For production, prefer a
 * Supabase Edge Function proxy so the key never ships to the browser.
 */

// Literal import.meta.env paths — required for Vite to inject values
const GEMINI_KEY =
  import.meta.env.VITE_GEMINI_API_KEY ||
  import.meta.env.GEMINI_API_KEY || // only works if also listed in envPrefix / define
  '';

/** Free-tier friendly default; override with VITE_GEMINI_MODEL */
const GEMINI_MODEL =
  import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash';

const ai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

if (import.meta.env.DEV && !GEMINI_KEY) {
  console.info(
    '[AI tags] No VITE_GEMINI_API_KEY set — category suggestions use keywords only. ' +
      'Get a free key at https://aistudio.google.com/apikey and add it to .env.local'
  );
}

export const isAiTaggingConfigured = (): boolean => Boolean(ai && GEMINI_KEY);

export const suggestTagForDescription = async (description: string): Promise<Tag | ''> => {
  if (!ai || !GEMINI_KEY) {
    return '';
  }

  const prompt = `You are an expert expense categorization assistant. Your task is to categorize a user's expense description into one of the following predefined categories. Respond with ONLY the category name.

Here are the categories and what they include:

- **Food**: Meals at restaurants, cafes, fast food, delivery services, bars, pubs.
  - Examples: "Lunch with coworkers", "Starbucks coffee", "Dinner at The Italian Place", "Late night pizza delivery".

- **Groceries**: Items purchased from a supermarket or grocery store for cooking at home.
  - Examples: "Weekly grocery shopping", "Milk and eggs", "Vegetables from the market".

- **Transport**: Daily commuting and local travel like cabs, ride-sharing, metro, bus.
  - Examples: "Uber to office", "Metro card recharge", "Bus ticket", "Taxi fare home".

- **Travel**: Expenses related to long-distance trips or vacations.
  - Examples: "Flight to New York", "Train tickets to Paris", "Vacation hotel booking", "Cross-country road trip gas".

- **Housing**: Rent, mortgage, and other home-related living expenses.
  - Examples: "Monthly rent", "Mortgage payment", "Home insurance", "Furniture for apartment".

- **Utilities**: Essential services for your home.
  - Examples: "Electricity bill", "Internet subscription", "Water bill", "Gas bill", "Phone bill".

- **Entertainment**: Activities for fun and leisure.
  - Examples: "Movie tickets", "Concert tickets", "Netflix subscription", "Bowling with friends", "Museum entry fee", "Spotify premium".

- **Shopping**: Personal items, clothing, electronics, gifts, home goods.
  - Examples: "New shoes from Nike", "Amazon purchase for a book", "Birthday gift for Mom", "New laptop".

- **Health**: Medical expenses, pharmacy, gym, wellness.
  - Examples: "Doctor's visit co-pay", "Prescription medicine", "Gym membership", "Vitamins and supplements".

- **Other**: For expenses that do not fit into any of the above categories.

Based on these definitions, categorize the following expense description:
"${description}"`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0,
      },
    });

    const suggestedTag = (response as any).text?.trim?.() || '';

    if (TAGS.includes(suggestedTag as Tag)) {
      return suggestedTag as Tag;
    }

    // Model sometimes returns extra punctuation / casing
    const normalized = TAGS.find((t) => t.toLowerCase() === suggestedTag.toLowerCase());
    if (normalized) return normalized;

    return 'Other';
  } catch (error) {
    console.error('[AI tags] Gemini request failed:', error);
    return '';
  }
};

export const getIconForCategory = (tag: Tag): string => {
  const icons: Record<Tag, string> = {
    Food: '🍔',
    Groceries: '🛒',
    Transport: '🚕',
    Travel: '✈️',
    Housing: '🏠',
    Utilities: '💡',
    Entertainment: '🎬',
    Shopping: '🛍️',
    Health: '💊',
    Other: '📝',
  };
  return icons[tag] || '📝';
};
