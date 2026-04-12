-- supabase/migrations/20260412000007_fix_group_members_visibility.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Problem: Members cannot see other members of groups they belong to.
--
--   The group_members SELECT policy only allows seeing rows where:
--     1. You are the group creator (i_created_group)
--     2. OR the row's person_id is YOU (your own membership row)
--
--   This means when getPeople() queries group_members to find co-members,
--   User B only gets their own row back — they cannot see User A or anyone else.
--
-- Fix: replace condition 2 with i_am_member_of(group_id), which returns TRUE
--   for any group you belong to, allowing you to see all members of that group.
--   i_am_member_of is SECURITY DEFINER so it queries group_members as postgres
--   (bypasses RLS), preventing infinite recursion.

DROP POLICY IF EXISTS "Users can view group members" ON group_members;

CREATE POLICY "Users can view group members" ON group_members
  FOR SELECT USING (
    i_created_group(group_id)
    OR i_am_member_of(group_id)
  );
