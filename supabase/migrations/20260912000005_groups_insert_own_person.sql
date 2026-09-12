-- Fix group INSERT after D-03: WITH CHECK that SELECTs people is subject to
-- people RLS. A user with no groups can fail to "see" their own row in that
-- subquery, so create-group returns 42501.
-- Use a SECURITY DEFINER helper that only succeeds for the JWT's people.id.

CREATE OR REPLACE FUNCTION i_own_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM people p
    WHERE p.id = p_person_id
      AND p.clerk_user_id IS NOT NULL
      AND p.clerk_user_id = requesting_user_id()
  )
$$;

GRANT EXECUTE ON FUNCTION i_own_person(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION i_own_person(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION i_own_person(uuid) FROM anon;

DROP POLICY IF EXISTS "Users can insert groups" ON groups;
CREATE POLICY "Users can insert groups" ON groups
  FOR INSERT WITH CHECK (i_own_person(created_by));
