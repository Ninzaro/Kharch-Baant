-- D-31: drop unused RPCs. Live names confirmed 2026-09.
-- generate_invite_token is unused (client builds tokens in JS).
-- cleanup_expired_invites has no caller / cron.
-- debug_auth_check has no source in this repo and is GRANT to anon.

DROP FUNCTION IF EXISTS public.cleanup_expired_invites();
DROP FUNCTION IF EXISTS public.debug_auth_check();
DROP FUNCTION IF EXISTS public.generate_invite_token();
