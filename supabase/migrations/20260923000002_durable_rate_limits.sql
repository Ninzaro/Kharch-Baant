-- A-17: one shared counter for Edge rate limits. Not exposed through the Data API.

CREATE TABLE IF NOT EXISTS app_private.request_budget (
  bucket text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (bucket, subject, window_start)
);

ALTER TABLE app_private.request_budget ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE app_private.request_budget FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.consume_budget(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  IF p_bucket IS NULL OR p_subject IS NULL OR length(p_bucket) = 0 OR length(p_subject) = 0
     OR p_max < 1 OR p_window_seconds < 1 THEN
    RETURN false;
  END IF;

  v_window := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO app_private.request_budget (bucket, subject, window_start, count)
  VALUES (left(p_bucket, 64), left(p_subject, 200), v_window, 1)
  ON CONFLICT (bucket, subject, window_start)
  DO UPDATE
    SET count = app_private.request_budget.count + 1
    WHERE app_private.request_budget.count < p_max
  RETURNING count INTO v_count;

  DELETE FROM app_private.request_budget
  WHERE window_start < clock_timestamp() - interval '1 day';

  RETURN v_count IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_private.consume_budget(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.consume_budget(text, text, integer, integer) TO service_role;
