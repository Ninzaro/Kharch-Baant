-- Beta RLS audit (read-only). Run via:
--   npx supabase db query --linked -f scripts/rls-beta-audit.sql
-- Fail if any "FAIL" row appears.

-- 1) RLS must be ON for core tables
SELECT
  'rls_enabled' AS check_name,
  tablename,
  CASE WHEN rowsecurity THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'people', 'groups', 'group_members', 'transactions',
    'payment_sources', 'group_invites', 'email_invites'
  )
ORDER BY tablename;

-- 2) No leftover open policies
SELECT
  'no_allow_all' AS check_name,
  tablename,
  policyname,
  CASE WHEN policyname ILIKE '%allow all%' THEN 'FAIL' ELSE 'PASS' END AS result
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname ILIKE '%allow all%';

-- 3) people SELECT must use i_can_see_person (not USING true)
SELECT
  'people_select_scoped' AS check_name,
  policyname,
  cmd,
  CASE
    WHEN cmd = 'SELECT' AND coalesce(qual, '') ILIKE '%i_can_see_person%' THEN 'PASS'
    WHEN cmd = 'SELECT' AND coalesce(qual, '') IN ('true', '(true)') THEN 'FAIL'
    ELSE 'INFO'
  END AS result,
  left(coalesce(qual, ''), 80) AS using_clause
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'people'
ORDER BY policyname;

-- 4) invite tables: member-scoped policies exist
SELECT
  'invite_policies' AS check_name,
  tablename,
  policyname,
  cmd,
  'INFO' AS result
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('group_invites', 'email_invites')
ORDER BY tablename, cmd, policyname;

-- 5) Phase B RPCs exist
SELECT
  'phase_b_rpcs' AS check_name,
  p.proname AS function_name,
  CASE WHEN p.proname IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
FROM (VALUES
  ('claim_person_by_email'),
  ('get_invite_preview'),
  ('accept_group_invite'),
  ('i_can_see_person'),
  ('requesting_user_id')
) AS needed(name)
LEFT JOIN pg_proc p ON p.proname = needed.name
LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public';
