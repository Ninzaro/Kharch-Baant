-- supabase/migrations/20260412000000_add_claim_person_function.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Adds a SECURITY DEFINER function so the claim flow can find and update
-- unclaimed dummy person records, bypassing RLS (which would otherwise block
-- the UPDATE because the dummy has user_id = NULL).
--
-- Security properties:
--   - Only touches rows where is_claimed = false AND email = p_email
--   - Caller supplies their own clerk_user_id — the function sets it on the row
--   - A claimed row can never be reclaimed (is_claimed = false check)

CREATE OR REPLACE FUNCTION claim_person_by_email(
  p_email       TEXT,
  p_clerk_id    TEXT,
  p_name        TEXT
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
    auth_user_id  = p_clerk_id,
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

-- Allow authenticated users (Clerk JWT holders) to call this function
GRANT EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) TO authenticated;
