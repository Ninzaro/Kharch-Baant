# Phase A — Security hardening (pre-promo)

## What changed in code

| Area | Change |
|---|---|
| Email | Client no longer imports `mailersend` or reads `VITE_MAILERSEND_*`. Sends via Edge Function `send-email` only. |
| Gemini | Client no longer reads `VITE_GEMINI_API_KEY`. AI via Edge Function `suggest-tag`; otherwise keywords + cache. |
| People RLS | Migration `20260728000000_phase_a_rls_people_visibility.sql` — no full-table SELECT for every user. |
| Schema seed | `supabase-schema.sql` no longer creates open `Allow all operations` policies. |
| Env template | `.env.example` documents public vs secret keys. |

## You must do manually (cannot be done from the repo)

### 1. Rotate keys (do this today if keys ever shipped in a web/APK build)

1. **MailerSend** → API Tokens → revoke old `mlsn…` → create new → set only as Supabase secret `MAILERSEND_API_KEY`.
2. **Google AI Studio** → revoke old Gemini key → create new → set only as Supabase secret `GEMINI_API_KEY`.
3. Remove from local `.env.local` any of: `VITE_MAILERSEND_API_KEY`, `VITE_GEMINI_API_KEY`, bare `GEMINI_API_KEY` used for the app.
4. If those values ever hit git history or a public deploy env, treat them as burned.

### 2. Deploy Edge Functions + secrets

```bash
supabase login
supabase link --project-ref YOUR_REF

supabase secrets set MAILERSEND_API_KEY=mlsn.NEW_KEY
supabase secrets set MAILERSEND_FROM_EMAIL=noreply@your-domain.com
supabase secrets set GEMINI_API_KEY=AIza.NEW_KEY
# optional:
supabase secrets set GEMINI_MODEL=gemini-2.0-flash

supabase functions deploy send-email
supabase functions deploy suggest-tag
```

Without deploy, invite emails no-op and AI falls back to keywords only (safe).

### 3. Apply RLS migration on live Supabase

In **SQL Editor**, paste and run:

`supabase/migrations/20260728000000_phase_a_rls_people_visibility.sql`

Then audit:

```sql
-- RLS enabled?
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Policies
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**Fail** if you still see:

- `rowsecurity = false` on `people` / `groups` / `transactions` / …
- policy named `Allow all operations`
- people SELECT with only `true` (no `i_can_see_person`)

Also **do not run** root files like `DATABASE_FIX_DISABLE_RLS.sql` on production.

### 4. Clerk production keys (when going public)

| Env | Key |
|---|---|
| Local / closed beta | `pk_test_…` |
| Production web + stores | `pk_live_…` |

In Clerk Dashboard: create production instance, set allowed origins (Vercel domain + Capacitor if needed), JWT template `supabase` must still exist.

Set `VITE_CLERK_PUBLISHABLE_KEY=pk_live_…` only in production host env (Vercel / CI), not in the public repo.

### 5. Dangerous SQL in repo

Historical fix scripts may still exist under root / `migrations/`. Treat as **archive / never apply** unless you understand them. Prefer timestamped files under `supabase/migrations/`.

## Quick verification

1. `npm run build` — bundle must **not** contain `mlsn.` or a real Gemini key.
2. App: add expense “Flights” → Travel via keywords (no Gemini needed).
3. After Edge deploy: novel description can hit AI; check function logs if not.
4. Second test user must **not** see unrelated people’s rows in Supabase table editor via anon+JWT of user A.

## What “secure if public on GitHub” means

- OK public: React source, anon key, Clerk publishable key.
- Not OK public / not OK in client: MailerSend, Gemini, service_role, Clerk secret.
- Data isolation: RLS + Clerk JWT — not obscurity of the source tree.

---

# Phase B — Claim / invites / Edge auth (2026-08-12)

## What changed in code

| Area | Change |
|---|---|
| Claim RPC | `claim_person_by_email` binds identity to JWT `sub` via `requesting_user_id()`; client `p_clerk_id` must match or is ignored path rejects mismatch. |
| Invite validate | Client uses `get_invite_preview(token)` (SECURITY DEFINER, exact token) — works pre-auth without open `group_invites` SELECT. |
| Invite accept | Client uses `accept_group_invite(token)` — membership from JWT person row, not client-only inserts. |
| Invite RLS | Members/creators only on `group_invites` / `email_invites`. |
| Edge `send-email` | Real JWT verification (`getClaims` / `getUser` / optional HS256 secret), per-user rate limit, optional `ALLOWED_ORIGINS`, email format + recipient caps. |
| Edge `suggest-tag` | Same JWT + rate limit + CORS helpers. |

Migration: `supabase/migrations/20260812000000_phase_b_claim_invites_security.sql`

## You must do manually

### 1. Apply Phase B SQL on live Supabase

SQL Editor → paste and run that migration file.

### 2. Redeploy Edge Functions

```bash
supabase functions deploy send-email
supabase functions deploy suggest-tag
# production CORS:
supabase secrets set ALLOWED_ORIGINS=https://your-production-domain.com
# if getClaims fails for your Clerk JWT template, also set:
# supabase secrets set SUPABASE_JWT_SECRET=<Project Settings → API → JWT Secret>
```

### 3. Smoke checks

1. New user with matching unclaimed email → claims correctly.
2. Unauthenticated open of `/invite/<token>` → preview loads.
3. Accept invite while signed in → joins group once.
4. Second user cannot list other groups’ invites via table API.
5. Edge: request without `Authorization` → 401; with valid Clerk JWT → works.
