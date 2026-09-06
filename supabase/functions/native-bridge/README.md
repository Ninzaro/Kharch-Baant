# native-bridge

Exchanges a verified **native Clerk session JWT** for a one-time Clerk **Sign-in Token**.

Used only by the Capacitor Android app after `clerk-android` sign-in.

## Auth

`Authorization: Bearer <native Clerk session token>`

The function calls Clerk `verifyToken()` on the Bearer session JWT and derives `userId` only from `sub`. Do not use `authenticateRequest()` here: that helper is for browser cookie handshake and returns signed-out for Capacitor WebView `fetch()` to supabase.co. Client-supplied user ids, emails, session ids, and Google claims are ignored.

## Response

```json
{ "ticket": "<one-time sign-in token>" }
```

TTL: 60 seconds. The WebView redeems it with `@clerk/clerk-react` `signIn.create({ strategy: 'ticket', ticket })`.

## Secrets

```bash
supabase secrets set CLERK_SECRET_KEY=sk_live_... CLERK_PUBLISHABLE_KEY=pk_live_...
supabase secrets set ALLOWED_ORIGINS=https://www.motamaati.in,https://motamaati.in
supabase functions deploy native-bridge --no-verify-jwt
```

`verify_jwt` must stay **false**. The gateway JWT check runs before the function: OPTIONS preflight has no Clerk Bearer, and POST uses a **native Clerk** session JWT (not a Supabase anon JWT). That 401 is what the browser reports as CORS.

Capacitor Origin is `https://www.motamaati.in`. OPTIONS returns 204 with:

- `Access-Control-Allow-Origin: https://www.motamaati.in` (echoed when Origin matches)
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`

Never put `CLERK_SECRET_KEY` in `VITE_*` or the Android / web bundle.
