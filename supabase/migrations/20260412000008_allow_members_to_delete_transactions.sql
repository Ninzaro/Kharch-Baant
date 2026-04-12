-- supabase/migrations/20260412000008_allow_members_to_delete_transactions.sql
-- NOTE: Apply manually via Supabase dashboard SQL editor.
--
-- Problem: Only the group creator can delete transactions (i_created_group check).
--   Non-creator members see an apparent delete (optimistic UI) but the DB
--   silently rejects it, so the transaction reappears on next refresh.
--
-- Fix: Allow any group member to delete transactions, matching the UPDATE policy.

DROP POLICY IF EXISTS "Users can delete group transactions" ON transactions;

CREATE POLICY "Users can delete group transactions" ON transactions
  FOR DELETE USING (i_created_group(group_id) OR i_am_member_of(group_id));
