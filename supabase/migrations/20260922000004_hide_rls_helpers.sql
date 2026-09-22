-- A-27: RLS helpers were SECURITY DEFINER functions in public, so PostgREST
-- exposed them as RPCs. Revoking EXECUTE from authenticated breaks policies
-- (the caller, not the table owner, must be allowed to execute them).
-- Move the real functions to app_private (not an API schema). Policies keep
-- the same function identity. Ungranted public stubs keep existing
-- public.helper() calls inside other functions working.

CREATE SCHEMA IF NOT EXISTS app_private;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

ALTER FUNCTION public.requesting_user_id() SET SCHEMA app_private;
ALTER FUNCTION public.i_am_member_of(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.i_created_group(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.i_can_see_person(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.i_am_person(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.i_own_person(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.person_is_unclaimed(uuid) SET SCHEMA app_private;

ALTER FUNCTION app_private.requesting_user_id() SET search_path = app_private, public;
ALTER FUNCTION app_private.i_am_member_of(uuid) SET search_path = app_private, public;
ALTER FUNCTION app_private.i_created_group(uuid) SET search_path = app_private, public;
ALTER FUNCTION app_private.i_can_see_person(uuid) SET search_path = app_private, public;
ALTER FUNCTION app_private.i_am_person(uuid) SET search_path = app_private, public;
ALTER FUNCTION app_private.i_own_person(uuid) SET search_path = app_private, public;
ALTER FUNCTION app_private.person_is_unclaimed(uuid) SET search_path = app_private, public;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;

CREATE FUNCTION public.requesting_user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT app_private.requesting_user_id() $$;
CREATE FUNCTION public.i_am_member_of(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_private.i_am_member_of($1) $$;
CREATE FUNCTION public.i_created_group(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_private.i_created_group($1) $$;
CREATE FUNCTION public.i_can_see_person(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_private.i_can_see_person($1) $$;
CREATE FUNCTION public.i_am_person(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_private.i_am_person($1) $$;
CREATE FUNCTION public.i_own_person(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_private.i_own_person($1) $$;
CREATE FUNCTION public.person_is_unclaimed(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_private.person_is_unclaimed($1) $$;

REVOKE ALL ON FUNCTION public.requesting_user_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.i_am_member_of(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.i_created_group(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.i_can_see_person(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.i_am_person(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.i_own_person(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.person_is_unclaimed(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
