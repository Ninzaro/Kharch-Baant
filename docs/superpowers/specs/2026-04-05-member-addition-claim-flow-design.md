---
title: Member Addition & Claim Flow
date: 2026-04-05
status: approved
---

# Member Addition & Claim Flow

## Problem

Currently, adding a group member creates a dummy placeholder (name only, no email stored, no link to a real user account). There is no way to:
- Detect that a dummy contact is already a Kharch Baant user
- Send them an invitation email
- Merge their dummy record with their real account when they sign up

## Goals

1. Store email on `people` rows so the same person is never duplicated across groups
2. When adding a member, detect existing users by email and reuse their record
3. When a new user signs up, claim any dummy records that share their email — preserving all existing transactions and balances
4. Let users edit their own name and email after claiming
5. Prepare the architecture for future phonebook import (Android/iOS) and email sending without requiring further API changes

## Non-Goals

- Settlement suggestions (separate feature)
- Phonebook UI (future; API is already compatible)
- Email sending activation (MailerSend currently simulated; will be enabled server-side separately)

---

## Section 1: Database Schema

### Migration

```sql
-- Add email and explicit claim status to people table
ALTER TABLE people ADD COLUMN email TEXT;
ALTER TABLE people ADD COLUMN is_claimed BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial unique index: prevents duplicate emails while allowing many null-email dummies
CREATE UNIQUE INDEX people_email_unique ON people (email) WHERE email IS NOT NULL;

-- Mark existing authenticated users as claimed
UPDATE people SET is_claimed = TRUE WHERE clerk_user_id IS NOT NULL;

-- Add source tracking for future analytics
ALTER TABLE people ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
-- Values: 'manual' | 'phonebook' | 'email_invite' | 'self'
-- 'self' = user registered themselves; others = added by someone else
```

### Updated `people` table columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Never changes — all FK references stay intact on claim |
| `name` | TEXT | Set by adder; overwritten by real person's name on claim |
| `email` | TEXT UNIQUE (partial) | Identity anchor for deduplication and claim matching |
| `avatar_url` | TEXT | Pravatar deterministic URL |
| `clerk_user_id` | TEXT UNIQUE | Null for unclaimed dummies |
| `auth_user_id` | TEXT | Post-migration alias for clerk_user_id |
| `is_claimed` | BOOLEAN | Explicit flag; replaces implicit `clerk_user_id IS NOT NULL` check |
| `source` | TEXT | How the person was added: `self`, `manual`, `phonebook`, `email_invite` |

---

## Section 2: Member Addition Flow

### UI — `MemberInviteModal.tsx`

1. Email field becomes a real, persisted input (currently ignored)
2. On email blur/change: fire a debounced lookup against `people` by email
   - **Match found (claimed user):** Show chip — *"[Name] is already on Kharch Baant — they'll be added directly"*. Hide the name field; use their existing record.
   - **Match found (unclaimed dummy):** Show chip — *"[Name] was already added as a contact — they'll be invited to this group"*. Reuse existing record.
   - **No match:** Name field required as today
3. If email provided and no existing match: after creation, trigger invite email (async, non-blocking)

### API — `addPersonToGroup()` in `supabaseApiService.ts`

```
addPersonToGroup(groupId, { name, email? })
  1. If email provided:
     a. SELECT id FROM people WHERE email = $email LIMIT 1
     b. If found → use that person_id, skip INSERT
     c. If not found → INSERT new people row (name, email, is_claimed=false, source='manual')
  2. If no email → INSERT people row (name only, source='manual') as today
  3. INSERT into group_members (group_id, person_id) — skip if already member
  4. If new dummy with email → fire invite email stub (no-op until MailerSend is server-side)
```

**Key invariant:** Two people adding "Rahul" with the same email to different groups always resolve to the same `person_id`. All group memberships and balance history are unified.

---

## Section 3: Claim Flow

### `ensureUserExists()` updated logic

Called every time a user logs in via Clerk. New flow:

```
ensureUserExists(authUserId, userName, userEmail)
  1. SELECT * FROM people WHERE clerk_user_id = $authUserId LIMIT 1
     → If found: return existing person (no change, fast path)

  2. SELECT * FROM people WHERE email = $userEmail AND is_claimed = false LIMIT 1
     → If found (dummy claim):
         UPDATE people SET
           clerk_user_id = $authUserId,
           auth_user_id  = $authUserId,
           name          = $userName,        -- real person's name wins
           is_claimed    = TRUE,
           source        = 'self'
         WHERE id = $dummyId
         → Return updated person (same UUID, all group memberships intact)

  3. No match → INSERT new people row (name, email, clerk_user_id, is_claimed=true, source='self')
```

### Why the UUID never changes

All `group_members`, `transactions.paid_by_id`, and `split_participants` reference `people.id`. Because the claim updates the *existing* row (same UUID), every past transaction, balance, and group membership automatically belongs to the real user. No data migration required.

### Edge case: same email added as dummy to multiple groups

Because of the partial unique index on `email`, two people adding the same email to different groups will reference the **same** `people` row. Claiming once (step 2 above) fixes all groups simultaneously.

### Edge case: name conflict

The adder may have saved the name differently (e.g., "Ninad B." vs "Ninad Bhatt"). On claim, Clerk's display name overwrites — the real person chooses their canonical name. They can change it again via profile edit (Section 4).

---

## Section 4: Profile Editing

### What any claimed user can edit

- **Name** — updates `people.name` immediately; all past transactions and all groups reflect the new name (single row, no propagation needed)
- **Email** — updates `people.email` AND Clerk profile email via `clerk.user.update()`

### Email change merge case

If a user's new email matches an *existing unclaimed dummy*:
1. Reassign all `group_members` rows from the dummy's `person_id` to the current user's `person_id`
2. Delete the dummy row
3. Update `people.email` on the current user's row

This handles: *"Ninad added me as rahul@old.com but I signed up with rahul@new.com"*

### Where profile editing lives

Existing `UserProfile` component (already accessible from `UserMenu`). Add name and email fields with save buttons.

---

## Section 5: Forward Compatibility

### Phonebook (Capacitor — future)

- `@capacitor-community/contacts` returns `{ name, emails[], phones[] }`
- Same `addPersonToGroup(groupId, { name, email })` API — phonebook just pre-fills the fields
- Set `source = 'phonebook'` on the created person row
- Zero backend changes required when the UI is built

### Email sending (MailerSend — future)

- `emailService.sendGroupInviteEmail()` is already implemented; currently logs instead of sending (CORS limitation)
- The call in `addPersonToGroup` is a no-op stub today
- When MailerSend moves to a Supabase Edge Function, the stub is replaced with a real call — no flow changes
- `email_invites` table already tracks delivery status per invite

---

## Dashboard: Cross-Group Balance Summary

Because each person has one `person_id` across all groups, the home dashboard can show a unified balance:

- **"You are owed ₹X total"** — sum of positive balances across all active groups
- **"You owe ₹Y total"** — sum of negative balances across all active groups
- Per-group breakdown inside each group card (already works)

This requires no new API — `calculateGroupBalances` per group, sum the current user's value across groups.

---

## Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/YYYY_add_email_claim_to_people.sql` | New migration (Section 1) |
| `lib/database.types.ts` | Add `email`, `is_claimed`, `source` to people type |
| `types.ts` | Add `email`, `isClaimed`, `source` to `Person` type |
| `services/supabaseApiService.ts` | Update `ensureUserExists`, `addPersonToGroup`, `transformDbPersonToAppPerson` |
| `components/MemberInviteModal.tsx` | Email field real + live lookup chip |
| `components/auth/UserProfile.tsx` | Name + email editing |
| `components/Dashboard.tsx` | Cross-group balance summary |
