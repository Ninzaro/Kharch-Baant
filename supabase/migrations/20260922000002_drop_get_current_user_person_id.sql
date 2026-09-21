-- Dead Supabase-Auth helper. No live policy, trigger, or app caller.
-- EXECUTE already revoked in 20260922000001; drop the object.

DROP FUNCTION IF EXISTS public.get_current_user_person_id();

NOTIFY pgrst, 'reload schema';
