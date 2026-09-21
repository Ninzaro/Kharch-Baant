-- Anon EXECUTE on client-callable helpers. Keep EXECUTE on RLS helpers that
-- SELECT policies actually invoke for the anon role (i_am_member_of,
-- i_created_group, i_can_see_person, requesting_user_id) and on
-- get_invite_preview (pre-auth invite page).
--
-- i_am_person is used only in INSERT/UPDATE/DELETE policies, not SELECT.
-- set_transaction_author is a trigger; authenticated writers still need EXECUTE.
-- get_current_user_person_id is a dead Supabase-Auth RPC (no live policy/app caller).

REVOKE EXECUTE ON FUNCTION public.i_am_person(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.i_am_person(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.i_am_person(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_transaction_author() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_transaction_author() FROM anon;
GRANT EXECUTE ON FUNCTION public.set_transaction_author() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_current_user_person_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_current_user_person_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_current_user_person_id() FROM authenticated;

NOTIFY pgrst, 'reload schema';
