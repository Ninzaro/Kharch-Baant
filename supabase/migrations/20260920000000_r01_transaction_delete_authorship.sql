-- R-01 / M-12: stop any member from DELETE /transactions?group_id=eq.<uuid>
-- wiping the whole ledger. Creator or row author only.
-- Idempotent. Requires 20260916000000 (created_by + i_am_person) if not already applied.
-- Does not change Clerk / Google / sign-in.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'created_by'
  ) THEN
    RAISE EXCEPTION 'R-01 abort: apply 20260916000000_transaction_authorship.sql first (transactions.created_by)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'i_am_person'
  ) THEN
    RAISE EXCEPTION 'R-01 abort: apply 20260916000000_transaction_authorship.sql first (i_am_person)';
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can delete group transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own or creator transactions" ON public.transactions;

CREATE POLICY "Users can delete own or creator transactions" ON public.transactions
  FOR DELETE
  TO authenticated
  USING (
    public.i_created_group(group_id)
    OR public.i_am_person(created_by)
  );

NOTIFY pgrst, 'reload schema';
