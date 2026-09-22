-- R-14: a personal email invite can be accepted only by that email.
-- Generic share links (no email_invites row) stay open.

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

  SELECT id INTO v_existing
  FROM public.group_members
  WHERE group_id = v_invite.group_id AND person_id = v_person.id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_member', true,
      'group_id', v_invite.group_id,
      'person_id', v_person.id
    );
  END IF;

  INSERT INTO public.group_members (group_id, person_id)
  VALUES (v_invite.group_id, v_person.id);

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
    'already_member', false,
    'group_id', v_invite.group_id,
    'person_id', v_person.id,
    'group_name', v_group.name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_group_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_group_invite(text) TO authenticated;
