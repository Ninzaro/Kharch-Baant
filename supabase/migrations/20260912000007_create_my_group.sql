-- Create group + creator membership in one definer function.
-- PostgREST insert().select() was 403: SELECT RLS requires membership, which
-- is written only after the insert. Bypass that chicken-and-egg.

CREATE OR REPLACE FUNCTION create_my_group(
  p_name text,
  p_currency text,
  p_group_type text,
  p_trip_start date DEFAULT NULL,
  p_trip_end date DEFAULT NULL,
  p_enable_cute_icons boolean DEFAULT true
)
RETURNS SETOF groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person_id uuid;
  v_group_id uuid;
BEGIN
  SELECT p.id INTO v_person_id
  FROM people p
  WHERE p.clerk_user_id IS NOT NULL
    AND p.clerk_user_id = requesting_user_id()
  LIMIT 1;

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO groups (
    name,
    currency,
    group_type,
    trip_start_date,
    trip_end_date,
    enable_cute_icons,
    created_by
  ) VALUES (
    p_name,
    COALESCE(NULLIF(trim(p_currency), ''), 'INR'),
    p_group_type,
    p_trip_start,
    p_trip_end,
    COALESCE(p_enable_cute_icons, true),
    v_person_id
  )
  RETURNING id INTO v_group_id;

  INSERT INTO group_members (group_id, person_id)
  SELECT v_group_id, v_person_id
  WHERE NOT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = v_group_id AND gm.person_id = v_person_id
  );

  RETURN QUERY SELECT * FROM groups WHERE id = v_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_my_group(text, text, text, date, date, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION create_my_group(text, text, text, date, date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_my_group(text, text, text, date, date, boolean) FROM anon;

NOTIFY pgrst, 'reload schema';
