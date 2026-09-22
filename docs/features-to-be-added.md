# Features to be added

Parked product work. Not part of the `audit/03-deadcode.md` pass. Do not implement while closing dead-code findings unless explicitly scheduled.

---

## Group-wise summary report (Excel / PDF)

**Origin:** discussed after D-05 (creator-only group delete). Deletion-request UI was removed instead of building reports into that flow.

**Intent:** One shareable group report for **active groups** (on demand) and as a **last step before the creator deletes** a group. Same feature, two entry points. Hard delete still removes DB rows — a report after delete only exists if the file was saved first (or a future snapshot table is designed).

### Contents

- Top spender
- Top spend category
- Date-wise / per-day spend
- Per member: amount paid, share of expenses, final balance
- Overall group picture (totals + who owes whom)

### Formats and share

- User picks **Excel** or **PDF**
- Download + share (Web Share / Capacitor), not PNG-only

### Existing building blocks (do not duplicate blindly)

- `GroupSummaryModal` — total spent, by payer, by category; PNG via `html2canvas`
- `ShareModal` — share/download a PNG
- `calculateGroupBalances` — canonical nets (use this; do not re-roll)

### Stack note

PDF/Excel likely need new libraries (`jspdf`, SheetJS/ExcelJS). That is a major-dep exception: update `ARCHITECTURE.md` §2 before adding them.

### Effort (rough)

- MVP (stats + one format + download + optional delete-gate): ~3–5 days
- Full (both formats, share, Android, tests, polish): ~1–2 weeks
- Persist reports after delete: extra design (snapshot table + RLS)

### Status

Not started. Resume only when the user names this feature (not a D-xx id).

---

## Consent before adding a claimed person to a group

**Origin:** after D-06 discussion. Today any member can attach any person (including a claimed account found by email) to a group with no confirmation (audit **R-14**). That exposes their name, expenses, and balances to the group, and exposes the group’s ledger to them.

**Intent:** Typing someone’s email must **not** instantly join them. They must **approve** first. Same rule on Android, iOS web, and desktop web.

### MVP (email — start here)

1. User types an email to add someone.
2. If that email is a **claimed** person (or even if not yet signed up): create a **pending invite**, do **not** insert `group_members`.
3. Send email: “{Name} is trying to add you to {Group}.” Link to accept/decline (reuse `send-email` + invite token flow; tighten so the URL is only our origin).
4. Only on **accept** (signed-in, matching email) insert membership.

Unclaimed placeholders (people who have never signed up) can stay as today’s “add by name/email” **or** wait until they sign up and accept — decide at design time. Default recommendation: **claimed users always require accept**; placeholders stay local until they claim and then get the same email.

### Later: push notifications

- Android app: native push (FCM) when a pending add exists.
- Web / iOS Safari: Web Push (and iOS needs the PWA installed + permission). This is a second project: device tokens, Edge function, permission UX.

Do **not** block the MVP on push. Email is the safety gate.

### Status

Claimed-user email consent is implemented. Add Member sends a one-use invite instead of inserting a membership. `accept_group_invite` rejects that invite when the signed-in email does not match. Unclaimed placeholders can still be added directly. Push notifications are not started.

### Existing pieces

- `createGroupInvite` / `email_invites` / `sendGroupInviteEmail` / `accept_group_invite`
- Member add today: `addPersonToGroup` inserts `group_members` immediately
- Audit R-08 (`find_person_by_email` too much PII) and R-02 (claim-by-email) should be considered in the same design so an attacker cannot harvest emails and force-join

### Effort (rough)

- Email consent for claimed users, using existing invite RPCs: **~2–4 days**
- Push (FCM + Web Push): **~1–2 weeks** extra, new infra

### Status

Not started. Resume only when the user names this feature.

---

## Revoke / deactivate an invite link

**Origin:** D-28. `deactivateInvite` exists in `supabaseApiService.ts` and is never called. Invite links cannot be turned off from the UI.

**Intent:** Group creator (or members) can deactivate a live invite token so the link stops working.

**Status:** Client helper already exists; no UI. Not started.
