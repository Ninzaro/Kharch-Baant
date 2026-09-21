-- Read-only. Paste in Supabase SQL editor.
-- Confirms: create_my_group, replica identity, D-31 drops, delete_group, tx DELETE policy.

-- 1) create_my_group (00007)
SELECT proname, prosecdef
FROM pg_proc
WHERE proname IN ('create_my_group', 'delete_group', 'i_created_group', 'i_own_person', 'i_am_person');

-- 2) Replica identity (want 'd' = default, not 'f' = full)
SELECT relname,
       CASE relreplident
         WHEN 'd' THEN 'default'
         WHEN 'f' THEN 'full'
         WHEN 'n' THEN 'nothing'
         ELSE relreplident::text
       END AS replica_identity
FROM pg_class
WHERE relname IN ('groups', 'transactions', 'people', 'group_members', 'payment_sources')
ORDER BY 1;

-- 3) D-31 unused functions (want 0 rows)
SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('cleanup_expired_invites', 'debug_auth_check', 'generate_invite_token');

-- 4) R-01 / M-12: DELETE on transactions must NOT be "any member of group"
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.transactions'::regclass
  AND polcmd = 'd';

-- Safe: using_expr mentions i_created_group and i_am_person(created_by)
-- Unsafe: i_am_member_of(group_id) without created_by / i_am_person

-- 5) delete_group RPC exists
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'delete_group'
  AND pronamespace = 'public'::regnamespace;
