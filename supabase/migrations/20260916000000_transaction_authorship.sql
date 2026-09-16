-- M-12: transaction authors may edit/delete their own rows; group creators retain admin access.
-- Existing rows predate authorship, so they are deliberately assigned to their group creator.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_by uuid;

UPDATE transactions t
SET created_by = g.created_by
FROM groups g
WHERE g.id = t.group_id
  AND t.created_by IS NULL;

ALTER TABLE transactions
  ALTER COLUMN created_by SET NOT NULL,
  DROP CONSTRAINT IF EXISTS transactions_created_by_fkey,
  ADD CONSTRAINT transactions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES people(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION i_am_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM people
    WHERE id = p_person_id
      AND clerk_user_id = requesting_user_id()
  )
$$;

CREATE OR REPLACE FUNCTION set_transaction_author()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_person_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Transaction author cannot be changed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT id INTO v_person_id
  FROM people
  WHERE clerk_user_id = requesting_user_id();

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'No person record exists for the authenticated user' USING ERRCODE = '42501';
  END IF;

  NEW.created_by := v_person_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_transaction_author_on_write ON transactions;
CREATE TRIGGER set_transaction_author_on_write
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_transaction_author();

DROP POLICY IF EXISTS "Users can insert group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can update group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can delete group transactions" ON transactions;

CREATE POLICY "Users can insert group transactions" ON transactions
  FOR INSERT WITH CHECK (
    (i_created_group(group_id) OR i_am_member_of(group_id))
    AND i_am_person(created_by)
  );

CREATE POLICY "Users can update own or creator transactions" ON transactions
  FOR UPDATE
  USING (i_created_group(group_id) OR i_am_person(created_by))
  WITH CHECK (i_created_group(group_id) OR i_am_person(created_by));

CREATE POLICY "Users can delete own or creator transactions" ON transactions
  FOR DELETE USING (i_created_group(group_id) OR i_am_person(created_by));

REVOKE EXECUTE ON FUNCTION i_am_person(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION i_am_person(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
