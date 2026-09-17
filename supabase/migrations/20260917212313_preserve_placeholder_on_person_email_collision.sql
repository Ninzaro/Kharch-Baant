-- Preserve existing people rows when a new Clerk identity uses the same email.
-- R-02 containment forbids automatic placeholder claiming; the new person is
-- created without an email when the normalized address is already present.

CREATE OR REPLACE FUNCTION public.ensure_my_person(p_name text, p_email text DEFAULT NULL)
RETURNS SETOF public.people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk text := public.requesting_user_id();
  v_name text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
  v_email_for_update text;
  v_email_for_insert text;
BEGIN
  IF v_clerk IS NULL OR length(trim(v_clerk)) = 0 THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.people WHERE clerk_user_id = v_clerk) THEN
    v_email_for_update := v_email;
    IF v_email IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.people
      WHERE lower(trim(email)) = v_email
        AND clerk_user_id IS DISTINCT FROM v_clerk
    ) THEN
      v_email_for_update := NULL;
    END IF;

    IF v_name IS NOT NULL OR v_email IS NOT NULL THEN
      UPDATE public.people
      SET
        name = COALESCE(v_name, name),
        email = COALESCE(v_email_for_update, email),
        updated_at = now()
      WHERE clerk_user_id = v_clerk;
    END IF;
    RETURN QUERY
      SELECT * FROM public.people WHERE clerk_user_id = v_clerk LIMIT 1;
    RETURN;
  END IF;

  v_email_for_insert := v_email;
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.people
    WHERE lower(trim(email)) = v_email
  ) THEN
    v_email_for_insert := NULL;
  END IF;

  RETURN QUERY
  INSERT INTO public.people (
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
    v_email_for_insert,
    '',
    v_clerk,
    v_clerk,
    true,
    'self'
  )
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_my_person(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_my_person(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_person(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
