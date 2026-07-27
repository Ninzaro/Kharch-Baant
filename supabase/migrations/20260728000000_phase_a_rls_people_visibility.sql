-- Phase A security: tighten people visibility + audit helpers
-- Apply via Supabase SQL Editor (or CLI) on production after review.
--
-- Goals:
--   1. Drop any leftover "Allow all operations" / open policies
--   2. Ensure RLS is ENABLED on all core tables
--   3. people SELECT: self + co-members of shared groups + active invite inviters
--      (avoids infinite recursion via SECURITY DEFINER helpers)
--   4. find_person_by_email RPC for invite UX without full-table SELECT

-- ── 0. Ensure RLS is on ─────────────────────────────────────────────────────
ALTER TABLE IF EXISTS people ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS group_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ai_item_cache ENABLE ROW LEVEL SECURITY;

-- ── 1. Drop dangerous open policies if present ──────────────────────────────
DROP POLICY IF EXISTS "Allow all operations" ON people;
DROP POLICY IF EXISTS "Allow all operations" ON groups;
DROP POLICY IF EXISTS "Allow all operations" ON group_members;
DROP POLICY IF EXISTS "Allow all operations" ON transactions;
DROP POLICY IF EXISTS "Allow all operations" ON payment_sources;

-- ── 2. Visibility helper (SECURITY DEFINER → bypasses people RLS, no recursion) ─
CREATE OR REPLACE FUNCTION i_can_see_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Own claimed row
    EXISTS (
      SELECT 1 FROM people p
      WHERE p.id = p_person_id
        AND p.clerk_user_id IS NOT NULL
        AND p.clerk_user_id = requesting_user_id()
    )
    OR
    -- Share at least one group membership
    EXISTS (
      SELECT 1
      FROM group_members my_gm
      JOIN people me ON me.id = my_gm.person_id
      JOIN group_members their_gm
        ON their_gm.group_id = my_gm.group_id
       AND their_gm.person_id = p_person_id
      WHERE me.clerk_user_id = requesting_user_id()
    )
    OR
    -- Group I created includes this person (creator may not always appear as member)
    EXISTS (
      SELECT 1
      FROM group_members gm
      WHERE gm.person_id = p_person_id
        AND i_created_group(gm.group_id)
    )
    OR
    -- Active invite inviter (needed for invite landing UX before join)
    EXISTS (
      SELECT 1 FROM group_invites gi
      WHERE gi.invited_by = p_person_id
        AND COALESCE(gi.is_active, true) = true
        AND gi.expires_at > now()
    );
$$;

GRANT EXECUTE ON FUNCTION i_can_see_person(uuid) TO authenticated;

-- ── 3. Replace open people SELECT ───────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can view people" ON people;
DROP POLICY IF EXISTS "Users can view related people" ON people;

CREATE POLICY "Users can view related people" ON people
  FOR SELECT TO authenticated
  USING (i_can_see_person(id));

-- Keep insert/update/delete policies if they already exist from prior migrations.
-- Recreate only if missing (safe IF EXISTS drops then create).

DROP POLICY IF EXISTS "Users can insert people" ON people;
CREATE POLICY "Users can insert people" ON people
  FOR INSERT WITH CHECK (
    clerk_user_id = requesting_user_id()
    OR (COALESCE(is_claimed, false) = false AND clerk_user_id IS NULL)
  );

DROP POLICY IF EXISTS "Users can update their people" ON people;
CREATE POLICY "Users can update their people" ON people
  FOR UPDATE USING (clerk_user_id = requesting_user_id());

DROP POLICY IF EXISTS "Users can delete their people" ON people;
CREATE POLICY "Users can delete their people" ON people
  FOR DELETE USING (clerk_user_id = requesting_user_id());

-- ── 4. Email lookup for invite (exact match only; no full table dump) ───────
CREATE OR REPLACE FUNCTION find_person_by_email(p_email text)
RETURNS SETOF people
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM people
  WHERE email IS NOT NULL
    AND lower(trim(email)) = lower(trim(p_email))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION find_person_by_email(text) TO authenticated;

-- ── 5. Audit query (run manually; does not change state) ────────────────────
-- SELECT tablename, rowsecurity
-- FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
--
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
--
-- Dangerous if you still see:
--   - rowsecurity = false on core tables
--   - policyname = 'Allow all operations'
--   - people SELECT with qual = 'true' and no i_can_see_person
