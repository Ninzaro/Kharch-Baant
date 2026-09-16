-- R-08: the invite lookup needs only a person's id, display name, and claim state.
-- It must never return email, avatar data, Clerk identifiers, or profile metadata.

DROP FUNCTION IF EXISTS public.find_person_by_email(text);

CREATE FUNCTION public.find_person_by_email(p_email text)
RETURNS TABLE(id uuid, name text, is_claimed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.is_claimed
  FROM public.people AS p
  WHERE requesting_user_id() IS NOT NULL
    AND p.email IS NOT NULL
    AND lower(trim(p.email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.find_person_by_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_person_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_person_by_email(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
