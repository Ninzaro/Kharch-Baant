-- Stage 3A / A-15: a normal group update cannot transfer or orphan ownership.
DROP POLICY IF EXISTS "Users can update their groups" ON public.groups;
CREATE POLICY "Users can update their groups" ON public.groups
  FOR UPDATE TO authenticated
  USING (public.i_created_group(id))
  WITH CHECK (public.i_am_person(created_by));

-- Stage 3A / A-16 / M-08: existing rows must be clean before the stricter
-- trigger is installed. Abort instead of silently rewriting financial data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = t.group_id
        AND gm.person_id = t.paid_by_id
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t.split_participants) participant
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.group_members gm
        WHERE gm.group_id = t.group_id
          AND gm.person_id = (participant->>'personId')::uuid
      )
    )
    OR (
      t.payers IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(t.payers) payer
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.group_members gm
          WHERE gm.group_id = t.group_id
            AND gm.person_id = (payer->>'personId')::uuid
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'Stage 3A abort: a transaction references a person outside its group';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.transactions_money_invariants_tg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.transactions_assert_money_invariants(
    NEW.amount, NEW.split_mode, NEW.split_participants, NEW.payers
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = NEW.group_id
      AND gm.person_id = NEW.paid_by_id
  ) THEN
    RAISE EXCEPTION 'paid_by_id must be a current group member' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.split_participants) participant
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = NEW.group_id
        AND gm.person_id = (participant->>'personId')::uuid
    )
  ) THEN
    RAISE EXCEPTION 'split participants must be current group members' USING ERRCODE = '23514';
  END IF;

  IF NEW.payers IS NOT NULL AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.payers) payer
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = NEW.group_id
        AND gm.person_id = (payer->>'personId')::uuid
    )
  ) THEN
    RAISE EXCEPTION 'payers must be current group members' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
