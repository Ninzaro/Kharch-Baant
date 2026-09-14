-- M-03: reject invalid split/payers JSON on INSERT/UPDATE.
-- Sequential PL/pgSQL (shape, then mode sums). Equal mode: shape only
-- (stored values are weights of 1, not rupees). No personId∈group_members (M-08).

CREATE OR REPLACE FUNCTION transactions_assert_money_invariants(
  p_amount numeric,
  p_split_mode text,
  p_split jsonb,
  p_payers jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  elem jsonb;
  v numeric;
  v_sum numeric := 0;
  p_sum numeric := 0;
BEGIN
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
    v_sum := v_sum + v;
  END LOOP;

  IF p_split_mode = 'unequal' THEN
    IF abs(v_sum - p_amount) >= 0.01 THEN
      RAISE EXCEPTION 'unequal split must sum to amount' USING ERRCODE = '23514';
    END IF;
  ELSIF p_split_mode = 'percentage' THEN
    IF abs(v_sum - 100) >= 0.01 THEN
      RAISE EXCEPTION 'percentage split must sum to 100' USING ERRCODE = '23514';
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
    p_sum := p_sum + v;
  END LOOP;
  IF abs(p_sum - p_amount) >= 0.01 THEN
    RAISE EXCEPTION 'payers must sum to amount' USING ERRCODE = '23514';
  END IF;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, amount, split_mode, split_participants, payers
    FROM transactions
  LOOP
    BEGIN
      PERFORM transactions_assert_money_invariants(
        r.amount, r.split_mode, r.split_participants, r.payers
      );
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'M-03 abort: transaction % violates money invariants', r.id;
    END;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION transactions_money_invariants_tg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM transactions_assert_money_invariants(
    NEW.amount, NEW.split_mode, NEW.split_participants, NEW.payers
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_money_invariants_trg ON transactions;
CREATE TRIGGER transactions_money_invariants_trg
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION transactions_money_invariants_tg();
