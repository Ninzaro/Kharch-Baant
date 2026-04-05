-- supabase/migrations/20260405000000_add_email_claim_to_people.sql
-- NOTE: This project uses a remote Supabase instance (not local CLI).
-- This migration file is committed for version control purposes.
-- Apply it manually via the Supabase dashboard SQL editor.

-- Add email as identity anchor for deduplication and claim matching
ALTER TABLE people ADD COLUMN IF NOT EXISTS email TEXT;

-- Explicit claim status (replaces implicit clerk_user_id IS NOT NULL check)
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_claimed BOOLEAN NOT NULL DEFAULT FALSE;

-- Track how a person was added (analytics + future UX)
ALTER TABLE people ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Partial unique index: allows many null-email dummies, prevents duplicate emails
CREATE UNIQUE INDEX IF NOT EXISTS people_email_unique ON people (email) WHERE email IS NOT NULL;

-- Mark all existing authenticated rows as claimed
UPDATE people SET is_claimed = TRUE WHERE clerk_user_id IS NOT NULL;

-- Mark existing self-registered users as source='self'
UPDATE people SET source = 'self' WHERE clerk_user_id IS NOT NULL;
