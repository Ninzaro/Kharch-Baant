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

-- Mark all existing authenticated rows as claimed + source before dedup
UPDATE people SET is_claimed = TRUE, source = 'self' WHERE clerk_user_id IS NOT NULL;

-- Deduplicate: for rows that share an email, keep the one with clerk_user_id (claimed).
-- If none is claimed, keep the most recently created one.
-- Nullify email on all duplicates except the keeper so the unique index can be created.
UPDATE people
SET email = NULL
WHERE email IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (email)
      id
    FROM people
    WHERE email IS NOT NULL
    ORDER BY email,
             (clerk_user_id IS NOT NULL) DESC,  -- prefer claimed rows
             created_at DESC                     -- then most recent
  );

-- Partial unique index: allows many null-email dummies, prevents duplicate emails
CREATE UNIQUE INDEX IF NOT EXISTS people_email_unique ON people (email) WHERE email IS NOT NULL;
