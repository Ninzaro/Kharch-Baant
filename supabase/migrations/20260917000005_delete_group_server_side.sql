-- R-06: deletion authority and settlement are enforced in the database.
-- Empty groups are intentionally deletable.

CREATE OR REPLACE FUNCTION public.delete_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_largest_balance numeric;
BEGIN
  -- Lock the group only when the caller is its creator. The lock also prevents
  -- new transactions from referencing this group while deletion is evaluated.
  PERFORM 1
  FROM public.groups g
  JOIN public.people p ON p.id = g.created_by
  WHERE g.id = p_group_id
    AND p.clerk_user_id = public.requesting_user_id()
  FOR UPDATE OF g;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the group creator can delete this group'
      USING ERRCODE = '42501';
  END IF;

  -- Lock existing rows so their balances cannot change between validation and
  -- the cascading DELETE below.
  PERFORM 1
  FROM public.transactions t
  WHERE t.group_id = p_group_id
  FOR UPDATE;

  WITH transaction_rows AS (
    SELECT t.*
    FROM public.transactions t
    WHERE t.group_id = p_group_id
  ), deltas AS (
    SELECT payer->>'personId' AS person_id,
           (payer->>'amount')::numeric AS amount
    FROM transaction_rows t
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.payers, '[]'::jsonb)) payer

    UNION ALL

    SELECT t.paid_by_id::text AS person_id, t.amount
    FROM transaction_rows t
    WHERE t.payers IS NULL OR jsonb_array_length(t.payers) = 0

    UNION ALL

    SELECT participant->>'personId' AS person_id,
           -CASE t.split_mode
              WHEN 'equal' THEN t.amount / jsonb_array_length(t.split_participants)
              WHEN 'unequal' THEN (participant->>'value')::numeric
              WHEN 'percentage' THEN t.amount * (participant->>'value')::numeric / 100
              WHEN 'shares' THEN t.amount * (participant->>'value')::numeric /
                (SELECT SUM((share->>'value')::numeric)
                 FROM jsonb_array_elements(t.split_participants) share)
            END AS amount
    FROM transaction_rows t
    CROSS JOIN LATERAL jsonb_array_elements(t.split_participants) participant
  ), balances AS (
    SELECT person_id, SUM(amount) AS balance
    FROM deltas
    GROUP BY person_id
  )
  SELECT MAX(ABS(balance)) INTO v_largest_balance
  FROM balances;

  IF COALESCE(v_largest_balance, 0) >= 0.01 THEN
    RAISE EXCEPTION 'All balances must be settled before deleting the group'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.groups WHERE id = p_group_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_group(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_group(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
