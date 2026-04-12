-- supabase/migrations/20260412000006_fix_requesting_user_id.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Root cause of requesting_user_id() always returning NULL:
--
--   Supabase stores JWT claims as request.jwt.claims (a single JSONB setting),
--   NOT as individual request.jwt.claim.<name> settings.
--
--   The original requesting_user_id() used:
--     current_setting('request.jwt.claim.sub', true)   ← always NULL
--
--   Fix: read from request.jwt.claims (JSONB) and extract sub.
--
-- This one change unblocks ALL RLS policies — they all call requesting_user_id()
-- to get the Clerk user ID of the authenticated user.

CREATE OR REPLACE FUNCTION requesting_user_id() RETURNS text AS $$
  SELECT nullif(
    current_setting('request.jwt.claims', true)::jsonb->>'sub',
    ''
  )
$$ LANGUAGE sql STABLE;
