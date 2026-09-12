-- Re-apply group INSERT policy (idempotent). Run in SQL editor if create-group
-- still returns 42501 after 20260912000005.

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
  FOR INSERT
  TO authenticated
  WITH CHECK (i_own_person(created_by));

NOTIFY pgrst, 'reload schema';
