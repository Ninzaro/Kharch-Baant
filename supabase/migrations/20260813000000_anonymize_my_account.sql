-- Play Store / GDPR: let the signed-in user anonymize their people row.
-- Transactions stay (paid_by_id has no ON DELETE CASCADE); identity is stripped.
-- Apply on live Supabase after review.

CREATE OR REPLACE FUNCTION anonymize_my_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clerk text := requesting_user_id();
  v_id uuid;
BEGIN
  IF v_clerk IS NULL OR length(trim(v_clerk)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT id INTO v_id
  FROM people
  WHERE clerk_user_id = v_clerk
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'already_gone', true);
  END IF;

  UPDATE people
  SET
    name = 'Deleted user',
    email = NULL,
    avatar_url = '',
    clerk_user_id = NULL,
    auth_user_id = NULL,
    user_id = NULL,
    is_claimed = FALSE,
    source = 'deleted',
    updated_at = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('success', true, 'person_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION anonymize_my_account() TO authenticated;
REVOKE EXECUTE ON FUNCTION anonymize_my_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION anonymize_my_account() FROM anon;
