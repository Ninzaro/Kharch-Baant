-- supabase/migrations/20260412000005_use_clerk_user_id_in_rls.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Root cause of persistent 403 on group INSERT (and similar failures):
--
--   The people table has a `user_id` column that is UUID type (it was
--   designed for Supabase's own auth.users.id).  Our app uses Clerk, whose
--   user IDs are plain text strings like "user_3BcYVO0…" — not valid UUIDs.
--   Comparing a UUID column to requesting_user_id() (which returns text)
--   causes a type-cast failure, so EVERY RLS policy that checks
--   `user_id = requesting_user_id()` silently evaluates to FALSE.
--
--   The correct column to use is `clerk_user_id`, which is TEXT and stores
--   the Clerk JWT sub claim directly.
--
-- Fix: rewrite all helper functions and policies to join/filter on
-- clerk_user_id instead of user_id.

-- ── Step 1: Rewrite SECURITY DEFINER helpers ─────────────────────────────────

-- Is the current user a member of this group?
CREATE OR REPLACE FUNCTION i_am_member_of(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_members gm
    JOIN people p ON gm.person_id = p.id
    WHERE gm.group_id = p_group_id
      AND p.clerk_user_id = requesting_user_id()
  )
$$;

-- Is the current user the creator of this group?
-- groups.created_by may hold a person UUID (app default) or a Clerk user ID
-- (if ever set directly). Handle both.
CREATE OR REPLACE FUNCTION i_created_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM groups g
    WHERE g.id = p_group_id
      AND (
        -- created_by is the Clerk user ID directly
        g.created_by = requesting_user_id()
        OR
        -- created_by is a person UUID; find that person by clerk_user_id
        EXISTS (
          SELECT 1 FROM people
          WHERE id::text = g.created_by
            AND clerk_user_id = requesting_user_id()
        )
      )
  )
$$;

-- ── Step 2: Drop and recreate all policies that referenced user_id ────────────

-- PEOPLE
DROP POLICY IF EXISTS "Authenticated users can view people"  ON people;
DROP POLICY IF EXISTS "Users can insert people"              ON people;
DROP POLICY IF EXISTS "Users can update their people"        ON people;
DROP POLICY IF EXISTS "Users can delete their people"        ON people;

CREATE POLICY "Authenticated users can view people" ON people
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert people" ON people
  FOR INSERT WITH CHECK (
    clerk_user_id = requesting_user_id()
    OR (is_claimed = FALSE AND clerk_user_id IS NULL)
  );

CREATE POLICY "Users can update their people" ON people
  FOR UPDATE USING (clerk_user_id = requesting_user_id());

CREATE POLICY "Users can delete their people" ON people
  FOR DELETE USING (clerk_user_id = requesting_user_id());

-- GROUPS
DROP POLICY IF EXISTS "Users can view their groups"   ON groups;
DROP POLICY IF EXISTS "Users can insert groups"       ON groups;
DROP POLICY IF EXISTS "Users can update their groups" ON groups;
DROP POLICY IF EXISTS "Users can delete their groups" ON groups;

CREATE POLICY "Users can view their groups" ON groups
  FOR SELECT USING (
    created_by = requesting_user_id()
    OR i_am_member_of(id)
    OR EXISTS (
      SELECT 1 FROM people
      WHERE id::text = created_by
        AND clerk_user_id = requesting_user_id()
    )
  );

-- INSERT: accept either form of created_by
CREATE POLICY "Users can insert groups" ON groups
  FOR INSERT WITH CHECK (
    created_by = requesting_user_id()
    OR EXISTS (
      SELECT 1 FROM people
      WHERE id::text = created_by
        AND clerk_user_id = requesting_user_id()
    )
  );

CREATE POLICY "Users can update their groups" ON groups
  FOR UPDATE USING (i_created_group(id));

CREATE POLICY "Users can delete their groups" ON groups
  FOR DELETE USING (i_created_group(id));

-- GROUP MEMBERS (person lookup uses clerk_user_id)
DROP POLICY IF EXISTS "Users can view group members"   ON group_members;
DROP POLICY IF EXISTS "Users can insert group members" ON group_members;
DROP POLICY IF EXISTS "Users can delete group members" ON group_members;

CREATE POLICY "Users can view group members" ON group_members
  FOR SELECT USING (
    i_created_group(group_id)
    OR EXISTS (
      SELECT 1 FROM people p
      WHERE p.id = group_members.person_id
        AND p.clerk_user_id = requesting_user_id()
    )
  );

CREATE POLICY "Users can insert group members" ON group_members
  FOR INSERT WITH CHECK (i_created_group(group_id));

CREATE POLICY "Users can delete group members" ON group_members
  FOR DELETE USING (i_created_group(group_id));

-- TRANSACTIONS (no direct people reference needed — uses helpers)
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

-- PAYMENT SOURCES
DROP POLICY IF EXISTS "Users can view own payment sources"   ON payment_sources;
DROP POLICY IF EXISTS "Users can insert payment sources"     ON payment_sources;
DROP POLICY IF EXISTS "Users can update own payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can delete own payment sources" ON payment_sources;

-- payment_sources.user_id is also likely UUID; use a clerk_user_id lookup
-- via the people table if necessary. But since payment_sources stores
-- the person UUID in user_id, we compare via people.
CREATE POLICY "Users can view own payment sources" ON payment_sources
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM people WHERE id::text = payment_sources.user_id AND clerk_user_id = requesting_user_id())
    OR payment_sources.user_id = requesting_user_id()
  );

CREATE POLICY "Users can insert payment sources" ON payment_sources
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM people WHERE id::text = payment_sources.user_id AND clerk_user_id = requesting_user_id())
    OR payment_sources.user_id = requesting_user_id()
  );

CREATE POLICY "Users can update own payment sources" ON payment_sources
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM people WHERE id::text = payment_sources.user_id AND clerk_user_id = requesting_user_id())
    OR payment_sources.user_id = requesting_user_id()
  );

CREATE POLICY "Users can delete own payment sources" ON payment_sources
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM people WHERE id::text = payment_sources.user_id AND clerk_user_id = requesting_user_id())
    OR payment_sources.user_id = requesting_user_id()
  );
