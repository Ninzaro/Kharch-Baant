-- R-02 correct fix: a placeholder is claimed only when the session JWT
-- carries the same email and email_verified=true. p_email is not an
-- identity source. claim_person_by_email stays non-executable by clients.

CREATE OR REPLACE FUNCTION app_private.verified_jwt_email()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN claims IS NULL THEN NULL
    WHEN lower(coalesce(claims->>'email_verified', '')) NOT IN ('true', 't', '1')
      THEN NULL
    ELSE nullif(lower(trim(claims->>'email')), '')
  END
  FROM (
    SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb AS claims
  ) s;
$$;

REVOKE ALL ON FUNCTION app_private.verified_jwt_email() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_my_person(p_name text, p_email text DEFAULT NULL)
RETURNS SETOF public.people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk text := public.requesting_user_id();
  v_name text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_arg_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_email text := app_private.verified_jwt_email();
  v_placeholder uuid;
BEGIN
  IF v_clerk IS NULL OR length(trim(v_clerk)) = 0 THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_arg_email IS NOT NULL AND v_email IS NOT NULL AND v_arg_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Email does not match the verified session' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.people WHERE clerk_user_id = v_clerk) THEN
    IF v_email IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.people
      WHERE lower(trim(email)) = v_email
        AND clerk_user_id IS DISTINCT FROM v_clerk
    ) THEN
      v_email := NULL;
    END IF;

    UPDATE public.people
    SET
      name = COALESCE(v_name, name),
      email = COALESCE(v_email, email),
      updated_at = now()
    WHERE clerk_user_id = v_clerk;

    RETURN QUERY
      SELECT * FROM public.people WHERE clerk_user_id = v_clerk LIMIT 1;
    RETURN;
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT id INTO v_placeholder
    FROM public.people
    WHERE lower(trim(email)) = v_email
      AND COALESCE(is_claimed, false) = false
      AND clerk_user_id IS NULL
    FOR UPDATE;

    IF v_placeholder IS NOT NULL THEN
      UPDATE public.people
      SET
        clerk_user_id = v_clerk,
        user_id = v_clerk,
        name = COALESCE(v_name, name),
        is_claimed = true,
        source = 'self',
        updated_at = now()
      WHERE id = v_placeholder;

      RETURN QUERY SELECT * FROM public.people WHERE id = v_placeholder;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.people WHERE lower(trim(email)) = v_email
    ) THEN
      v_email := NULL;
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO public.people (
    name, email, avatar_url, clerk_user_id, user_id, is_claimed, source
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

REVOKE EXECUTE ON FUNCTION public.ensure_my_person(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_person(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_person_by_email(
  p_email text,
  p_clerk_id text,
  p_name text
)
RETURNS SETOF public.people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk text := public.requesting_user_id();
  v_arg_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_email text := app_private.verified_jwt_email();
BEGIN
  IF v_clerk IS NULL OR length(trim(v_clerk)) = 0 THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_clerk_id IS NOT NULL
     AND length(trim(p_clerk_id)) > 0
     AND trim(p_clerk_id) IS DISTINCT FROM v_clerk THEN
    RAISE EXCEPTION 'clerk_id mismatch' USING ERRCODE = '42501';
  END IF;

  IF v_email IS NULL
     OR v_arg_email IS NULL
     OR v_arg_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Email does not match the verified session' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.people
  SET
    clerk_user_id = v_clerk,
    user_id = v_clerk,
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    is_claimed = true,
    source = 'self',
    updated_at = now()
  WHERE lower(trim(email)) = v_email
    AND COALESCE(is_claimed, false) = false
    AND clerk_user_id IS NULL
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_person_by_email(text, text, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
