-- supabase/migrations/20260412000002_fix_rls_recursion_and_claim_type.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Fixes two problems introduced by migration 20260412000001:
--
-- 1. Infinite recursion in RLS policies.
--    groups SELECT policy queries group_members → group_members SELECT policy
--    queries groups AND people → people SELECT policy queries group_members →
--    infinite loop. Fix: wrap ALL cross-table references in SECURITY DEFINER
--    helper functions. SECURITY DEFINER functions bypass RLS, so they never
--    trigger another table's RLS policies — the cycle is broken.
--
-- 2. claim_person_by_email() sets auth_user_id = p_clerk_id, but auth_user_id
--    is type UUID and Clerk IDs are plain text (e.g. "user_3BcYVO0...").
--    Fix: remove the auth_user_id assignment; our RLS policies only check
--    user_id (text), so auth_user_id is not needed here.

-- ── Step 1: SECURITY DEFINER helpers ────────────────────────────────────────
-- These bypass RLS entirely, so calling them from a policy never triggers
-- another table's RLS check — breaking all circular dependencies.

-- Is the current user the creator of this group?
CREATE OR REPLACE FUNCTION i_created_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM groups
    WHERE id = p_group_id AND created_by = requesting_user_id()
  )
$$;

-- Is the current user a member of this group (via people.user_id)?
CREATE OR REPLACE FUNCTION i_am_member_of(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members gm
    JOIN people p ON gm.person_id = p.id
    WHERE gm.group_id = p_group_id
      AND p.user_id = requesting_user_id()
  )
$$;

-- Can the current user see this person?
-- True if the person is in any group the current user created or is a member of.
CREATE OR REPLACE FUNCTION i_can_see_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.person_id = p_person_id
      AND (
        -- I created the group
        EXISTS (SELECT 1 FROM groups WHERE id = gm.group_id AND created_by = requesting_user_id())
        OR
        -- I'm a member of the group
        EXISTS (
          SELECT 1 FROM group_members gm2
          JOIN people p2 ON gm2.person_id = p2.id
          WHERE gm2.group_id = gm.group_id AND p2.user_id = requesting_user_id()
        )
      )
  )
$$;

-- Is this person_id the current user's own people record?
CREATE OR REPLACE FUNCTION i_am_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM people WHERE id = p_person_id AND user_id = requesting_user_id()
  )
$$;

-- Grant helpers to authenticated users
GRANT EXECUTE ON FUNCTION i_created_group(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION i_am_member_of(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION i_can_see_person(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION i_am_person(uuid)          TO authenticated;

-- ── Step 2: Re-create policies using helpers (no inline cross-table RLS) ─────

-- PEOPLE
DROP POLICY IF EXISTS "Users can view people in their groups" ON people;
DROP POLICY IF EXISTS "Users can insert people"               ON people;
DROP POLICY IF EXISTS "Users can update their people"         ON people;

CREATE POLICY "Users can view people in their groups" ON people
  FOR SELECT USING (
    user_id = requesting_user_id()
    OR i_can_see_person(id)
  );

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
    OR i_am_member_of(id)
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
    i_created_group(group_id)
    OR i_am_person(person_id)
  );

CREATE POLICY "Users can insert group members" ON group_members
  FOR INSERT WITH CHECK (i_created_group(group_id));

CREATE POLICY "Users can delete group members" ON group_members
  FOR DELETE USING (i_created_group(group_id));

-- TRANSACTIONS
DROP POLICY IF EXISTS "Users can view group transactions"   ON transactions;
DROP POLICY IF EXISTS "Users can insert group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can update group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can delete group transactions" ON transactions;

CREATE POLICY "Users can view group transactions" ON transactions
  FOR SELECT USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Users can insert group transactions" ON transactions
  FOR INSERT WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Users can update group transactions" ON transactions
  FOR UPDATE USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Users can delete group transactions" ON transactions
  FOR DELETE USING (i_created_group(group_id));

-- PAYMENT SOURCES (no cross-table references; no change needed, but drop/recreate for safety)
DROP POLICY IF EXISTS "Users can view own payment sources"   ON payment_sources;
DROP POLICY IF EXISTS "Users can insert payment sources"     ON payment_sources;
DROP POLICY IF EXISTS "Users can update own payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can delete own payment sources" ON payment_sources;

CREATE POLICY "Users can view own payment sources"   ON payment_sources FOR SELECT USING     (user_id = requesting_user_id());
CREATE POLICY "Users can insert payment sources"     ON payment_sources FOR INSERT WITH CHECK (user_id = requesting_user_id());
CREATE POLICY "Users can update own payment sources" ON payment_sources FOR UPDATE USING     (user_id = requesting_user_id());
CREATE POLICY "Users can delete own payment sources" ON payment_sources FOR DELETE USING     (user_id = requesting_user_id());

-- ── Step 3: Fix claim_person_by_email — remove auth_user_id (it's uuid, Clerk IDs are text) ──
CREATE OR REPLACE FUNCTION claim_person_by_email(
  p_email    TEXT,
  p_clerk_id TEXT,
  p_name     TEXT
)
RETURNS SETOF people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE people
  SET
    clerk_user_id = p_clerk_id,
    user_id       = p_clerk_id,
    name          = COALESCE(NULLIF(trim(p_name), ''), name),
    is_claimed    = TRUE,
    source        = 'self'
  WHERE
    email      = lower(trim(p_email))
    AND is_claimed = FALSE
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) TO authenticated;
