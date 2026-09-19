-- M-13: reject sub-cent money and require exact split/payer totals.
-- numeric(14,4) preserves the original ten integer digits while allowing the
-- constraint and trigger to see (and reject) sub-cent input before it is rounded.

ALTER TABLE public.transactions
  ALTER COLUMN amount TYPE numeric(14,4) USING amount::numeric(14,4);

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_amount_minor_units_check
  CHECK (amount = round(amount, 2)) NOT VALID;

ALTER TABLE public.transactions
  VALIDATE CONSTRAINT transactions_amount_minor_units_check;

CREATE OR REPLACE FUNCTION public.transactions_assert_money_invariants(
  p_amount numeric,
  p_split_mode text,
  p_split jsonb,
  p_payers jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  elem jsonb;
  v numeric;
  v_sum numeric := 0;
  p_sum numeric := 0;
BEGIN
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'amount must use no more than 2 decimal places' USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(p_split) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'split_participants must be a JSON array' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(p_split) IS NULL OR jsonb_array_length(p_split) < 1 THEN
    RAISE EXCEPTION 'split_participants must not be empty' USING ERRCODE = '23514';
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(p_split)
  LOOP
    IF coalesce(btrim(elem->>'personId'), '') = '' THEN
      RAISE EXCEPTION 'split_participants[].personId is required' USING ERRCODE = '23514';
    END IF;
    BEGIN
      v := (elem->>'value')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'split_participants[].value must be numeric' USING ERRCODE = '23514';
    END;
    IF v < 0 THEN
      RAISE EXCEPTION 'split_participants[].value cannot be negative' USING ERRCODE = '23514';
    END IF;
    IF p_split_mode = 'unequal' AND v <> round(v, 2) THEN
      RAISE EXCEPTION 'unequal split values must use no more than 2 decimal places' USING ERRCODE = '23514';
    END IF;
    v_sum := v_sum + v;
  END LOOP;

  IF p_split_mode = 'unequal' THEN
    IF v_sum <> p_amount THEN
      RAISE EXCEPTION 'unequal split must sum exactly to amount' USING ERRCODE = '23514';
    END IF;
  ELSIF p_split_mode = 'percentage' THEN
    IF v_sum <> 100 THEN
      RAISE EXCEPTION 'percentage split must sum exactly to 100' USING ERRCODE = '23514';
    END IF;
  ELSIF p_split_mode = 'shares' THEN
    IF v_sum <= 0 THEN
      RAISE EXCEPTION 'shares split must have total shares > 0' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_payers IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_payers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'payers must be a JSON array' USING ERRCODE = '23514';
  END IF;
  FOR elem IN SELECT value FROM jsonb_array_elements(p_payers)
  LOOP
    BEGIN
      v := (elem->>'amount')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'payers[].amount must be numeric' USING ERRCODE = '23514';
    END;
    IF v < 0 THEN
      RAISE EXCEPTION 'payers[].amount cannot be negative' USING ERRCODE = '23514';
    END IF;
    IF v <> round(v, 2) THEN
      RAISE EXCEPTION 'payers[].amount must use no more than 2 decimal places' USING ERRCODE = '23514';
    END IF;
    p_sum := p_sum + v;
  END LOOP;
  IF p_sum <> p_amount THEN
    RAISE EXCEPTION 'payers must sum exactly to amount' USING ERRCODE = '23514';
  END IF;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, amount, split_mode, split_participants, payers
    FROM public.transactions
  LOOP
    BEGIN
      PERFORM public.transactions_assert_money_invariants(
        r.amount, r.split_mode, r.split_participants, r.payers
      );
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'M-13 abort: transaction % violates exact money invariants', r.id;
    END;
  END LOOP;
END $$;
