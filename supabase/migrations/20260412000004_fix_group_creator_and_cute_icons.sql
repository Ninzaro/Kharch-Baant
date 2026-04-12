-- supabase/migrations/20260412000004_fix_group_creator_and_cute_icons.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Fixes two things:
--
-- 1. Group INSERT/UPDATE/DELETE failing with RLS violation.
--    The app stores groups.created_by = person.id (UUID, e.g. "2c134a55-...").
--    The RLS policies check created_by = requesting_user_id() which returns
--    the Clerk JWT sub — a text string like "user_3BcYVO0...".
--    UUID ≠ Clerk ID → INSERT blocked. Fix: update i_created_group() and the
--    direct INSERT policy to accept both forms.
--
-- 2. Add enable_cute_icons column to groups so the per-group emoji toggle
--    is persisted to the database (previously it was a frontend-only field).

-- ── Step 1: Add enable_cute_icons column ─────────────────────────────────────
ALTER TABLE groups ADD COLUMN IF NOT EXISTS enable_cute_icons BOOLEAN NOT NULL DEFAULT TRUE;

-- ── Step 2: Fix i_created_group() to handle both UUID and Clerk ID formats ───
CREATE OR REPLACE FUNCTION i_created_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM groups g
    WHERE g.id = p_group_id
      AND (
        -- Clerk user ID stored directly
        g.created_by = requesting_user_id()
        OR
        -- Person UUID stored — look up the matching person
        EXISTS (
          SELECT 1 FROM people
          WHERE id::text = g.created_by
            AND user_id = requesting_user_id()
        )
      )
  )
$$;

-- ── Step 3: Fix groups INSERT/UPDATE/DELETE policies ─────────────────────────
DROP POLICY IF EXISTS "Users can insert groups" ON groups;
DROP POLICY IF EXISTS "Users can update their groups" ON groups;
DROP POLICY IF EXISTS "Users can delete their groups" ON groups;

-- INSERT: accept person UUID or Clerk user ID in created_by
CREATE POLICY "Users can insert groups" ON groups
  FOR INSERT WITH CHECK (
    created_by = requesting_user_id()
    OR EXISTS (
      SELECT 1 FROM people
      WHERE id::text = created_by
        AND user_id = requesting_user_id()
    )
  );

-- UPDATE / DELETE: delegate to the corrected helper
CREATE POLICY "Users can update their groups" ON groups
  FOR UPDATE USING (i_created_group(id));

CREATE POLICY "Users can delete their groups" ON groups
  FOR DELETE USING (i_created_group(id));
