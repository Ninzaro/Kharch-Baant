-- Phase B security: claim RPC hardens to JWT sub; invite access via token RPCs;
-- Clerk-aware RLS on group_invites / email_invites / group_members join path.
--
-- Apply on live Supabase (SQL Editor or CLI) after review.
-- Depends on: requesting_user_id(), i_am_member_of(), i_created_group()
--   (from 20260412000005 / 20260412000006 and later).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. claim_person_by_email — identity from JWT only (ignore client clerk id)
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- Client may still send p_clerk_id for backwards compatibility; it must match JWT sub.
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
    email = lower(trim(p_email))
    AND is_claimed = FALSE
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_person_by_email(TEXT, TEXT, TEXT) FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. find_person_by_email — authenticated only (already); ensure REVOKE public
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'find_person_by_email'
  ) THEN
    REVOKE EXECUTE ON FUNCTION find_person_by_email(text) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION find_person_by_email(text) FROM anon;
    GRANT EXECUTE ON FUNCTION find_person_by_email(text) TO authenticated;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Invite preview by exact token (anon + authenticated — knowing token is the secret)
--    Avoids open SELECT on group_invites while supporting pre-auth InvitePage.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite group_invites%ROWTYPE;
  v_group  groups%ROWTYPE;
  v_inviter people%ROWTYPE;
  v_emails jsonb;
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', lower(trim(ei.email)))), '[]'::jsonb)
  INTO v_emails
  FROM email_invites ei
  WHERE ei.group_invite_id = v_invite.id
    AND ei.email IS NOT NULL;

  RETURN jsonb_build_object(
    'is_valid', true,
    'invite', jsonb_build_object(
      'id', v_invite.id,
      'group_id', v_invite.group_id,
      'invite_token', v_invite.invite_token,
      'invited_by', v_invite.invited_by,
      'expires_at', v_invite.expires_at,
      'max_uses', v_invite.max_uses,
      'current_uses', v_invite.current_uses,
      'is_active', v_invite.is_active,
      'created_at', v_invite.created_at,
      'updated_at', v_invite.updated_at
    ),
    'group', jsonb_build_object(
      'id', v_group.id,
      'name', v_group.name,
      'currency', v_group.currency,
      'group_type', v_group.group_type,
      'trip_start_date', v_group.trip_start_date,
      'trip_end_date', v_group.trip_end_date,
      'created_by', v_group.created_by,
      'is_archived', v_group.is_archived
    ),
    'inviter', CASE WHEN v_inviter.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_inviter.id,
      'name', v_inviter.name,
      'avatar_url', v_inviter.avatar_url
      -- email intentionally omitted from public preview
    ) END,
    'email_invites', COALESCE(v_emails, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_invite_preview(text) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Accept invite — authenticated; identity from JWT; token required
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION accept_group_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clerk_id text := requesting_user_id();
  v_person   people%ROWTYPE;
  v_invite   group_invites%ROWTYPE;
  v_group    groups%ROWTYPE;
  v_existing uuid;
BEGIN
  IF v_clerk_id IS NULL OR length(trim(v_clerk_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite');
  END IF;

  SELECT * INTO v_person
  FROM people
  WHERE clerk_user_id = v_clerk_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Person record not found');
  END IF;

  SELECT * INTO v_invite
  FROM group_invites
  WHERE invite_token = trim(p_token)
    AND COALESCE(is_active, true) = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite not found or expired');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    UPDATE group_invites SET is_active = false, updated_at = now() WHERE id = v_invite.id;
    RETURN jsonb_build_object('success', false, 'error', 'Invite has expired');
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.current_uses >= v_invite.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite has reached maximum usage limit');
  END IF;

  SELECT * INTO v_group FROM groups WHERE id = v_invite.group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Group not found');
  END IF;

  SELECT id INTO v_existing
  FROM group_members
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

  INSERT INTO group_members (group_id, person_id)
  VALUES (v_invite.group_id, v_person.id);

  UPDATE group_invites
  SET
    current_uses = COALESCE(current_uses, 0) + 1,
    updated_at = now(),
    is_active = CASE
      WHEN max_uses IS NOT NULL AND COALESCE(current_uses, 0) + 1 >= max_uses THEN false
      ELSE is_active
    END
  WHERE id = v_invite.id;

  -- Mark matching pending email invite if any
  IF v_person.email IS NOT NULL THEN
    UPDATE email_invites
    SET
      status = 'accepted',
      accepted_at = now(),
      accepted_by = v_person.id
    WHERE group_invite_id = v_invite.id
      AND status = 'pending'
      AND lower(trim(email)) = lower(trim(v_person.email));
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

GRANT EXECUTE ON FUNCTION accept_group_invite(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION accept_group_invite(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION accept_group_invite(text) FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RLS: group_invites / email_invites — no open table dumps
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS group_members ENABLE ROW LEVEL SECURITY;

-- Drop legacy / open policies
DROP POLICY IF EXISTS "Anyone can view valid invites" ON group_invites;
DROP POLICY IF EXISTS "Users can create invites for their groups" ON group_invites;
DROP POLICY IF EXISTS "Users can update invites for their groups" ON group_invites;
DROP POLICY IF EXISTS "Members can view group invites" ON group_invites;
DROP POLICY IF EXISTS "Members can create group invites" ON group_invites;
DROP POLICY IF EXISTS "Members can update group invites" ON group_invites;
DROP POLICY IF EXISTS "Members can delete group invites" ON group_invites;

DROP POLICY IF EXISTS "Members can view email invites" ON email_invites;
DROP POLICY IF EXISTS "Members can insert email invites" ON email_invites;
DROP POLICY IF EXISTS "Members can update email invites" ON email_invites;
DROP POLICY IF EXISTS "Members can delete email invites" ON email_invites;

-- Members / creators manage invites for their groups (token accept uses SECURITY DEFINER RPCs)
CREATE POLICY "Members can view group invites" ON group_invites
  FOR SELECT TO authenticated
  USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Members can create group invites" ON group_invites
  FOR INSERT TO authenticated
  WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Members can update group invites" ON group_invites
  FOR UPDATE TO authenticated
  USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Members can delete group invites" ON group_invites
  FOR DELETE TO authenticated
  USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Members can view email invites" ON email_invites
  FOR SELECT TO authenticated
  USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Members can insert email invites" ON email_invites
  FOR INSERT TO authenticated
  WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Members can update email invites" ON email_invites
  FOR UPDATE TO authenticated
  USING (i_created_group(group_id) OR i_am_member_of(group_id));

CREATE POLICY "Members can delete email invites" ON email_invites
  FOR DELETE TO authenticated
  USING (i_created_group(group_id) OR i_am_member_of(group_id));

-- group_members: members may add people; self-join only via accept_group_invite RPC
DROP POLICY IF EXISTS "Users can insert group members" ON group_members;
DROP POLICY IF EXISTS "Members can insert group members" ON group_members;

CREATE POLICY "Members can insert group members" ON group_members
  FOR INSERT TO authenticated
  WITH CHECK (i_created_group(group_id) OR i_am_member_of(group_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Audit helpers (run manually)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('claim_person_by_email','get_invite_preview','accept_group_invite');
-- SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename IN ('group_invites','email_invites','group_members')
--   ORDER BY tablename, policyname;
