-- supabase/migrations/20260412000001_fix_rls_and_backfill_user_id.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Two problems fixed here:
--
-- 1. Backfill user_id on existing person records.
--    The app sets clerk_user_id but the RLS policies check user_id.
--    All existing rows where user_id is NULL but clerk_user_id is set
--    get backfilled so they become visible to their owners.
--
-- 2. Enable RLS on all tables (in case it was disabled).
--    Without ALTER TABLE ... ENABLE ROW LEVEL SECURITY, the policies
--    exist but are not enforced — everyone sees everything.

-- ── Step 1: Backfill user_id from clerk_user_id ──────────────────────────────
UPDATE people
SET user_id = clerk_user_id
WHERE clerk_user_id IS NOT NULL
  AND (user_id IS NULL OR user_id != clerk_user_id);

-- ── Step 2: Enable RLS on every table ───────────────────────────────────────
ALTER TABLE people          ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sources ENABLE ROW LEVEL SECURITY;

-- ── Step 3: Ensure the requesting_user_id() helper exists ───────────────────
-- (safe to re-run; idempotent)
CREATE OR REPLACE FUNCTION requesting_user_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')
$$ LANGUAGE sql STABLE;

-- ── Step 4: Re-create RLS policies (drop first to avoid duplicates) ──────────

-- PEOPLE
DROP POLICY IF EXISTS "Users can view people in their groups"   ON people;
DROP POLICY IF EXISTS "Users can insert people"                 ON people;
DROP POLICY IF EXISTS "Users can update their people"           ON people;
DROP POLICY IF EXISTS "Authenticated users can view unclaimed people"   ON people;
DROP POLICY IF EXISTS "Authenticated users can claim unclaimed people"  ON people;

CREATE POLICY "Users can view people in their groups" ON people
  FOR SELECT USING (
    user_id = requesting_user_id()
    OR EXISTS (
      SELECT 1 FROM group_members gm
      JOIN groups g ON gm.group_id = g.id
      WHERE g.created_by = requesting_user_id()
        AND gm.person_id = people.id
    )
  );

-- Allow inserting both self-registered users (user_id set) and dummy contacts
-- (user_id matches the creator — set in application code)
CREATE POLICY "Users can insert people" ON people
  FOR INSERT WITH CHECK (
    user_id = requesting_user_id()
    OR (is_claimed = FALSE AND user_id IS NULL)
  );

CREATE POLICY "Users can update their people" ON people
  FOR UPDATE USING (user_id = requesting_user_id());

-- GROUPS
DROP POLICY IF EXISTS "Users can view their groups"   ON groups;
DROP POLICY IF EXISTS "Users can insert groups"       ON groups;
DROP POLICY IF EXISTS "Users can update their groups" ON groups;
DROP POLICY IF EXISTS "Users can delete their groups" ON groups;

CREATE POLICY "Users can view their groups" ON groups
  FOR SELECT USING (
    created_by = requesting_user_id()
    OR EXISTS (
      SELECT 1 FROM group_members gm
      JOIN people p ON gm.person_id = p.id
      WHERE gm.group_id = groups.id
        AND p.user_id = requesting_user_id()
    )
  );

CREATE POLICY "Users can insert groups"       ON groups FOR INSERT WITH CHECK (created_by = requesting_user_id());
CREATE POLICY "Users can update their groups" ON groups FOR UPDATE USING     (created_by = requesting_user_id());
CREATE POLICY "Users can delete their groups" ON groups FOR DELETE USING     (created_by = requesting_user_id());

-- GROUP MEMBERS
DROP POLICY IF EXISTS "Users can view group members"   ON group_members;
DROP POLICY IF EXISTS "Users can insert group members" ON group_members;
DROP POLICY IF EXISTS "Users can delete group members" ON group_members;

CREATE POLICY "Users can view group members" ON group_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.created_by = requesting_user_id())
    OR EXISTS (SELECT 1 FROM people p WHERE p.id = group_members.person_id AND p.user_id = requesting_user_id())
  );

CREATE POLICY "Users can insert group members" ON group_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.created_by = requesting_user_id())
  );

CREATE POLICY "Users can delete group members" ON group_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.created_by = requesting_user_id())
  );

-- TRANSACTIONS
DROP POLICY IF EXISTS "Users can view group transactions"   ON transactions;
DROP POLICY IF EXISTS "Users can insert group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can update group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can delete group transactions" ON transactions;

CREATE POLICY "Users can view group transactions" ON transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM groups g WHERE g.id = transactions.group_id AND (
        g.created_by = requesting_user_id()
        OR EXISTS (
          SELECT 1 FROM group_members gm JOIN people p ON gm.person_id = p.id
          WHERE gm.group_id = g.id AND p.user_id = requesting_user_id()
        )
      )
    )
  );

CREATE POLICY "Users can insert group transactions" ON transactions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM groups g WHERE g.id = transactions.group_id AND (
        g.created_by = requesting_user_id()
        OR EXISTS (
          SELECT 1 FROM group_members gm JOIN people p ON gm.person_id = p.id
          WHERE gm.group_id = g.id AND p.user_id = requesting_user_id()
        )
      )
    )
  );

CREATE POLICY "Users can update group transactions" ON transactions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM groups g WHERE g.id = transactions.group_id AND (
        g.created_by = requesting_user_id()
        OR EXISTS (
          SELECT 1 FROM group_members gm JOIN people p ON gm.person_id = p.id
          WHERE gm.group_id = g.id AND p.user_id = requesting_user_id()
        )
      )
    )
  );

CREATE POLICY "Users can delete group transactions" ON transactions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = transactions.group_id AND g.created_by = requesting_user_id())
  );

-- PAYMENT SOURCES
DROP POLICY IF EXISTS "Users can view own payment sources"   ON payment_sources;
DROP POLICY IF EXISTS "Users can insert payment sources"     ON payment_sources;
DROP POLICY IF EXISTS "Users can update own payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can delete own payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can view their payment sources"   ON payment_sources;
DROP POLICY IF EXISTS "Users can insert their payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can update their payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can delete their payment sources" ON payment_sources;

CREATE POLICY "Users can view own payment sources"   ON payment_sources FOR SELECT USING     (user_id = requesting_user_id());
CREATE POLICY "Users can insert payment sources"     ON payment_sources FOR INSERT WITH CHECK (user_id = requesting_user_id());
CREATE POLICY "Users can update own payment sources" ON payment_sources FOR UPDATE USING     (user_id = requesting_user_id());
CREATE POLICY "Users can delete own payment sources" ON payment_sources FOR DELETE USING     (user_id = requesting_user_id());
