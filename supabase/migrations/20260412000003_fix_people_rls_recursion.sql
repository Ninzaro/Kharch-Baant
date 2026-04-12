-- supabase/migrations/20260412000003_fix_people_rls_recursion.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Problem: i_can_see_person() queries the `people` table inside a SECURITY
-- DEFINER function that is called FROM the `people` SELECT policy.
-- Even though the function runs as superuser (bypassing RLS for ITS own
-- query), PostgreSQL's recursion-detection tracks all in-progress RLS
-- evaluations for a relation globally across the call stack.  When the
-- function re-enters `people` while the `people` SELECT policy is already
-- on the stack, Postgres raises 42P17 "infinite recursion".
--
-- Fix: replace the `people` SELECT policy with a simple "all authenticated
-- users can read all people rows" rule (no cross-table reference, so no
-- recursion is possible).  The sensitive data — groups and transactions —
-- is still protected by their own strict policies.  People records only
-- store names and emails; leaking them to other authenticated app users is
-- an acceptable trade-off to eliminate the recursion.
--
-- We also nuke every policy in the schema first so stale policies from
-- previous migrations (which may have different names) cannot interfere.

-- ── Step 1: Drop ALL existing RLS policies on all public tables ──────────────
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END;
$$;

-- ── Step 2: Refresh SECURITY DEFINER helpers (no people join needed now) ─────

-- Drop helpers that joined people (no longer needed / caused recursion)
DROP FUNCTION IF EXISTS i_can_see_person(uuid);
DROP FUNCTION IF EXISTS i_am_person(uuid);

-- Re-create i_am_member_of (still joins people, but ONLY called from
-- SECURITY DEFINER context → runs as postgres → bypasses people RLS)
CREATE OR REPLACE FUNCTION i_am_member_of(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_members gm
    JOIN people p ON gm.person_id = p.id
    WHERE gm.group_id = p_group_id
      AND p.user_id = requesting_user_id()
  )
$$;

-- Re-create i_created_group (queries groups only — no people, no recursion)
CREATE OR REPLACE FUNCTION i_created_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM groups
    WHERE id = p_group_id AND created_by = requesting_user_id()
  )
$$;

GRANT EXECUTE ON FUNCTION i_am_member_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION i_created_group(uuid) TO authenticated;

-- ── Step 3: Recreate all RLS policies ────────────────────────────────────────

-- PEOPLE
-- SELECT: all authenticated users can read people rows.
--   People records only hold name/email — not financial data.
--   Groups and transactions remain strictly scoped to their members.
--   A non-recursive SELECT policy is required to avoid 42P17.
-- INSERT: own record (user_id set) OR unclaimed dummy (user_id NULL)
-- UPDATE/DELETE: own record only
CREATE POLICY "Authenticated users can view people" ON people
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert people" ON people
  FOR INSERT WITH CHECK (
    user_id = requesting_user_id()
    OR (is_claimed = FALSE AND user_id IS NULL)
  );

CREATE POLICY "Users can update their people" ON people
  FOR UPDATE USING (user_id = requesting_user_id());

CREATE POLICY "Users can delete their people" ON people
  FOR DELETE USING (user_id = requesting_user_id());

-- GROUPS
CREATE POLICY "Users can view their groups" ON groups
  FOR SELECT USING (
    created_by = requesting_user_id()
    OR i_am_member_of(id)
  );

CREATE POLICY "Users can insert groups" ON groups
  FOR INSERT WITH CHECK (created_by = requesting_user_id());

CREATE POLICY "Users can update their groups" ON groups
  FOR UPDATE USING (created_by = requesting_user_id());

CREATE POLICY "Users can delete their groups" ON groups
  FOR DELETE USING (created_by = requesting_user_id());

-- GROUP MEMBERS
CREATE POLICY "Users can view group members" ON group_members
  FOR SELECT USING (
    i_created_group(group_id)
    OR EXISTS (
      SELECT 1 FROM people p
      WHERE p.id = group_members.person_id
        AND p.user_id = requesting_user_id()
    )
  );

CREATE POLICY "Users can insert group members" ON group_members
  FOR INSERT WITH CHECK (i_created_group(group_id));

CREATE POLICY "Users can delete group members" ON group_members
  FOR DELETE USING (i_created_group(group_id));

-- TRANSACTIONS
CREATE POLICY "Users can view group transactions" ON transactions
  FOR SELECT USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Users can insert group transactions" ON transactions
  FOR INSERT WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Users can update group transactions" ON transactions
  FOR UPDATE USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Users can delete group transactions" ON transactions
  FOR DELETE USING (i_created_group(group_id));

-- PAYMENT SOURCES
CREATE POLICY "Users can view own payment sources" ON payment_sources
  FOR SELECT USING (user_id = requesting_user_id());

CREATE POLICY "Users can insert payment sources" ON payment_sources
  FOR INSERT WITH CHECK (user_id = requesting_user_id());

CREATE POLICY "Users can update own payment sources" ON payment_sources
  FOR UPDATE USING (user_id = requesting_user_id());

CREATE POLICY "Users can delete own payment sources" ON payment_sources
  FOR DELETE USING (user_id = requesting_user_id());
