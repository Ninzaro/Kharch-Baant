-- R-09: cached expense descriptions are user data and must not be enumerable
-- by every authenticated user.

DROP POLICY IF EXISTS "cache_read" ON public.ai_item_cache;

NOTIFY pgrst, 'reload schema';
