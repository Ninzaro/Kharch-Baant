# Native Android Google auth — what broke and how we fixed it

**Date:** 2026-09-06  
**Status:** Working on device (Samsung SM-S918B, Android 16)  
**Scope:** Capacitor Android Google sign-in for Kharch-Baant (`com.kharchbaant.app`). Clerk stays the only IdP. Web / desktop / iPhone are unchanged (`@clerk/clerk-react` `<SignIn />`).

---

## The product constraint

We need **Google on Android** without:

- putting Google hosts in Capacitor `allowNavigation`
- doing Google OAuth inside the WebView
- switching away from Clerk
- replacing email/password `<SignIn />`
- sharing a Chrome/Account Portal session with the WebView Clerk client (that is not supported)

---

## Root cause (the one that looked like “login never works”)

Clerk **sessions belong to the Client that created them**.

| Client | Where it lives |
|---|---|
| WebView `clerk-js` / `@clerk/clerk-react` | Capacitor WebView, origin `https://www.motamaati.in` |
| Chrome Custom Tabs / Account Portal | Chrome, cookies on `accounts.motamaati.in` / `clerk.motamaati.in` |
| `clerk-android` | Native process (Authorization header, not WebView cookies) |

`handleRedirectCallback`, `setActive({ session: sess_… })`, and stuffing a Chrome session id into `kharchbaant://sso-callback` **cannot** attach a Chrome session to the WebView Client.

On-device proof: `handleRedirectCallback` resolved with no error, then `clerk.isSignedIn === false`, `clerk.session === null`, `signedInSessions.length === 0`.

**Correct bridge:** native Clerk session → Backend **one-time Sign-in Token** → WebView `signIn.create({ strategy: 'ticket' })` → `setActive({ session: createdSessionId })`. Same Clerk `userId`. No duplicate users.

---

## Final working path (Android Google)

```
AuthScreen “Continue with Google”
  → ClerkNativeAuthPlugin.signInWithGoogle()
  → clerk-android Clerk.auth.signInWithOAuth(GOOGLE)
       (SSOManagerActivity; if already signed in: reuse session)
  → Clerk.auth.getToken()                    // native session JWT, not logged
  → POST ${VITE_SUPABASE_URL}/functions/v1/native-bridge
       Authorization: Bearer <native session JWT>
       apikey: Supabase anon
  → verifyToken() → userId from JWT `sub` only
  → clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 })
  → { ticket }
  → useSignIn().create({ strategy: 'ticket', ticket })
  → setActive({ session: createdSessionId })
  → WebView clerk-react session = same user as native
```

Email/password stays on `<SignIn />` in the WebView (same Client). Clerk social buttons are hidden on Android so Google cannot start WebView OAuth.

Web/desktop: normal `<SignIn />` including Google. Do not run this native path there.

---

## Abandoned / forbidden approaches

Do **not** revive these. They were tried and are wrong for this app.

| Approach | Why it fails |
|---|---|
| Account Portal in Chrome Custom Tabs + `native-sso.html` + `kharchbaant://sso-callback` | Session is on Chrome’s Clerk Client, not the WebView |
| `handleRedirectCallback` on the deep-link URL | Completes OAuth only for **this** clerk-js instance |
| `setActive({ session: chromeSessionId })` | `setActive` only activates sessions on **this** Client |
| Injecting cookies / reverse-engineered Clerk internals | Unsupported; easy to log secrets |
| In-WebView Google / `google_one_tap` / `oauth_token_google` from clerk-js | Google in WebView, or FAPI `authorization_invalid` |
| Opening `clerk.motamaati.in` in a browser tab | FAPI JSON, `authorization_invalid` |
| Adding Google hosts to `allowNavigation` | Locked constraint |
| Expo / Auth0 / rewriting the React app | Out of scope |
| Vercel `/api/auth/native-bridge` | SPA catch-all rewrite in `vercel.json` would swallow it |
| Passing Android OAuth client id as `webClientId` | Capgo / GIS need the **Web** client id as `serverClientId` |
| `authenticateRequest()` on the Edge Function | Browser handshake helper; WebView `fetch` to supabase.co looks signed-out |

`openAccountPortal()`, `public/native-sso.html`, and `kharchbaant://sso-callback` intent filters **remain in the repo** but must not be used by the Android Google button.

---

## Failures we hit, in order, and the fix

### 1. WebView Google OAuth / FAPI `authorization_invalid`

OAuth started in the WebView and finished in Chrome (or FAPI was opened as a tab). Clerk 403.

**Fix:** Android Google never uses WebView OAuth. Native `clerk-android` SSO only.

### 2. Chrome session transfer

Deep link delivered `__clerk_created_session`. Callback “succeeded”. User still on sign-in.

**Fix:** Sign-in Token bridge (architecture above). Do not treat a `sess_` in a URL as auth.

### 3. Kotlin K2 internal compiler error

`clerk-android-api:1.1.5` is Kotlin metadata **2.4**. App compiler was **2.1**. K2 crashed in `FirIncompatibleClassExpressionChecker` on `ClerkNativeAuthPlugin.kt`. Star-projected `is ClerkResult.Success<*, *>` also ICEs.

**Fix:**

- Kotlin Gradle plugin + stdlib **2.4.10**
- Unwrap `ClerkResult` in Java (`ClerkResults.java`), not Kotlin `when` / `is Success<*, *>`
- Android `minSdk` **24** (clerk-android)

### 4. Google Credential Manager `[28444]` / `BAD_AUTHENTICATION`

No Google ID token. Capgo `style: 'bottom'` uses `GetGoogleIdOption` (broken here). Standard `GetSignInWithGoogleOption` is `SocialLogin.login({ provider: 'google', options: {} })`.

Google Cloud must also have:

- **Web** OAuth client (this is `webClientId` / `setServerClientId`)
- **Android** OAuth client, package `com.kharchbaant.app`, SHA-1 (and SHA-256 on Android 16) of the **installed APK**
- Same GCP project as the Web client
- Consent screen; if Testing, the phone Google account must be a test user

Debug keystore SHA-1 (typical `assembleDebug`):

`28:43:60:97:F9:08:03:21:01:E1:B7:D4:FC:DE:40:3A:61:D2:FC:FE`

Play/release uses a **different** SHA. Uninstall Play builds before debug testing.

**Do not** put the Android client id in JS. **Do not** invent a new Web client.

The shipping Google button path is **clerk-android `signInWithOAuth`**, not Capgo. Capgo remains in the project; do not swap client ids while debugging `[28444]`.

### 5. Native Clerk `session_exists` (“You’re already signed in”)

First native Google/OAuth **succeeded** and stored a clerk-android session. CORS then blocked the bridge. Retry called `signInWithOAuth` again → Clerk `session_exists`. The plugin treated that as failure and dumped the Clerk error object (includes a session JWT — **never log that**).

**Fix** in `ClerkNativeAuthPlugin.kt`:

- If `Clerk.activeSession` is already set → skip OAuth, `getToken()`
- If failure code is `session_exists` / `identifier_already_signed_in` → reuse, `getToken()`
- Log only error **code/name**, never `ClerkErrorResponse.toString()`

This is **success**, not a regression.

### 6. CORS on `native-bridge` (browser reports CORS; real cause often 401)

Capacitor Origin is `https://www.motamaati.in`. Preflight is `OPTIONS` with **no** Clerk Bearer.

If the Supabase gateway has `verify_jwt = true`, OPTIONS/POST 401 and Chrome calls it CORS.

**Fix:**

- `supabase/functions/native-bridge/config.toml` and `supabase/config.toml`: `verify_jwt = false`
- Deploy: `supabase functions deploy native-bridge --no-verify-jwt`
- Function itself: OPTIONS **204** with  
  `Access-Control-Allow-Origin` (echo `https://www.motamaati.in`),  
  `Allow-Methods: POST, OPTIONS`,  
  `Allow-Headers: authorization, x-client-info, apikey, content-type`

Healthy log: `OPTIONS | 204`. That is CORS working.

### 7. `POST native-bridge` 401 with a valid Clerk JWT

After CORS: OPTIONS 204, POST 401, ~1–2s, gateway already parsed a Clerk RS256 JWT (`iss` = `https://clerk.motamaati.in`, `role` = `authenticated`).

`authenticateRequest()` expects a **browser** handshake (cookies on the app origin). WebView `fetch` to `*.supabase.co` with only `Authorization: Bearer` looks signed-out.

**Fix:** `verifyToken(token, { secretKey })` then `userId` from `sub` only. Then `createSignInToken`. Never trust client-supplied userId/email/Google claims.

Secrets (Edge only, never `VITE_*`):

```bash
supabase secrets set CLERK_SECRET_KEY=sk_live_... CLERK_PUBLISHABLE_KEY=pk_live_...
```

Must be the **same live instance** as the app (`pk_live` / `clerk.motamaati.in`). `sk_test` against a live JWT → 401.

Redeploy the function after code changes. An APK rebuild is **not** required for a bridge-only fix.

---

## Files that implement the working path

| Path | Role |
|---|---|
| `android/app/src/main/java/com/kharchbaant/app/KharchBaantApp.kt` | `Clerk.initialize` once per process |
| `android/app/src/main/java/com/kharchbaant/app/ClerkNativeAuthPlugin.kt` | OAuth / reuse session / `getToken()` |
| `android/app/src/main/java/com/kharchbaant/app/ClerkResults.java` | Java unwrap of `ClerkResult` (no K2 ICE, no JWT in logs) |
| `android/app/src/main/java/com/kharchbaant/app/MainActivity.java` | Register plugin |
| `android/app/build.gradle` | `clerk-android-api`, Kotlin, `clerk_publishable_key` resValue |
| `services/clerkNativeAuth.ts` | Capacitor plugin JS wrapper |
| `services/nativeAuthBridge.ts` | `fetch` bridge + `consumeSignInTicket` |
| `hooks/useNativeGoogleSignIn.ts` | Android button → plugin → ticket |
| `components/auth/AuthScreen.tsx` | Android Google vs web `<SignIn />` |
| `components/auth/clerkAppearance.ts` | Hide Clerk socials on Android |
| `supabase/functions/native-bridge/index.ts` | `verifyToken` + Sign-in Token |
| `supabase/functions/native-bridge/config.toml` | `verify_jwt = false` |

---

## Env / Dashboard checklist

**App (already public):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, optional `VITE_GOOGLE_WEB_CLIENT_ID`.

**Supabase Edge (never commit):** `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `ALLOWED_ORIGINS=https://www.motamaati.in,https://motamaati.in`.

**Clerk Dashboard:** Native API / native applications enabled on this instance.

**Google Cloud (same project as the Web client):** Android OAuth client package + SHA of the APK you actually install.

---

## How to read logs next time

Filter Logcat: `ClerkNativeAuth|chromium|28444`

| You see | Meaning | Action |
|---|---|---|
| `[28444]` / `BAD_AUTHENTICATION` | Google does not recognize package+SHA | Cloud Android client + debug vs Play SHA |
| `session_exists` then plugin **error** | Old bug; should now reuse | Rebuild if that APK predates the reuse fix |
| `Native Clerk already signed in; reusing session` then `Native session token obtained` | Native auth OK | Look at Edge HTTP logs |
| `OPTIONS \| 204` then `POST \| 401` | CORS OK; JWT verify or secret wrong | Function logs: `Native auth bridge failed:` (name only). Check `sk_live` vs `pk_live` |
| `OPTIONS \| 204` then `POST \| 200` and `Native session verified; sign-in token created` | Bridge OK | If UI still signed out, ticket `setActive` in WebView |
| Status bars / `hide(ime())` / `frameRate` only | UI noise, not auth | Recapture from the Google tap |

Never paste Clerk error JSON that contains `jwt` / `last_active_token`.

---

## What not to “fix” when it feels like a step back

A later error often means an **earlier** layer started working:

1. `[28444]` gone → Google works.
2. `session_exists` → **native Clerk session exists**.
3. CORS / OPTIONS 204 → preflight works; read the **POST** status.
4. POST 401 with a Clerk JWT → verify API, not Google.

Do not rotate the Web client id, do not add Google to `allowNavigation`, and do not go back to Account Portal session transfer.
