-- Edge functions call PostgREST, which does not expose app_private.
-- This wrapper is executable only by service_role.

CREATE OR REPLACE FUNCTION public.consume_budget(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.consume_budget(p_bucket, p_subject, p_max, p_window_seconds);
$$;

REVOKE ALL ON FUNCTION public.consume_budget(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_budget(text, text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
