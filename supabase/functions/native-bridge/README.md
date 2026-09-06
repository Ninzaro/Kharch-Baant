# native-bridge

Exchanges a verified **native Clerk session JWT** for a one-time Clerk **Sign-in Token**.

Used only by the Capacitor Android app after `clerk-android` sign-in.

## Auth

`Authorization: Bearer <native Clerk session token>`

The function calls Clerk `authenticateRequest()` and derives `userId` only from that result. Client-supplied user ids, emails, session ids, and Google claims are ignored.

## Response

```json
{ "ticket": "<one-time sign-in token>" }
```

TTL: 60 seconds. The WebView redeems it with `@clerk/clerk-react` `signIn.create({ strategy: 'ticket', ticket })`.

## Secrets

```bash
supabase secrets set CLERK_SECRET_KEY=sk_live_... CLERK_PUBLISHABLE_KEY=pk_live_...
supabase secrets set ALLOWED_ORIGINS=https://www.motamaati.in,https://motamaati.in
supabase functions deploy native-bridge
```

Never put `CLERK_SECRET_KEY` in `VITE_*` or the Android / web bundle.
