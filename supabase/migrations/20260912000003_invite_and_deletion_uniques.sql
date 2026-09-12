-- D-19: email_invites unique on (group_invite_id, email), not (group_id, email).
-- D-20: at most one pending group_deletion_requests row per group (partial unique).

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM (
    SELECT 1
    FROM email_invites
    GROUP BY group_invite_id, email
    HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'D-19 abort: % duplicate (group_invite_id, email) pair(s)', n;
  END IF;

  SELECT count(*) INTO n
  FROM (
    SELECT 1
    FROM group_deletion_requests
    WHERE status = 'pending'
    GROUP BY group_id
    HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'D-20 abort: % group(s) have more than one pending deletion request', n;
  END IF;
END $$;

ALTER TABLE email_invites
  DROP CONSTRAINT IF EXISTS email_invites_group_id_email_key;

ALTER TABLE email_invites
  DROP CONSTRAINT IF EXISTS email_invites_group_invite_id_email_key;

ALTER TABLE email_invites
  ADD CONSTRAINT email_invites_group_invite_id_email_key
  UNIQUE (group_invite_id, email);

ALTER TABLE group_deletion_requests
  DROP CONSTRAINT IF EXISTS group_deletion_requests_group_id_key;

DROP INDEX IF EXISTS group_deletion_requests_one_pending_per_group;

CREATE UNIQUE INDEX group_deletion_requests_one_pending_per_group
  ON group_deletion_requests (group_id)
  WHERE status = 'pending';
