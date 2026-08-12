-- Allow signed-in users to add a placeholder contact and receive the row back.
-- Direct INSERT ... RETURNING fails: people SELECT uses i_can_see_person(),
-- and a brand-new unclaimed row is not visible yet (not self, not a co-member).
-- PostgREST then surfaces: new row violates row-level security policy for table "people".

CREATE OR REPLACE FUNCTION create_unclaimed_person(
  p_name text,
  p_email text DEFAULT NULL,
  p_avatar_url text DEFAULT ''
)
RETURNS SETOF people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF requesting_user_id() IS NULL OR length(trim(requesting_user_id())) = 0 THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Name required' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  INSERT INTO people (
    name,
    email,
    avatar_url,
    is_claimed,
    clerk_user_id,
    source
  )
  VALUES (
    trim(p_name),
    NULLIF(lower(trim(COALESCE(p_email, ''))), ''),
    COALESCE(p_avatar_url, ''),
    false,
    NULL,
    'manual'
  )
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION create_unclaimed_person(text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION create_unclaimed_person(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_unclaimed_person(text, text, text) FROM anon;
