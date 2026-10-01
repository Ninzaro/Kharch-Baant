-- A connect invite names the unclaimed member whose expenses the accepter keeps.
-- An open invite (for_person_id null) still adds the accepter as a new member.

ALTER TABLE public.group_invites
  ADD COLUMN IF NOT EXISTS for_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS group_invites_active_seat_idx
  ON public.group_invites (for_person_id)
  WHERE for_person_id IS NOT NULL AND is_active = true;

CREATE OR REPLACE FUNCTION app_private.retarget_person_array(
  p_items jsonb,
  p_from text,
  p_to text,
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  elem jsonb;
  pid text;
  val numeric;
  acc jsonb := '{}'::jsonb;
  order_ids text[] := ARRAY[]::text[];
  result jsonb := '[]'::jsonb;
  k text;
BEGIN
  IF p_items IS NULL THEN
    RETURN NULL;
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    pid := elem->>'personId';
    IF pid = p_from THEN
      pid := p_to;
    END IF;
    IF pid IS NULL OR pid = '' THEN
      CONTINUE;
    END IF;

    IF p_mode = 'payers' THEN
      val := COALESCE((elem->>'amount')::numeric, 0);
    ELSE
      val := COALESCE((elem->>'value')::numeric, 0);
    END IF;

    IF acc ? pid THEN
      IF p_mode IS DISTINCT FROM 'equal' THEN
        acc := jsonb_set(acc, ARRAY[pid], to_jsonb((acc->>pid)::numeric + val));
      END IF;
    ELSE
      acc := acc || jsonb_build_object(pid, val);
      order_ids := array_append(order_ids, pid);
    END IF;
  END LOOP;

  FOREACH k IN ARRAY order_ids
  LOOP
    IF p_mode = 'payers' THEN
      result := result || jsonb_build_array(jsonb_build_object('personId', k, 'amount', (acc->>k)::numeric));
    ELSE
      result := result || jsonb_build_array(jsonb_build_object('personId', k, 'value', (acc->>k)::numeric));
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION app_private.retarget_person_array(jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.claim_placeholder_into(p_from uuid, p_to uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group uuid;
  v_seat public.people%ROWTYPE;
BEGIN
  IF p_from IS NOT DISTINCT FROM p_to THEN
    RETURN;
  END IF;

  SELECT * INTO v_seat
  FROM public.people
  WHERE id = p_from
  FOR UPDATE;

  IF NOT FOUND
     OR COALESCE(v_seat.is_claimed, false)
     OR v_seat.clerk_user_id IS NOT NULL
     OR v_seat.auth_user_id IS NOT NULL
     OR v_seat.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This seat was already taken.' USING ERRCODE = '42501';
  END IF;

  FOR v_group IN
    SELECT gm.group_id
    FROM public.group_members gm
    WHERE gm.person_id = p_from
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = v_group AND person_id = p_to
    ) THEN
      DELETE FROM public.group_members
      WHERE group_id = v_group AND person_id = p_from;
    ELSE
      UPDATE public.group_members
      SET person_id = p_to
      WHERE group_id = v_group AND person_id = p_from;
    END IF;
  END LOOP;

  UPDATE public.transactions t
  SET
    paid_by_id = CASE WHEN t.paid_by_id = p_from THEN p_to ELSE t.paid_by_id END,
    created_by = CASE WHEN t.created_by = p_from THEN p_to ELSE t.created_by END,
    split_participants = app_private.retarget_person_array(
      t.split_participants,
      p_from::text,
      p_to::text,
      CASE WHEN t.split_mode = 'equal' THEN 'equal' ELSE 'sum' END
    ),
    payers = CASE
      WHEN t.payers IS NULL THEN NULL
      ELSE app_private.retarget_person_array(t.payers, p_from::text, p_to::text, 'payers')
    END
  WHERE t.paid_by_id = p_from
     OR t.created_by = p_from
     OR t.split_participants::text LIKE '%' || p_from::text || '%'
     OR COALESCE(t.payers::text, '') LIKE '%' || p_from::text || '%';

  UPDATE public.groups SET created_by = p_to WHERE created_by = p_from;
  UPDATE public.group_invites SET invited_by = p_to WHERE invited_by = p_from;
  UPDATE public.group_invites SET for_person_id = NULL WHERE for_person_id = p_from;
  UPDATE public.email_invites SET invited_by = p_to WHERE invited_by = p_from;
  UPDATE public.email_invites SET accepted_by = p_to WHERE accepted_by = p_from;

  DELETE FROM public.people WHERE id = p_from;
END;
$$;

REVOKE ALL ON FUNCTION app_private.claim_placeholder_into(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.group_invites_seat_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.for_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.people p
    WHERE p.id = NEW.for_person_id
      AND COALESCE(p.is_claimed, false) = false
      AND p.clerk_user_id IS NULL
      AND p.auth_user_id IS NULL
      AND p.user_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = NEW.group_id
      AND gm.person_id = NEW.for_person_id
  ) THEN
    RAISE EXCEPTION 'Invite seat must be an unclaimed member of this group' USING ERRCODE = '23514';
  END IF;

  UPDATE public.group_invites
  SET is_active = false, updated_at = now()
  WHERE for_person_id = NEW.for_person_id
    AND COALESCE(is_active, true) = true
    AND id IS DISTINCT FROM NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_invites_seat_check ON public.group_invites;
CREATE TRIGGER group_invites_seat_check
  BEFORE INSERT ON public.group_invites
  FOR EACH ROW
  EXECUTE FUNCTION app_private.group_invites_seat_check();

REVOKE ALL ON FUNCTION app_private.group_invites_seat_check() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_group_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text := public.requesting_user_id();
  v_person   public.people%ROWTYPE;
  v_invite   public.group_invites%ROWTYPE;
  v_group    public.groups%ROWTYPE;
  v_existing uuid;
  v_jwt_email text := app_private.verified_jwt_email();
  v_seat boolean := false;
BEGIN
  IF v_clerk_id IS NULL OR length(trim(v_clerk_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite');
  END IF;

  SELECT * INTO v_person
  FROM public.people
  WHERE clerk_user_id = v_clerk_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Person record not found');
  END IF;

  SELECT * INTO v_invite
  FROM public.group_invites
  WHERE invite_token = trim(p_token)
    AND COALESCE(is_active, true) = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite not found or expired');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    UPDATE public.group_invites SET is_active = false, updated_at = now() WHERE id = v_invite.id;
    RETURN jsonb_build_object('success', false, 'error', 'Invite has expired');
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.current_uses >= v_invite.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite has reached maximum usage limit');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.email_invites
    WHERE group_invite_id = v_invite.id AND status = 'pending'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.email_invites ei
    WHERE ei.group_invite_id = v_invite.id
      AND ei.status = 'pending'
      AND lower(trim(ei.email)) IN (
        SELECT lower(trim(candidate))
        FROM (VALUES (v_person.email), (v_jwt_email)) AS emails(candidate)
        WHERE candidate IS NOT NULL AND length(trim(candidate)) > 0
      )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite was sent to a different email');
  END IF;

  SELECT * INTO v_group FROM public.groups WHERE id = v_invite.group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Group not found');
  END IF;

  v_seat := v_invite.for_person_id IS NOT NULL;
  IF v_seat AND v_invite.for_person_id IS DISTINCT FROM v_person.id THEN
    PERFORM app_private.claim_placeholder_into(v_invite.for_person_id, v_person.id);
  END IF;

  SELECT id INTO v_existing
  FROM public.group_members
  WHERE group_id = v_invite.group_id AND person_id = v_person.id
  LIMIT 1;

  IF v_existing IS NOT NULL AND NOT v_seat THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_member', true,
      'group_id', v_invite.group_id,
      'person_id', v_person.id
    );
  END IF;

  IF v_existing IS NULL THEN
    INSERT INTO public.group_members (group_id, person_id)
    VALUES (v_invite.group_id, v_person.id);
  END IF;

  UPDATE public.group_invites
  SET
    current_uses = COALESCE(current_uses, 0) + 1,
    updated_at = now(),
    is_active = CASE
      WHEN max_uses IS NOT NULL AND COALESCE(current_uses, 0) + 1 >= max_uses THEN false
      ELSE is_active
    END
  WHERE id = v_invite.id;

  IF v_person.email IS NOT NULL OR v_jwt_email IS NOT NULL THEN
    UPDATE public.email_invites
    SET
      status = 'accepted',
      accepted_at = now(),
      accepted_by = v_person.id
    WHERE group_invite_id = v_invite.id
      AND status = 'pending'
      AND lower(trim(email)) IN (
        SELECT lower(trim(candidate))
        FROM (VALUES (v_person.email), (v_jwt_email)) AS emails(candidate)
        WHERE candidate IS NOT NULL AND length(trim(candidate)) > 0
      );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_member', v_existing IS NOT NULL AND NOT v_seat,
    'group_id', v_invite.group_id,
    'person_id', v_person.id,
    'group_name', v_group.name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_group_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_group_invite(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.group_invites%ROWTYPE;
  v_group public.groups%ROWTYPE;
  v_inviter public.people%ROWTYPE;
  v_seat_name text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 8 THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite not found or expired');
  END IF;

  SELECT * INTO v_invite
  FROM public.group_invites
  WHERE invite_token = trim(p_token)
    AND COALESCE(is_active, true) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite not found or expired');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    UPDATE public.group_invites SET is_active = false, updated_at = now() WHERE id = v_invite.id;
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite has expired');
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.current_uses >= v_invite.max_uses THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite has reached maximum usage limit');
  END IF;

  SELECT * INTO v_group FROM public.groups WHERE id = v_invite.group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite not found or expired');
  END IF;

  SELECT * INTO v_inviter FROM public.people WHERE id = v_invite.invited_by;

  v_seat_name := NULL;
  IF v_invite.for_person_id IS NOT NULL THEN
    SELECT split_part(p.name, ' ', 1) INTO v_seat_name
    FROM public.people p
    WHERE p.id = v_invite.for_person_id;
  END IF;

  RETURN jsonb_build_object(
    'is_valid', true,
    'invite', jsonb_build_object(
      'expires_at', v_invite.expires_at,
      'max_uses', v_invite.max_uses,
      'current_uses', v_invite.current_uses
    ),
    'group', jsonb_build_object(
      'id', v_group.id,
      'name', v_group.name,
      'currency', v_group.currency,
      'group_type', v_group.group_type
    ),
    'inviter', CASE WHEN v_inviter.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', v_inviter.name
    ) END,
    'seat_name', v_seat_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
