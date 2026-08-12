-- Upsert the signed-in user's claimed people row.
-- Direct INSERT failed when auth_user_id (uuid) was given a Clerk text id,
-- and INSERT ... RETURNING can fail people SELECT RLS. This RPC returns the row.

CREATE OR REPLACE FUNCTION ensure_my_person(p_name text, p_email text DEFAULT NULL)
RETURNS SETOF people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clerk text := requesting_user_id();
  v_name text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
BEGIN
  IF v_clerk IS NULL OR length(trim(v_clerk)) = 0 THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Already claimed this Clerk user
  IF EXISTS (SELECT 1 FROM people WHERE clerk_user_id = v_clerk) THEN
    IF v_name IS NOT NULL OR v_email IS NOT NULL THEN
      UPDATE people
      SET
        name = COALESCE(v_name, name),
        email = COALESCE(v_email, email),
        updated_at = now()
      WHERE clerk_user_id = v_clerk;
    END IF;
    RETURN QUERY SELECT * FROM people WHERE clerk_user_id = v_clerk LIMIT 1;
    RETURN;
  END IF;

  -- Claim unclaimed placeholder with this email
  IF v_email IS NOT NULL THEN
    UPDATE people
    SET
      clerk_user_id = v_clerk,
      user_id = v_clerk,
      name = COALESCE(v_name, name),
      is_claimed = true,
      source = 'self',
      updated_at = now()
    WHERE email = v_email AND is_claimed = false;
    IF FOUND THEN
      RETURN QUERY SELECT * FROM people WHERE clerk_user_id = v_clerk LIMIT 1;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO people (
    name,
    email,
    avatar_url,
    clerk_user_id,
    user_id,
    is_claimed,
    source
  )
  VALUES (
    COALESCE(v_name, split_part(COALESCE(v_email, 'user'), '@', 1)),
    v_email,
    '',
    v_clerk,
    v_clerk,
    true,
    'self'
  )
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_my_person(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION ensure_my_person(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ensure_my_person(text, text) FROM anon;
