-- D-06: normalise people.email so find and claim use the same key.
-- Discovery: no mixed-case rows / no lower(trim(email)) collisions.
-- Supersedes claim WHERE email = lower(trim(p_email)) (parameter-only).

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM (
    SELECT 1
    FROM people
    WHERE email IS NOT NULL
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  ) d;

  IF n > 0 THEN
    RAISE EXCEPTION 'D-06 abort: % normalised email value(s) collide; resolve duplicates before unique index', n;
  END IF;
END $$;

UPDATE people
SET email = lower(trim(email))
WHERE email IS NOT NULL
  AND email <> lower(trim(email));

DROP INDEX IF EXISTS people_email_unique;

CREATE UNIQUE INDEX IF NOT EXISTS people_email_lower_unique
  ON people ((lower(trim(email))))
  WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION people_normalize_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := NULLIF(lower(trim(COALESCE(NEW.email, ''))), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS people_normalize_email ON people;
CREATE TRIGGER people_normalize_email
  BEFORE INSERT OR UPDATE OF email ON people
  FOR EACH ROW
  EXECUTE FUNCTION people_normalize_email();

CREATE OR REPLACE FUNCTION ensure_my_person(p_name text, p_email text DEFAULT NULL)
RETURNS SETOF people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clerk text := requesting_user_id();
  v_name text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_email text := NULLIF(lower(trim(COALESCE(p_email, ''))), '');
BEGIN
  IF v_clerk IS NULL OR length(trim(v_clerk)) = 0 THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM people WHERE clerk_user_id = v_clerk) THEN
    IF v_name IS NOT NULL OR v_email IS NOT NULL THEN
      UPDATE people
      SET
        name = COALESCE(v_name, name),
        email = COALESCE(v_email, email),
        updated_at = now()
      WHERE clerk_user_id = v_clerk;
    END IF;
    RETURN QUERY SELECT * FROM people WHERE clerk_user_id = v_clerk LIMIT 1;
    RETURN;
  END IF;

  IF v_email IS NOT NULL THEN
    UPDATE people
    SET
      clerk_user_id = v_clerk,
      user_id = v_clerk,
      name = COALESCE(v_name, name),
      is_claimed = true,
      source = 'self',
      updated_at = now()
    WHERE lower(trim(email)) = v_email AND is_claimed = false;
    IF FOUND THEN
      RETURN QUERY SELECT * FROM people WHERE clerk_user_id = v_clerk LIMIT 1;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO people (
    name,
    email,
    avatar_url,
    clerk_user_id,
    user_id,
    is_claimed,
    source
  )
  VALUES (
    COALESCE(v_name, split_part(COALESCE(v_email, 'user'), '@', 1)),
    v_email,
    '',
    v_clerk,
    v_clerk,
    true,
    'self'
  )
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_my_person(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION ensure_my_person(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ensure_my_person(text, text) FROM anon;

CREATE OR REPLACE FUNCTION claim_person_by_email(
  p_email    TEXT,
  p_clerk_id TEXT,
  p_name     TEXT
)
RETURNS SETOF people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clerk_id text := requesting_user_id();
BEGIN
  IF v_clerk_id IS NULL OR length(trim(v_clerk_id)) = 0 THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_clerk_id IS NOT NULL
     AND length(trim(p_clerk_id)) > 0
     AND trim(p_clerk_id) <> v_clerk_id THEN
    RAISE EXCEPTION 'clerk_id mismatch' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE people
  SET
    clerk_user_id = v_clerk_id,
    user_id       = v_clerk_id,
    name          = COALESCE(NULLIF(trim(p_name), ''), name),
    is_claimed    = TRUE,
    source        = 'self'
  WHERE
    lower(trim(email)) = lower(trim(p_email))
    AND is_claimed = FALSE
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) FROM anon;
