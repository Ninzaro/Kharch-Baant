# Launch board

Owner: tracker agent. Coding stays in the implementation session.
This file is a status board only. Do not treat it as a prompt to write code.

Updated: 2026-09-23
Closed testing: 14 days complete. Production backend is live.
Public launch: not yet. The current web build is on the live site. Remaining blockers below are still open.

## Blockers before a public launch

| ID | Item | Status | Note |
|---|---|---|---|
| L-1 | Deploy the current web build and a new Play bundle | complete | User pushed the commit and checked the live site on 2026-09-23. Current web build is deployed. |
| L-2 | Two phones show a new expense without refresh | complete | User confirmed on 2026-09-23: expenses appear on the other device without a refresh, and registration is flawless. |
| L-3 | Invite link opens the Android app | open | Email links open the Play Store app. WhatsApp opens Chrome and offered to install the site as a second app. A signed-out creator could still see the invited group; that clear-on-logout fix is in source and needs the next web deploy. |
| L-4 | Brevo domain not landing in spam | open | SPF and DKIM for the sender domain. Not an app code change. |
| L-5 | Clerk session claims `email` and `email_verified` | open | Required for verified-email claim. Dashboard → Sessions → Customize session token. Keep `"role": "authenticated"`. |
| L-6 | Realtime “Allow public access” off | open | L-2 has passed, so this can be done next. Leave it open until it is actually turned off. |
| L-7 | Play production release, not only internal testing | open | Store listing, privacy policy, Data safety, content rating, production track. |

## Soon after launch

| ID | Item | Status | Note |
|---|---|---|---|
| S-1 | Nightly database dump and one restore test | open | User deferred. No PITR on this plan. |
| S-2 | Rate limits on PostgREST RPCs (`find_person_by_email`, `create_unclaimed_person`) | open | Edge functions already use the shared counter. |
| S-3 | Append-only transaction history | open | Item 7. Who changed an expense is still not stored. |
| S-4 | `send-email` accepts only a server-side invite id | open | R-10 correct fix. Containment (group_invite only) is live. |
| S-5 | Confirm Android CI went green after the typecheck gate | open | Item 6 is in the repo. One successful Actions run is the proof. |

## Not required to launch

| ID | Item | Status |
|---|---|---|
| N-1 | Excel/PDF group report | parked |
| N-2 | Push notifications for invites | parked |
| N-3 | Native-bridge shared-secret second factor | parked |
| N-4 | Per-group Realtime topics | parked |
| N-5 | Drop leftover `group_deletion_requests` table | parked |
| N-6 | CSP, privacy-page accuracy, `android:allowBackup` | parked |

## Already closed

R-01 group delete RPC, R-02 claim SQL, R-03/R-04 money checks, R-05 realtime DELETE leak, R-06 settled-before-delete, R-07 no open policies, R-08 person lookup narrowed, R-09 AI cache closed, R-11/R-12 resume, R-13 membership diff, R-14 claimed-user consent, R-15 leave group, R-17 auth-failure screen, R-21 native token check, R-22 deletion UI removed, A-26 debug function dropped, A-27 helpers hidden from the API, A-17 edge rate limits, send-email on Brevo, suggest-tag Clerk auth.
