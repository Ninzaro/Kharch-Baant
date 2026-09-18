-- M-09/M-10: client transaction ids make retries idempotent, while settlement
-- creation is serialized and checked against the balances the client saw.

CREATE OR REPLACE FUNCTION public.settle_up(
  p_transaction_id uuid,
  p_group_id uuid,
  p_payer_id uuid,
  p_receiver_id uuid,
  p_amount_minor bigint,
  p_expected_payer_balance_minor bigint,
  p_expected_receiver_balance_minor bigint,
  p_date date,
  p_description text,
  p_payment_source_id uuid DEFAULT NULL,
  p_comment text DEFAULT NULL
)
RETURNS SETOF public.transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_person_id uuid;
  v_existing public.transactions%ROWTYPE;
  v_created public.transactions%ROWTYPE;
  v_payer_balance_minor bigint;
  v_receiver_balance_minor bigint;
  v_max_settlement_minor bigint;
  v_split jsonb;
BEGIN
  IF p_payer_id = p_receiver_id THEN
    RAISE EXCEPTION 'Payer and receiver must be different people'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'Settlement amount must be positive'
      USING ERRCODE = '23514';
  END IF;

  SELECT p.id
  INTO v_caller_person_id
  FROM public.people p
  WHERE p.clerk_user_id = public.requesting_user_id();

  IF v_caller_person_id IS NULL THEN
    RAISE EXCEPTION 'No person record exists for the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the group first. FK checks on new transaction rows take a conflicting
  -- key-share lock, so no expense can be inserted during this balance check.
  PERFORM 1
  FROM public.groups g
  WHERE g.id = p_group_id
    AND (
      g.created_by = v_caller_person_id
      OR EXISTS (
        SELECT 1
        FROM public.group_members gm
        WHERE gm.group_id = g.id
          AND gm.person_id = v_caller_person_id
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caller is not a member of this group'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.person_id = p_payer_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.person_id = p_receiver_id
  ) THEN
    RAISE EXCEPTION 'Settlement participants must be current group members'
      USING ERRCODE = '23514';
  END IF;

  IF p_payment_source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.payment_sources ps
    WHERE ps.id = p_payment_source_id
      AND (
        ps.user_id = public.requesting_user_id()
        OR ps.user_id = v_caller_person_id::text
        OR ps.created_by = public.requesting_user_id()
      )
  ) THEN
    RAISE EXCEPTION 'Payment source is not owned by the caller'
      USING ERRCODE = '42501';
  END IF;

  -- Existing updates/deletes must also wait until the balance snapshot and
  -- settlement insert complete. Keep lock order aligned with delete_group.
  PERFORM 1
  FROM public.transactions t
  WHERE t.group_id = p_group_id
  ORDER BY t.id
  FOR UPDATE;

  v_split := jsonb_build_array(
    jsonb_build_object('personId', p_payer_id::text, 'value', 0),
    jsonb_build_object('personId', p_receiver_id::text, 'value', p_amount_minor::numeric / 100)
  );

  SELECT t.*
  INTO v_existing
  FROM public.transactions t
  WHERE t.id = p_transaction_id;

  IF FOUND THEN
    IF v_existing.created_by <> v_caller_person_id
      OR v_existing.group_id <> p_group_id
      OR v_existing.type <> 'settlement'
      OR v_existing.paid_by_id <> p_payer_id
      OR round(v_existing.amount * 100)::bigint <> p_amount_minor
      OR v_existing.date <> p_date
      OR v_existing.description <> p_description
      OR v_existing.payment_source_id IS DISTINCT FROM p_payment_source_id
      OR v_existing.comment IS DISTINCT FROM p_comment
      OR v_existing.payers IS NOT NULL
      OR v_existing.split_mode <> 'unequal'
      OR v_existing.split_participants <> v_split
    THEN
      RAISE EXCEPTION 'Transaction id is already used for a different write'
        USING ERRCODE = '23505';
    END IF;

    RETURN NEXT v_existing;
    RETURN;
  END IF;

  WITH transaction_rows AS (
    SELECT t.*
    FROM public.transactions t
    WHERE t.group_id = p_group_id
  ), deltas AS (
    SELECT
      payer->>'personId' AS person_id,
      (payer->>'amount')::numeric * 100 AS amount_minor
    FROM transaction_rows t
    CROSS JOIN LATERAL jsonb_array_elements(t.payers) payer
    WHERE jsonb_typeof(t.payers) = 'array'
      AND jsonb_array_length(t.payers) > 0

    UNION ALL

    SELECT
      t.paid_by_id::text,
      t.amount * 100
    FROM transaction_rows t
    WHERE t.payers IS NULL
      OR jsonb_typeof(t.payers) <> 'array'
      OR jsonb_array_length(t.payers) = 0

    UNION ALL

    SELECT
      participant->>'personId' AS person_id,
      -CASE t.split_mode
        WHEN 'equal' THEN t.amount * 100 / jsonb_array_length(t.split_participants)
        WHEN 'unequal' THEN (participant->>'value')::numeric * 100
        WHEN 'percentage' THEN t.amount * (participant->>'value')::numeric
        WHEN 'shares' THEN t.amount * 100 * (participant->>'value')::numeric /
          (SELECT sum((share->>'value')::numeric)
           FROM jsonb_array_elements(t.split_participants) share)
      END
    FROM transaction_rows t
    CROSS JOIN LATERAL jsonb_array_elements(t.split_participants) participant
  ), balances AS (
    SELECT person_id, round(sum(amount_minor))::bigint AS balance_minor
    FROM deltas
    GROUP BY person_id
  )
  SELECT
    coalesce(max(balance_minor) FILTER (WHERE person_id = p_payer_id::text), 0),
    coalesce(max(balance_minor) FILTER (WHERE person_id = p_receiver_id::text), 0)
  INTO v_payer_balance_minor, v_receiver_balance_minor
  FROM balances;

  IF v_payer_balance_minor <> p_expected_payer_balance_minor
    OR v_receiver_balance_minor <> p_expected_receiver_balance_minor
  THEN
    RAISE EXCEPTION 'Balances changed. Reload before recording this settlement.'
      USING ERRCODE = '40001';
  END IF;

  IF v_payer_balance_minor >= 0 OR v_receiver_balance_minor <= 0 THEN
    RAISE EXCEPTION 'The selected payer does not currently owe the selected receiver'
      USING ERRCODE = '23514';
  END IF;

  v_max_settlement_minor := least(-v_payer_balance_minor, v_receiver_balance_minor);
  IF p_amount_minor > v_max_settlement_minor THEN
    RAISE EXCEPTION 'Settlement exceeds the current outstanding balance'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.transactions (
    id,
    group_id,
    description,
    amount,
    paid_by_id,
    payers,
    date,
    tag,
    payment_source_id,
    comment,
    type,
    split_mode,
    split_participants
  ) VALUES (
    p_transaction_id,
    p_group_id,
    p_description,
    p_amount_minor::numeric / 100,
    p_payer_id,
    NULL,
    p_date,
    'Other',
    p_payment_source_id,
    p_comment,
    'settlement',
    'unequal',
    v_split
  )
  RETURNING * INTO v_created;

  RETURN NEXT v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_up(
  uuid, uuid, uuid, uuid, bigint, bigint, bigint, date, text, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_up(
  uuid, uuid, uuid, uuid, bigint, bigint, bigint, date, text, uuid, text
) TO authenticated;
