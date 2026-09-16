-- R-19: invite links are bearer tokens, not permission to reveal a group's
-- invitees, dates, creator identity, or profile photos.

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite group_invites%ROWTYPE;
  v_group groups%ROWTYPE;
  v_inviter people%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 8 THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite not found or expired');
  END IF;

  SELECT * INTO v_invite
  FROM group_invites
  WHERE invite_token = trim(p_token)
    AND COALESCE(is_active, true) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite not found or expired');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    UPDATE group_invites SET is_active = false, updated_at = now() WHERE id = v_invite.id;
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite has expired');
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.current_uses >= v_invite.max_uses THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite has reached maximum usage limit');
  END IF;

  SELECT * INTO v_group FROM groups WHERE id = v_invite.group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false, 'error', 'Invite not found or expired');
  END IF;

  SELECT * INTO v_inviter FROM people WHERE id = v_invite.invited_by;

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
    ) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_invite_preview(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_invite_preview(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_invite_preview(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
