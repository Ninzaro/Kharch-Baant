# Review: sync Batch 1 (S-06 resume refetch + S-09 Live badge)

Commit: `148272e` (`a3f0eda..148272e`). Live files read, not only the diff.

## Summary

Batch 1 matches the stated contract. `resumeAfterBackground` fetches a skipCache Clerk JWT, then calls `setRealtimeAuth`, then `invalidateQueries` — not `Promise.all`. Triggers are `visibilitychange` (only when `visible`), `window` `online`, and Capacitor `appStateChange` when `isActive`. The 50s Realtime JWT interval in `SupabaseAuthContext` is unchanged and still uses cached `getToken()`. The Live badge no longer opens a bindingless `heartbeat` channel; green requires the five `public:*` data topics to exist and be `joined`.

S-06 containment (REST backfill on resume) is in place and is the change that actually fixes the stale-list symptom. S-09 containment (badge from real channels) is in place. Neither ships the audit’s “correct fix” extras (forced Realtime disconnect/reconnect; e2e cache-vs-REST liveness probe). Those are remaining debt, not regressions of this batch.

No P0/P1 correctness hole found in the resume order or JWT interval. Follow-ups below are real but lower severity.

## Issues

### Issue 1 -- Severity: suggestion
- File: lib/supabase.ts:88
- Description: `resumeAfterBackground` `await`s `setRealtimeAuth`, but that helper never `await`s `realtime.setAuth` (which is async and runs `_performAuth`). The skipped-cache `getToken` still completes before `invalidateQueries`, so REST refetches see the warmed Clerk cache via `accessToken`. The WebSocket JWT push is fire-and-forget: it can still be in flight (or reject unhandled) while refetches start. `_performAuth` also only pushes `access_token` to channels that are already `joinedOnce && _isJoined()`, so a Doze-killed socket is not rejoined by this path. REST invalidate still backfills missed rows; live events wait on the library’s own reconnect.
- Suggestion: `await` `setAuth` inside `setRealtimeAuth` (and swallow/log its errors). If a later batch needs the full S-06 rejoin, call `disconnect()`/`connect()` (or resubscribe) after the fresh JWT, not only `setAuth`.
- Status: open

### Issue 2 -- Severity: suggestion
- File: lib/resumeSync.ts:5
- Description: In-flight guarding lives only in `App.tsx` (`running`). Capacitor `appStateChange` in `index.tsx` calls the same helper with no mutex. Native resume typically fires both `isActive` and `visibilitychange`, so two overlapping `getToken({ skipCache: true })` + full-cache invalidations can run. TanStack will often dedupe identical in-flight fetches; Clerk skipCache will not. The helper also always invalidates even when the token is `''` (signed-out WelcomeScreen, or getter not registered yet). `setAuth(null)` then falls through to the Realtime `accessToken` callback rather than wiping a live JWT, but signed-out/native cold paths still do extra Clerk and Query work.
- Suggestion: Put a module-level in-flight lock (and optionally a short debounce) inside `resumeAfterBackground`. If `getClerkSupabaseToken({ skipCache: true })` returns empty, skip `setRealtimeAuth('')` and skip `invalidateQueries`.
- Status: open

### Issue 3 -- Severity: suggestion
- File: components/RealtimeStatus.tsx:12
- Description: Missing channels map to `'connecting'` (`Syncing`); any present-but-not-`joined` channel maps to `'disconnected'` (`Offline`). During the normal `joining` window after `personId` appears, the badge flashes Offline even though subscribe is in progress. Conversely, if a channel is closed and removed from `getChannels()` (`RealtimeChannel` `_onClose` → `_remove`), the badge stays on Syncing forever instead of Offline. Green-only-when-all-five-`joined` is correct for S-09; the other two states mix startup, join-in-progress, and real failure.
- Suggestion: Treat `joining` (and maybe `leaving`) as connecting. Treat `errored` / `closed` as disconnected. If a topic is missing after bridges have mounted (person is set), that is disconnected, not connecting. Optional: subscribe to channel state callbacks instead of a 1s poll.
- Status: open

### Issue 4 -- Severity: nit
- File: components/RealtimeStatus.tsx:36
- Description: Titles were updated (“Data channels joined” / “not joined”) but the badge still has `pointer-events-none`, so those tooltips cannot be shown. Pre-existing, still true after this change. No `role="status"` / `aria-live` either.
- Suggestion: Drop `pointer-events-none` or expose the same text to assistive tech. Not required to close S-09.
- Status: open

### Issue 5 -- Severity: suggestion
- File: lib/resumeSync.ts:1
- Description: New resume helper and rewritten badge have no unit tests. `SupabaseAuthContext` still covers the 50s interval, but nothing asserts skipCache → `setRealtimeAuth` → `invalidateQueries` order, the three resume triggers, or “Live iff five `public:*` channels are `joined`”. `src/test/setup.ts` mocks `lib/supabase` without `getChannels`, so a RealtimeStatus test would need its own mock.
- Suggestion: Add a focused `src/test/lib/resumeSync.test.ts` (fake getter + spies) and a RealtimeStatus test with five fake channels in `joined` / `joining` / missing.
- Status: open

## Verified (no issue)

- Resume order in `lib/resumeSync.ts:6-8`: skipCache token, then `setRealtimeAuth(token)`, then `await queryClient.invalidateQueries()`.
- `App.tsx:78-96`: `visibilitychange` and `online`; early-return when `document.visibilityState !== 'visible'`.
- `index.tsx:45-48`: Capacitor `appStateChange` only resumes when `isActive`.
- `contexts/SupabaseAuthContext.tsx:13` and `:76-83`: `REALTIME_AUTH_REFRESH_MS = 50_000`; interval still calls `getClerkSupabaseToken()` without `skipCache`.
- Getter plumbing: `setClerkTokenGetter((opts) => session.getToken({ skipCache: opts?.skipCache }))`; `getClerkSupabaseToken` forwards `opts`; `window.Clerk` fallback passes `{ skipCache: true }` only when requested.
- Data topics in `services/supabaseApiService.ts` are `public:groups`, `public:transactions`, `public:payment_sources`, `public:people`, `public:group_members` — the fragments in `RealtimeStatus.tsx:4-10` match. Heartbeat channel is gone.
- `RealtimeStatus` is only mounted from authenticated `App`, so the badge is not shown on Welcome/Auth. Bridges still no-op until `personId` exists.

## Remaining S-06 / S-09 debt (out of batch scope)

- No `pageshow` / bfcache handler (original S-06 inventory; not in this batch’s trigger list).
- No forced Realtime rejoin on resume.
- No REST-vs-cache liveness probe (S-09 “correct fix”).
- `ARCHITECTURE.md` was not updated for the resume path (AGENTS.md structural-doc rule).
