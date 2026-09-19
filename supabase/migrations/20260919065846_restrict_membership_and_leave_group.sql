-- A-07/A-14: claimed people join only by accepting an invite, while a
-- non-creator may leave only after their exact group balance reaches zero.

DROP POLICY IF EXISTS "Members can insert group members" ON public.group_members;

CREATE OR REPLACE FUNCTION public.person_is_unclaimed(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.people p
    WHERE p.id = p_person_id
      AND p.is_claimed = false
      AND p.clerk_user_id IS NULL
      AND p.auth_user_id IS NULL
      AND p.user_id IS NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION public.person_is_unclaimed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.person_is_unclaimed(uuid) TO authenticated;

CREATE POLICY "Group creators can insert unclaimed members"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.i_created_group(group_id)
  AND public.person_is_unclaimed(person_id)
);

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_person_id uuid;
  v_creator_person_id uuid;
  v_balance_minor bigint;
  v_deleted_count integer;
BEGIN
  SELECT p.id
  INTO v_caller_person_id
  FROM public.people p
  WHERE p.clerk_user_id = public.requesting_user_id();

  IF v_caller_person_id IS NULL THEN
    RAISE EXCEPTION 'No person record exists for the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize membership departure with settlement creation and group deletion.
  SELECT g.created_by
  INTO v_creator_person_id
  FROM public.groups g
  WHERE g.id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_creator_person_id = v_caller_person_id THEN
    RAISE EXCEPTION 'Group creators cannot leave their own group'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.person_id = v_caller_person_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caller is not a member of this group'
      USING ERRCODE = '42501';
  END IF;

  -- A transaction FK check takes a conflicting lock on the group row. Locking
  -- existing rows as well prevents updates while the balance is evaluated.
  PERFORM 1
  FROM public.transactions t
  WHERE t.group_id = p_group_id
  ORDER BY t.id
  FOR UPDATE;

  WITH transaction_rows AS (
    SELECT
      t.id,
      round(t.amount * 100)::bigint AS amount_minor,
      t.paid_by_id,
      t.payers,
      t.split_mode,
      t.split_participants
    FROM public.transactions t
    WHERE t.group_id = p_group_id
  ), payer_deltas AS (
    SELECT
      payer->>'personId' AS person_id,
      ((payer->>'amount')::numeric * 100)::bigint AS delta_minor
    FROM transaction_rows t
    CROSS JOIN LATERAL jsonb_array_elements(t.payers) payer
    WHERE jsonb_typeof(t.payers) = 'array'
      AND jsonb_array_length(t.payers) > 0

    UNION ALL

    SELECT
      t.paid_by_id::text,
      t.amount_minor
    FROM transaction_rows t
    WHERE t.payers IS NULL
      OR jsonb_typeof(t.payers) <> 'array'
      OR jsonb_array_length(t.payers) = 0
  ), split_raw AS (
    SELECT
      t.id AS transaction_id,
      participant.ordinality,
      participant.value->>'personId' AS person_id,
      t.amount_minor,
      CASE t.split_mode
        WHEN 'equal' THEN
          t.amount_minor::numeric / jsonb_array_length(t.split_participants)
        WHEN 'unequal' THEN
          (participant.value->>'value')::numeric * 100
        WHEN 'percentage' THEN
          t.amount_minor::numeric * (participant.value->>'value')::numeric / 100
        WHEN 'shares' THEN
          t.amount_minor::numeric * (participant.value->>'value')::numeric /
          (
            SELECT sum((share->>'value')::numeric)
            FROM jsonb_array_elements(t.split_participants) share
          )
      END AS raw_share_minor
    FROM transaction_rows t
    CROSS JOIN LATERAL jsonb_array_elements(t.split_participants)
      WITH ORDINALITY AS participant(value, ordinality)
  ), split_base AS (
    SELECT
      transaction_id,
      ordinality,
      person_id,
      amount_minor,
      floor(raw_share_minor)::bigint AS base_share_minor,
      raw_share_minor - floor(raw_share_minor) AS fractional_remainder
    FROM split_raw
  ), split_ranked AS (
    SELECT
      person_id,
      base_share_minor,
      row_number() OVER (
        PARTITION BY transaction_id
        ORDER BY fractional_remainder DESC, ordinality
      ) AS remainder_rank,
      amount_minor - sum(base_share_minor) OVER (
        PARTITION BY transaction_id
      ) AS extra_minor_units
    FROM split_base
  ), deltas AS (
    SELECT person_id, delta_minor
    FROM payer_deltas

    UNION ALL

    SELECT
      person_id,
      -(base_share_minor + CASE
        WHEN remainder_rank <= extra_minor_units THEN 1
        ELSE 0
      END) AS delta_minor
    FROM split_ranked
  )
  SELECT coalesce(sum(delta_minor), 0)::bigint
  INTO v_balance_minor
  FROM deltas
  WHERE person_id = v_caller_person_id::text;

  IF v_balance_minor <> 0 THEN
    RAISE EXCEPTION 'Settle your balance before leaving this group'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.person_id = v_caller_person_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'Could not leave this group' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leave_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
