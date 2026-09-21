-- R-20 leftover: authenticated INSERT was revoked in 20260917170449.
-- anon still had GRANT ALL (including INSERT). Placeholder rows go through
-- create_unclaimed_person (SECURITY DEFINER, authenticated-only EXECUTE).
-- Self rows go through ensure_my_person (same). Direct POST /people as anon
-- must fail at the grant, not only at RLS.

REVOKE INSERT ON TABLE public.people FROM anon;
REVOKE INSERT ON TABLE public.people FROM PUBLIC;
