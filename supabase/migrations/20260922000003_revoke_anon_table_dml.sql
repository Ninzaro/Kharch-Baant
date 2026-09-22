-- Leftover GRANT ALL to anon. Signed-in clients use the authenticated role.
-- Pre-auth invite preview is get_invite_preview (SECURITY DEFINER), not a table SELECT.

REVOKE ALL ON TABLE
  public.ai_item_cache,
  public.email_invites,
  public.group_deletion_requests,
  public.group_invites,
  public.group_members,
  public.groups,
  public.payment_sources,
  public.people,
  public.transactions
FROM anon;
