-- Follow-up for projects where Supabase default privileges granted EXECUTE
-- directly to anon when settle_up was created. On a fresh database this runs
-- before the canonical function migration and is therefore intentionally a no-op.
DO $$
BEGIN
  IF to_regprocedure(
    'public.settle_up(uuid,uuid,uuid,uuid,bigint,bigint,bigint,date,text,uuid,text)'
  ) IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.settle_up(
      uuid, uuid, uuid, uuid, bigint, bigint, bigint, date, text, uuid, text
    ) FROM PUBLIC, anon;

    GRANT EXECUTE ON FUNCTION public.settle_up(
      uuid, uuid, uuid, uuid, bigint, bigint, bigint, date, text, uuid, text
    ) TO authenticated;
  END IF;
END;
$$;
