<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Kharch-Baant - Shared Expense Tracker (Supabase Native)

An elegant web application to manage and track shared expenses among friends. Now fully migrated to a **Supabase-only** backend for real persistence (the earlier mock/in-memory mode has been removed). Features a summary dashboard, transaction management with multiple split strategies, filtering, AI-powered expense categorization, and shareable summaries.

View your app in AI Studio: https://ai.studio/apps/drive/17MEhBNlszqSmbTAXpvoADC2WSNUXSTu2

## Features

- 🏠 **Dashboard Overview** - See all your groups and overall financial summary
- 👥 **Group Management** - Create and manage expense groups with multiple members
- 💰 **Smart Expense Tracking** - Add transactions with multiple split modes (equal, unequal, percentage, shares)
- 🧠 **AI-Powered Categorization** - Automatic expense category suggestions using Google Gemini AI
- 🎯 **Advanced Filtering** - Filter by category, date range, and search through descriptions
- 📊 **Real-time Balance Calculation** - See who owes what instantly
- 💳 **Payment Source Tracking** - Track different payment methods (cards, UPI, cash)
- 📱 **Responsive Design** - Works perfectly on mobile and desktop
- 📱 **Native Android App** - Full-featured Android app via Capacitor
- 🎨 **Modern UI** - Beautiful glassmorphic design with dark theme
- 📤 **Share Functionality** - Generate and share expense summaries as images

## Backend Architecture

The application uses **only Supabase** (PostgreSQL + Row Level Security) for data. All former mock data arrays have been removed; seed data is applied directly through SQL or an optional seed script.

## Quick Start

**Prerequisites:**
- Node.js 18+
- A Supabase project (free tier is fine)
- (Optional) Gemini API key for AI tag suggestions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create `.env.local`:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
   # Brevo / Gemini are Edge secrets (BREVO_API_KEY, BREVO_SENDER_EMAIL, GEMINI_API_KEY) — never VITE_*
   ```

3. **Run the app:**
   ```bash
   npm run dev
   ```

The app will be available at `http://localhost:3000`

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL editor and run the contents of `supabase-schema.sql`.
3. Populate initial sample data (already included at bottom of the schema file) OR run the seed script (see below).
4. Set the environment variables (see above) and start the dev server.

### Seeding (Optional Refresh)
If you want to re-seed (e.g., after clearing tables):
```bash
npm run seed:schema   # re-applies schema (DESCTRUCTIVE if you edited tables)
```
Or manually run selected INSERT statements from `supabase-schema.sql`.

## API Layer

All service calls (groups, transactions, people, payment sources) route directly to Supabase via a thin façade in `services/apiService.ts`. The older dynamic mock/supabase switching was removed to avoid ambiguity. Each call returns strongly typed entities.

Example:
```ts
import * as api from './services/apiService';

const groups = await api.getGroups();
const created = await api.addGroup({
   name: 'Trip 2025',
   members: [...],
   currency: 'INR',
   groupType: 'trip',
   tripStartDate: '2025-01-10',
   tripEndDate: '2025-01-15'
});
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **Styling:** Tailwind CSS (via CDN)
- **Backend:** Supabase (PostgreSQL)
- **AI:** Google Gemini AI for expense categorization
- **Icons:** Custom SVG icon set
- **Images:** HTML2Canvas for sharing functionality

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run seed:schema` - (Re)apply schema & sample data to Supabase (requires psql + env vars)

## Android App

The app is available as a native Android app built with Capacitor. See [ANDROID_SETUP.md](./ANDROID_SETUP.md) for detailed setup instructions.

**Quick Start:**
```bash
npm run android:sync    # Build and sync to Android
npm run android:open    # Open in Android Studio
npm run android:run     # Build and run on device
```

For more details, see:
- [ANDROID_SETUP.md](./ANDROID_SETUP.md) - Complete Android setup guide
- [ANDROID_QUICKSTART.md](./ANDROID_QUICKSTART.md) - Quick reference

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test against Supabase
5. Submit a pull request

## License

MIT License - see LICENSE file for details
# kharcha-Baant
