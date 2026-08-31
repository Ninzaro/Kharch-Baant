# Play Store + public launch

Use this after Phase A/B security work. Code cannot finish Play Console or Clerk production for you.

## Blockers you must do (not in git)

| Step | Where | Notes |
|------|--------|--------|
| 1. Clerk **production** instance | Clerk Dashboard | Custom domain + **Activate Supabase integration**. In Supabase: **Authentication → Third-party / Providers → Add Clerk**. After new JWT signing keys, do **not** use the HS256 `supabase` template. |
| 2. `VITE_CLERK_PUBLISHABLE_KEY=pk_live_…` | Vercel env (Production) | Never commit. Rebuild web after change. |
| 3. Clerk “Users can delete their accounts” | Clerk → User & authentication | Required for in-app `user.delete()`. |
| 4. Apply `20260813000000_anonymize_my_account.sql` | Supabase SQL Editor | Required for Settings → Delete Account. |
| 5. MailerSend secrets (optional) | `supabase secrets set` | Invite **links** work without email. |
| 6. Release keystore | Offline backup | Run `npm run android:keystore` once, then back up the file + password. |
| 7. Play Console listing | play.google.com/console | Privacy policy URL, account deletion URL, Data safety, content rating, screenshots. |
| 8. Production web URL in listing | Same host as `VITE_APP_URL` | Privacy: `https://YOUR_DOMAIN/privacy.html` · Deletion: `https://YOUR_DOMAIN/account-deletion.html` |

## What the repo already does

- Package `com.kharchbaant.app`, `versionName` 1.0.0, `versionCode` 1, `targetSdk` 35.
- Release AAB: `npm run android:build:release` (asserts no Capacitor live-reload URL).
- HTTPS-only (`usesCleartextTraffic=false` + network security config).
- Signing from `android/keystore.properties` when present.
- In-app **Delete Account** → `anonymize_my_account` then Clerk `user.delete()`.
- Public **privacy** and **account-deletion** pages (copied to `dist/` by Vite).
- Invite deep link: `kharchbaant://invite/<token>`.
- Native Google sign-in uses Chrome Custom Tabs and returns to `kharchbaant://sso-callback` (not the WebView).

## Native Google login (closed testing)

Google returns **HTTP 400 malformed** if OAuth runs inside the Capacitor WebView. Closed-testing builds must:

1. Ship a build that **does not** list `accounts.google.com` in `capacitor.config.ts` `server.allowNavigation`.
2. In **Clerk Dashboard (Production) → Configure → Paths**, add **Allowed redirect URLs**:
   - `kharchbaant://sso-callback`
   - `https://www.motamaati.in`
   - `https://www.motamaati.in/sso-callback`
3. In **Clerk → SSO connections**, enable **Google**, **Apple**, and **Microsoft** with your own provider credentials (native buttons are already in the app).
4. In **Google Cloud → OAuth client (Web)**, Authorized JavaScript origins should include:
   - `https://www.motamaati.in`
   - `https://accounts.motamaati.in`
   - `https://localhost` (Capacitor Android origin)
5. Rebuild and upload a new AAB (`versionCode` +1) after these code + dashboard changes.

## Play Console — Data safety (honest defaults)

| Category | Answer |
|----------|--------|
| Collected | Name, email, user IDs, photos (optional), financial info (expense amounts you enter), app activity / diagnostics |
| Shared | With service providers (Clerk, Supabase, MailerSend, Gemini if enabled, Sentry) — not sold |
| Encrypted in transit | Yes (HTTPS) |
| Users can request deletion | Yes |
| Children | Not targeted at under-13 |

## Store listing (draft copy)

- **Title:** Kharch Baant  
- **Short:** Split expenses with friends, trips, and households.  
- **Full:** Track shared costs, split equally or custom, see balances, and settle up. Invite people by link. Works on Android and the web.

Graphics you still need: 512×512 icon, feature graphic 1024×500, phone screenshots (2+).

## Signing key (do this while waiting on Clerk)

One-time, on your Windows PC, from the project folder:

```powershell
npm run android:keystore
```

It will ask for a password twice, then create:

- `android/kharch-baant-release.keystore`
- `android/keystore.properties`

**Same day:** copy the `.keystore` file to a USB drive or password manager. Save the password there too. Losing either means you cannot update the app on Play.

Then:

```powershell
npm run android:build:release
```

## Build & upload

```bash
# After keystore exists (and Clerk production is ready for the public listing):
npm run android:build:release
```

Upload `android/app/build/outputs/bundle/release/app-release.aab` to **Testing → Internal testing** first, then Production.

Each store update: increment `versionCode` in `android/app/build.gradle`.

## Do not ship if

- `android/app/src/main/assets/capacitor.config.json` contains `server.url`
- Clerk key is still `pk_test_`
- Privacy / deletion URLs 404 on the production domain
- `anonymize_my_account` is not applied (delete button will fail)
