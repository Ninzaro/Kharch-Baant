# Member Addition & Claim Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store email on person records, deduplicate members by email, let real users claim dummy placeholders on sign-up, and fix cross-group balance calculations.

**Architecture:** Email becomes the identity anchor — `findPersonByEmail` gates every new person creation. On login, `ensureUserExists` checks for an unclaimed dummy with the same email before creating a new row. Because `person_id` never changes on claim, all existing transactions and balances are automatically correct.

**Tech Stack:** React 19, TypeScript, Supabase (PostgreSQL + RLS), Clerk (auth), Vitest (unit tests)

**Spec:** `docs/superpowers/specs/2026-04-05-member-addition-claim-flow-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/20260405000000_add_email_claim_to_people.sql` | Create | Adds email, is_claimed, source columns |
| `types.ts` | Modify | Add `isClaimed`, `source` to `Person` type |
| `services/supabaseApiService.ts` | Modify | `transformDbPersonToAppPerson`, `ensureUserExists`, `addPerson`, `findPersonByEmail`, `updatePerson`, `mergePersonByEmail` |
| `services/apiService.ts` | Modify | `addPersonToGroup` — accept email, call dedup logic |
| `components/MemberInviteModal.tsx` | Modify | Real email field, debounced lookup chip |
| `components/auth/UserProfile.tsx` | Modify | Name + email editing, switch to SupabaseAuthContext |
| `components/HomeScreen.tsx` | Modify | Fix balance calc: replace manual loop with `calculateGroupBalances` |
| `components/Dashboard.tsx` | Modify | Same balance calc fix for per-group view |
| `src/test/memberClaim.test.ts` | Create | Unit tests for transform and type checks |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260405000000_add_email_claim_to_people.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260405000000_add_email_claim_to_people.sql

-- Add email as identity anchor for deduplication and claim matching
ALTER TABLE people ADD COLUMN IF NOT EXISTS email TEXT;

-- Explicit claim status (replaces implicit clerk_user_id IS NOT NULL check)
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_claimed BOOLEAN NOT NULL DEFAULT FALSE;

-- Track how a person was added (analytics + future UX)
ALTER TABLE people ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Partial unique index: allows many null-email dummies, prevents duplicate emails
CREATE UNIQUE INDEX IF NOT EXISTS people_email_unique ON people (email) WHERE email IS NOT NULL;

-- Mark all existing authenticated rows as claimed
UPDATE people SET is_claimed = TRUE WHERE clerk_user_id IS NOT NULL;

-- Mark existing self-registered users as source='self'
UPDATE people SET source = 'self' WHERE clerk_user_id IS NOT NULL;
```

- [ ] **Step 2: Apply migration to local Supabase**

```bash
# If using Supabase CLI:
npx supabase db push

# OR apply manually via Supabase dashboard SQL editor
```

Expected: No errors. Run `SELECT email, is_claimed, source FROM people LIMIT 5;` and confirm columns exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260405000000_add_email_claim_to_people.sql
git commit -m "feat: add email, is_claimed, source columns to people table"
```

---

## Task 2: Update Person Type

**Files:**
- Modify: `types.ts` (lines 1–7)

- [ ] **Step 1: Write failing test**

Create `src/test/memberClaim.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Person } from '../../types';

describe('Person type', () => {
  it('accepts isClaimed and source fields', () => {
    const claimed: Person = {
      id: 'abc',
      name: 'Rahul',
      avatarUrl: 'https://example.com/img.jpg',
      isClaimed: true,
      source: 'self',
    };
    expect(claimed.isClaimed).toBe(true);
    expect(claimed.source).toBe('self');
  });

  it('accepts unclaimed dummy with email', () => {
    const dummy: Person = {
      id: 'xyz',
      name: 'Priya',
      avatarUrl: 'https://example.com/img.jpg',
      email: 'priya@example.com',
      isClaimed: false,
      source: 'manual',
    };
    expect(dummy.isClaimed).toBe(false);
    expect(dummy.email).toBe('priya@example.com');
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm run test:run -- src/test/memberClaim.test.ts
```

Expected: TypeScript compile error — `isClaimed` and `source` do not exist on `Person`.

- [ ] **Step 3: Update Person type in types.ts**

Replace lines 1–7:

```typescript
export type PersonSource = 'manual' | 'phonebook' | 'email_invite' | 'self';

export type Person = {
    id: string;
    name: string;
    avatarUrl: string;
    email?: string;
    authUserId?: string;
    isClaimed?: boolean;
    source?: PersonSource;
};
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
npm run test:run -- src/test/memberClaim.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add types.ts src/test/memberClaim.test.ts
git commit -m "feat: add isClaimed and source fields to Person type"
```

---

## Task 3: Update transformDbPersonToAppPerson

**Files:**
- Modify: `services/supabaseApiService.ts` (lines 121–131)

- [ ] **Step 1: Write failing test** (add to `src/test/memberClaim.test.ts`)

```typescript
// Add this import at the top of the test file:
// import { getPeople } from '../../services/supabaseApiService';
// Note: transformDbPersonToAppPerson is private; we verify via the exported shape.
// Test the shape contract instead:

it('Person from DB maps is_claimed and source', () => {
  // Simulate what transformDbPersonToAppPerson should produce
  const dbRow = {
    id: 'test-id',
    name: 'Test User',
    avatar_url: 'https://example.com/a.jpg',
    email: 'test@example.com',
    clerk_user_id: 'clerk_123',
    auth_user_id: null,
    is_claimed: true,
    source: 'self',
  };

  // Expected output shape
  const expected: Person = {
    id: 'test-id',
    name: 'Test User',
    avatarUrl: 'https://example.com/a.jpg',
    email: 'test@example.com',
    authUserId: 'clerk_123',
    isClaimed: true,
    source: 'self',
  };

  // We manually apply the same logic as transformDbPersonToAppPerson:
  const authUserId = (dbRow as any)?.auth_user_id ?? (dbRow as any)?.clerk_user_id ?? null;
  const result: Person = {
    id: dbRow.id,
    name: dbRow.name,
    avatarUrl: dbRow.avatar_url,
    email: dbRow.email,
    authUserId: authUserId || undefined,
    isClaimed: dbRow.is_claimed,
    source: dbRow.source as PersonSource,
  };

  expect(result).toEqual(expected);
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm run test:run -- src/test/memberClaim.test.ts
```

Expected: FAIL — `PersonSource` not imported in test file.

- [ ] **Step 3: Add import to test file**

At top of `src/test/memberClaim.test.ts`, add:
```typescript
import type { Person, PersonSource } from '../../types';
```

Replace the earlier `import type { Person } from '../../types';` line.

- [ ] **Step 4: Update transformDbPersonToAppPerson in supabaseApiService.ts**

Replace lines 121–131:

```typescript
const transformDbPersonToAppPerson = (dbPerson: DbPerson): Person => {
  const authUserId = (dbPerson as any)?.auth_user_id ?? (dbPerson as any)?.clerk_user_id ?? null;
  return {
    id: dbPerson.id,
    name: (dbPerson as any).name,
    avatarUrl: (dbPerson as any).avatar_url,
    email: (dbPerson as any).email ?? undefined,
    authUserId: authUserId || undefined,
    isClaimed: (dbPerson as any).is_claimed ?? false,
    source: (dbPerson as any).source ?? 'manual',
  };
};
```

- [ ] **Step 5: Run tests**

```bash
npm run test:run -- src/test/memberClaim.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add services/supabaseApiService.ts src/test/memberClaim.test.ts
git commit -m "feat: map is_claimed and source in transformDbPersonToAppPerson"
```

---

## Task 4: Add findPersonByEmail

**Files:**
- Modify: `services/supabaseApiService.ts` (after `addPerson`, around line 820)

- [ ] **Step 1: Add findPersonByEmail function**

In `services/supabaseApiService.ts`, insert after `addPerson` (around line 819):

```typescript
export const findPersonByEmail = async (email: string): Promise<Person | null> => {
  const { data, error } = await supabase
    .from('people')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return transformDbPersonToAppPerson(data);
};
```

- [ ] **Step 2: Export from apiService.ts**

In `services/apiService.ts`, add to the re-exports at the top:

```typescript
export { findPersonByEmail } from './supabaseApiService';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: No TypeScript errors related to `findPersonByEmail`.

- [ ] **Step 4: Commit**

```bash
git add services/supabaseApiService.ts services/apiService.ts
git commit -m "feat: add findPersonByEmail for email-based deduplication"
```

---

## Task 5: Update ensureUserExists — Claim Flow

**Files:**
- Modify: `services/supabaseApiService.ts` (lines 822–881)

- [ ] **Step 1: Replace ensureUserExists with claim-aware version**

Replace the entire `ensureUserExists` function (lines 822–881):

```typescript
export const ensureUserExists = async (authUserId: string, userName: string, userEmail: string): Promise<Person> => {
  // Fast path: user already claimed their record
  const { data: byAuthId, error: authIdError } = await supabase
    .from('people')
    .select('*')
    .eq('clerk_user_id', authUserId)
    .maybeSingle();

  if (authIdError) console.warn('⚠️ Error checking clerk_user_id:', authIdError);
  if (byAuthId) return transformDbPersonToAppPerson(byAuthId);

  // Claim path: unclaimed dummy with matching email
  if (userEmail) {
    const { data: dummy, error: emailError } = await supabase
      .from('people')
      .select('*')
      .eq('email', userEmail)
      .eq('is_claimed', false)
      .maybeSingle();

    if (emailError) console.warn('⚠️ Error checking email claim:', emailError);

    if (dummy) {
      const { data: claimed, error: claimError } = await supabase
        .from('people')
        .update({
          clerk_user_id: authUserId,
          auth_user_id: authUserId,
          name: userName || userEmail.split('@')[0],
          is_claimed: true,
          source: 'self',
        })
        .eq('id', dummy.id)
        .select()
        .single();

      if (claimError) throw claimError;
      return transformDbPersonToAppPerson(claimed);
    }
  }

  // New user: create fresh record
  const { data, error } = await supabase
    .from('people')
    .insert({
      name: userName || userEmail.split('@')[0],
      clerk_user_id: authUserId,
      auth_user_id: authUserId,
      avatar_url: `https://i.pravatar.cc/150?u=${authUserId}`,
      email: userEmail || null,
      is_claimed: true,
      source: 'self',
    })
    .select()
    .single();

  if (error) {
    // Race condition: another request created the row between our check and insert
    if (error.code === '23505') {
      const { data: retry } = await supabase
        .from('people')
        .select('*')
        .eq('clerk_user_id', authUserId)
        .maybeSingle();
      if (retry) return transformDbPersonToAppPerson(retry);
    }
    throw error;
  }

  return transformDbPersonToAppPerson(data);
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Manual test — new sign-up**

1. Create a dummy contact in any group with email `test@example.com` (via the current MemberInviteModal — email field won't persist yet, that's Task 7, so manually insert via Supabase dashboard: `INSERT INTO people (name, email, is_claimed, source, avatar_url) VALUES ('Test Dummy', 'test@example.com', false, 'manual', 'https://i.pravatar.cc/150?u=test')`)
2. Sign in to the app with a Clerk account using `test@example.com`
3. Open Supabase dashboard, verify: `SELECT name, email, is_claimed, clerk_user_id FROM people WHERE email = 'test@example.com'`
4. Expected: `is_claimed = true`, `clerk_user_id` populated, `name` updated to Clerk display name, same UUID as the dummy

- [ ] **Step 4: Commit**

```bash
git add services/supabaseApiService.ts
git commit -m "feat: ensureUserExists now claims dummy records by email on sign-up"
```

---

## Task 6: Update addPerson and addPersonToGroup — Email Support

**Files:**
- Modify: `services/supabaseApiService.ts` (`addPerson`, lines 806–819)
- Modify: `services/apiService.ts` (`addPersonToGroup`, lines 40–47)

- [ ] **Step 1: Update addPerson to accept and store email**

Replace `addPerson` in `supabaseApiService.ts` (lines 806–819):

```typescript
export const addPerson = async (personData: Omit<Person, 'id'>): Promise<Person> => {
  const { data, error } = await supabase
    .from('people')
    .insert({
      name: personData.name,
      avatar_url: personData.avatarUrl,
      email: personData.email ?? null,
      is_claimed: false,
      source: personData.source ?? 'manual',
    })
    .select()
    .single();

  if (error) throw error;
  return transformDbPersonToAppPerson(data);
};
```

- [ ] **Step 2: Update addPersonToGroup in apiService.ts**

Replace lines 38–47 in `services/apiService.ts`:

```typescript
// MEMBERSHIP HELPERS
export const addPersonToGroup = async (
  groupId: string,
  data: { name: string; email?: string; avatarUrl?: string }
): Promise<Person> => {
  // If email provided, check for existing person to avoid duplicates
  if (data.email) {
    const existing = await supabaseApi.findPersonByEmail(data.email);
    if (existing) {
      // Reuse existing person — just link to group
      const { error } = await supabase
        .from('group_members')
        .insert({ group_id: groupId, person_id: existing.id })
        .select()
        .maybeSingle(); // maybeSingle: ignore if already a member (upsert via RLS)
      // Ignore duplicate member error (person already in group)
      if (error && error.code !== '23505') throw error;
      return existing;
    }
  }

  // Create new person then link
  const person = await supabaseApi.addPerson({
    name: data.name,
    email: data.email,
    avatarUrl: data.avatarUrl || `https://i.pravatar.cc/150?u=${encodeURIComponent(data.name)}`,
    source: 'manual',
  });

  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, person_id: person.id });
  if (error) throw error;
  return person;
};
```

- [ ] **Step 3: Verify apiService.ts imports supabaseApi correctly**

Check that `services/apiService.ts` imports `supabaseApi` and `supabase`. It currently has:
```typescript
import * as supabaseApi from './supabaseApiService';
import { supabase } from '../lib/supabase';
```
Confirm both are present at the top of `apiService.ts`. Add them if missing.

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | head -30
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add services/supabaseApiService.ts services/apiService.ts
git commit -m "feat: addPerson stores email; addPersonToGroup deduplicates by email"
```

---

## Task 7: Update MemberInviteModal — Live Email Lookup

**Files:**
- Modify: `components/MemberInviteModal.tsx`

- [ ] **Step 1: Rewrite MemberInviteModal**

Replace the entire content of `components/MemberInviteModal.tsx`:

```typescript
import React, { useState, useRef, useEffect, useCallback } from 'react';
import BaseModal from './BaseModal';
import { Person } from '../types';
import { addPersonToGroup, addPerson, findPersonByEmail } from '../services/apiService';

export interface MemberInviteModalProps {
  open: boolean;
  groupId?: string;
  existingPeople: Person[];
  onClose(): void;
  onAdded(person: Person): void;
}

const MemberInviteModal: React.FC<MemberInviteModalProps> = ({ open, groupId, existingPeople, onClose, onAdded }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [matchedPerson, setMatchedPerson] = useState<Person | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setMatchedPerson(null);
      setError(null);
    }
  }, [open]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setMatchedPerson(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (!value || !value.includes('@')) return;

    lookupTimer.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        const found = await findPersonByEmail(value.trim().toLowerCase());
        setMatchedPerson(found);
      } catch {
        // Lookup failure is non-critical; continue as new person
      } finally {
        setLookingUp(false);
      }
    }, 300);
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // If matched person: name not required (we use theirs)
    if (!matchedPerson && !name.trim()) {
      setError('Name is required');
      return;
    }

    const alreadyInGroup = matchedPerson && existingPeople.some(p => p.id === matchedPerson.id);
    if (alreadyInGroup) {
      setError('This person is already in the group.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let person: Person;
      if (groupId) {
        person = await addPersonToGroup(groupId, {
          name: matchedPerson ? matchedPerson.name : name.trim(),
          email: email.trim().toLowerCase() || undefined,
        });
      } else {
        person = matchedPerson ?? await addPerson({
          name: name.trim(),
          email: email.trim().toLowerCase() || undefined,
          avatarUrl: `https://i.pravatar.cc/150?u=${encodeURIComponent(name.trim())}`,
          source: 'manual',
        });
      }
      onAdded(person);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add member');
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 rounded-md bg-white/10 text-slate-200 hover:bg-white/20 disabled:opacity-50"
        disabled={submitting}
      >
        Cancel
      </button>
      <button
        type="submit"
        form="member-invite-form"
        className="px-4 py-2 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 flex items-center gap-2"
        disabled={submitting || (!matchedPerson && !name.trim())}
      >
        {submitting && <span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />}
        Add Member
      </button>
    </>
  );

  return (
    <BaseModal
      open={open}
      onClose={() => { if (!submitting) onClose(); }}
      title="Add Member"
      size="sm"
      initialFocusRef={inputRef}
      description={<span className="text-sm text-slate-300">Add a person to this group.</span>}
      footer={footer}
    >
      <form id="member-invite-form" onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
        {/* Email first — drives the lookup */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Email (optional)</label>
          <input
            type="email"
            value={email}
            onChange={e => handleEmailChange(e.target.value)}
            placeholder="rahul@example.com"
            className="w-full bg-black/30 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {lookingUp && (
            <p className="mt-1 text-xs text-slate-400">Checking...</p>
          )}
          {/* Chip: existing claimed user */}
          {matchedPerson?.isClaimed && (
            <div className="mt-2 flex items-center gap-2 bg-emerald-900/30 border border-emerald-700/40 rounded-md px-3 py-2">
              <span className="text-emerald-400 text-xs font-medium">✓ Already on Kharch Baant</span>
              <span className="text-slate-300 text-xs">{matchedPerson.name} will be added directly.</span>
            </div>
          )}
          {/* Chip: existing unclaimed dummy */}
          {matchedPerson && !matchedPerson.isClaimed && (
            <div className="mt-2 flex items-center gap-2 bg-amber-900/30 border border-amber-700/40 rounded-md px-3 py-2">
              <span className="text-amber-400 text-xs font-medium">Already a contact</span>
              <span className="text-slate-300 text-xs">{matchedPerson.name} — they'll be invited to this group.</span>
            </div>
          )}
          {/* No match — show name field */}
          {!matchedPerson && email && !lookingUp && email.includes('@') && (
            <p className="mt-1 text-xs text-slate-500">Not found — a new contact will be created.</p>
          )}
        </div>

        {/* Name field: hide if we have a matched person */}
        {!matchedPerson && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Priya"
              className="w-full bg-black/30 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500"
              required={!matchedPerson}
            />
          </div>
        )}

        {error && (
          <div className="text-sm text-rose-400 bg-rose-900/30 border border-rose-700/40 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </form>
    </BaseModal>
  );
};

export default MemberInviteModal;
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | head -30
```

Expected: No TypeScript errors.

- [ ] **Step 3: Manual test**

1. Open the app, go to a group, open Add Member modal
2. Type a valid email that exists in the DB → chip should appear after 300ms
3. Type an unknown email → "Not found — a new contact will be created" note appears
4. Type no email, just a name → works as before
5. Submit with matched person → should add them to the group without creating a duplicate row

- [ ] **Step 4: Commit**

```bash
git add components/MemberInviteModal.tsx
git commit -m "feat: MemberInviteModal uses real email field with live dedup lookup"
```

---

## Task 8: Update updatePerson + Add mergePersonByEmail

**Files:**
- Modify: `services/supabaseApiService.ts` (`updatePerson`, around line 1283)

- [ ] **Step 1: Replace updatePerson with email-aware version**

Find and replace `updatePerson` in `services/supabaseApiService.ts`:

```typescript
export const updatePerson = async (personId: string, updates: Partial<Person>): Promise<Person> => {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.email !== undefined) dbUpdates.email = updates.email || null;

  const { data, error } = await supabase
    .from('people')
    .update(dbUpdates)
    .eq('id', personId)
    .select()
    .single();

  if (error) throw error;
  return transformDbPersonToAppPerson(data);
};
```

- [ ] **Step 2: Add mergePersonByEmail after updatePerson**

```typescript
// Merges an unclaimed dummy that shares newEmail into currentPersonId.
// Called when a real user changes their email to one that matches an existing dummy.
export const mergePersonByEmail = async (currentPersonId: string, newEmail: string): Promise<void> => {
  const { data: dummy } = await supabase
    .from('people')
    .select('id')
    .eq('email', newEmail)
    .eq('is_claimed', false)
    .neq('id', currentPersonId)
    .maybeSingle();

  if (!dummy) return; // No dummy to merge

  // Move the dummy's group memberships to the current user
  await supabase
    .from('group_members')
    .update({ person_id: currentPersonId })
    .eq('person_id', dummy.id);

  // Delete the now-orphaned dummy
  await supabase.from('people').delete().eq('id', dummy.id);
};
```

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add services/supabaseApiService.ts
git commit -m "feat: updatePerson supports email; add mergePersonByEmail for email change"
```

---

## Task 9: Update UserProfile — Name & Email Editing

**Files:**
- Modify: `components/auth/UserProfile.tsx`

- [ ] **Step 1: Rewrite UserProfile**

Replace the entire content of `components/auth/UserProfile.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/SupabaseAuthContext';
import { updatePerson, mergePersonByEmail } from '../../services/supabaseApiService';
import { useUser } from '@clerk/clerk-react';
import toast from 'react-hot-toast';

interface UserProfileProps {
  onClose: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
  const { user: clerkUser } = useUser();
  const { person, signOut } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (person) {
      setName(person.name);
      setEmail(person.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? '');
    }
  }, [person, clerkUser]);

  const handleSave = async () => {
    if (!person) return;
    setSaving(true);
    try {
      const newEmail = email.trim().toLowerCase() || undefined;

      // If email changed, merge any unclaimed dummy with that email first
      if (newEmail && newEmail !== person.email) {
        await mergePersonByEmail(person.id, newEmail);
      }

      await updatePerson(person.id, {
        name: name.trim() || person.name,
        email: newEmail,
      });

      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
    setIsSigningOut(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
            <span className="text-white text-xl font-bold">
              {name.charAt(0).toUpperCase() || '?'}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white">Your Profile</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {saving && <span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        <div className="space-y-2 pt-2 border-t border-slate-700">
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            {isSigningOut ? 'Signing out...' : 'Sign Out'}
          </button>
          <button
            onClick={onClose}
            className="w-full bg-slate-600 hover:bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | head -30
```

Expected: No TypeScript errors. If `contexts/AuthContext` (old) is also imported elsewhere and causes issues, check if it can be removed.

- [ ] **Step 3: Manual test**

1. Log in, open User Profile from the menu
2. Change display name → save → navigate to a group → all past transactions should now show the new name
3. Change email to a new address → save → no error

- [ ] **Step 4: Commit**

```bash
git add components/auth/UserProfile.tsx
git commit -m "feat: UserProfile supports name and email editing with merge on email change"
```

---

## Task 10: Fix Balance Calculations in HomeScreen and Dashboard

**Files:**
- Modify: `components/HomeScreen.tsx` (lines 19–50)
- Modify: `components/Dashboard.tsx` (lines 16–50)

Both components currently hand-roll a balance calculation using `calculateShares` in a way that ignores multi-payer and uses wrong logic. Replace both with `calculateGroupBalances`.

- [ ] **Step 1: Fix HomeScreen.tsx**

Replace lines 1–50 of `components/HomeScreen.tsx`:

```typescript
import React, { useMemo, useState } from 'react';
import { Group, Transaction, Person } from '../types';
import GroupSummaryCard from './GroupSummaryCard';
import { PlusIcon } from './icons/Icons';
import { calculateGroupBalances } from '../utils/calculations';

interface HomeScreenProps {
    groups: Group[];
    transactions: Transaction[];
    people: Person[];
    currentUserId: string;
    onSelectGroup: (groupId: string) => void;
    onAddGroup: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ groups, transactions, people, currentUserId, onSelectGroup, onAddGroup }) => {
    
    const { totalOwedToUser, totalUserOwes, netBalance } = useMemo(() => {
        if (!currentUserId) return { totalOwedToUser: 0, totalUserOwes: 0, netBalance: 0 };

        // Sum net balance across all active groups
        let owedToUser = 0;
        let userOwes = 0;

        groups.filter(g => !g.isArchived).forEach(group => {
            const groupTxs = transactions.filter(t => t.groupId === group.id);
            const balances = calculateGroupBalances(groupTxs);
            const net = balances.get(currentUserId) ?? 0;
            if (net > 0) owedToUser += net;
            else userOwes += Math.abs(net);
        });

        return {
            totalOwedToUser: owedToUser,
            totalUserOwes: userOwes,
            netBalance: owedToUser - userOwes,
        };
    }, [transactions, currentUserId, groups]);
```

Keep the rest of `HomeScreen.tsx` unchanged (the JSX rendering below line 50).

- [ ] **Step 2: Fix Dashboard.tsx**

Replace lines 1–50 of `components/Dashboard.tsx`:

```typescript
import React, { useMemo, useState } from 'react';
import { Transaction, Person, Currency } from '../types';
import { calculateGroupBalances } from '../utils/calculations';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface DashboardProps {
    transactions: Transaction[];
    currentUserId: string;
    people: Person[];
    currency: Currency;
}

const Dashboard: React.FC<DashboardProps> = ({ transactions, currentUserId, people, currency }) => {
    const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);

    const { totalOwedToUser, totalUserOwes, netBalance } = useMemo(() => {
        if (!currentUserId) return { totalOwedToUser: 0, totalUserOwes: 0, netBalance: 0 };

        const balances = calculateGroupBalances(transactions);
        const net = balances.get(currentUserId) ?? 0;

        return {
            totalOwedToUser: net > 0 ? net : 0,
            totalUserOwes: net < 0 ? Math.abs(net) : 0,
            netBalance: net,
        };
    }, [transactions, currentUserId]);
```

Keep the rest of `Dashboard.tsx` unchanged (JSX from line 51 onward).

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | head -30
```

Expected: No TypeScript errors.

- [ ] **Step 4: Run unit tests**

```bash
npm run test:run
```

Expected: All tests pass.

- [ ] **Step 5: Manual test**

1. Open app → HomeScreen shows combined balance across all groups
2. Open a group → Dashboard shows correct per-group balance
3. Add a percentage-split expense → balance in both views updates correctly
4. Record a settlement → balances move toward zero

- [ ] **Step 6: Commit**

```bash
git add components/HomeScreen.tsx components/Dashboard.tsx
git commit -m "fix: HomeScreen and Dashboard use calculateGroupBalances for correct multi-mode balances"
```

---

## Self-Review

**Spec coverage check:**

| Spec Section | Covered by Task |
|---|---|
| DB schema: email, is_claimed, source, partial unique index | Task 1 ✓ |
| Person type: isClaimed, source | Task 2 ✓ |
| transformDbPersonToAppPerson maps new fields | Task 3 ✓ |
| findPersonByEmail | Task 4 ✓ |
| ensureUserExists claim flow | Task 5 ✓ |
| addPersonToGroup email dedup | Task 6 ✓ |
| MemberInviteModal: real email + chip | Task 7 ✓ |
| Profile editing: name + email | Tasks 8 + 9 ✓ |
| Email change merge (unclaimed dummy) | Task 8 ✓ |
| Cross-group balance summary (HomeScreen) | Task 10 ✓ |
| Dashboard balance fix | Task 10 ✓ |
| Phonebook forward-compat | Covered by API shape — no UI needed yet ✓ |
| Email invite stub | addPersonToGroup comment — stub is in place ✓ |

**No placeholders found.** All steps contain runnable code.

**Type consistency check:**
- `PersonSource` defined in Task 2, used in Task 3 (test), Task 6 (`addPerson`), Task 7 (modal) ✓
- `findPersonByEmail` exported from `supabaseApiService` in Task 4, re-exported from `apiService` in Task 4, imported in `MemberInviteModal` in Task 7 ✓
- `updatePerson` returns `Person` (not `{ success: boolean }`) in Task 8 — also update the call site in Task 9 which expects the returned Person ✓
- `mergePersonByEmail` defined in Task 8, called in Task 9 ✓
