-- D-03 / Option C1: groups.created_by means people.id only.
-- Supersedes i_created_group V1–V4 (do not edit those files).
-- Assumes groups were wiped (or already have no NULL / non-person created_by).
-- One FK: groups.created_by → people(id) ON DELETE RESTRICT.

DO $$
DECLARE
  bad int;
  null_n int;
BEGIN
  SELECT count(*) INTO bad
  FROM groups g
  WHERE g.created_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id::text = g.created_by::text);

  IF bad > 0 THEN
    RAISE EXCEPTION 'D-03 abort: % groups.created_by value(s) are not people.id; fix data before FK', bad;
  END IF;

  SELECT count(*) INTO null_n FROM groups WHERE created_by IS NULL;
  IF null_n > 0 THEN
    RAISE EXCEPTION 'D-03 abort: % groups have NULL created_by; cannot SET NOT NULL', null_n;
  END IF;
END $$;

-- Policies that mention created_by block ALTER TYPE (0A000).
DROP POLICY IF EXISTS "Users can insert groups" ON groups;
DROP POLICY IF EXISTS "Users can view their groups" ON groups;

ALTER TABLE groups
  ALTER COLUMN created_by TYPE uuid USING created_by::uuid;

ALTER TABLE groups
  ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_created_by_fkey;
ALTER TABLE groups
  ADD CONSTRAINT groups_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES people(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION i_created_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM groups g
    JOIN people p ON p.id = g.created_by
    WHERE g.id = p_group_id
      AND p.clerk_user_id IS NOT NULL
      AND p.clerk_user_id = requesting_user_id()
  )
$$;

GRANT EXECUTE ON FUNCTION i_created_group(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can insert groups" ON groups;
CREATE POLICY "Users can insert groups" ON groups
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM people p
      WHERE p.id = created_by
        AND p.clerk_user_id IS NOT NULL
        AND p.clerk_user_id = requesting_user_id()
    )
  );

DROP POLICY IF EXISTS "Users can view their groups" ON groups;
CREATE POLICY "Users can view their groups" ON groups
  FOR SELECT USING (
    i_created_group(id) OR i_am_member_of(id)
  );
