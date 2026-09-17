-- Kharch-Baant Database Schema for Supabase
-- Run this script in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create people table
CREATE TABLE people (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create groups table
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    group_type TEXT NOT NULL CHECK (group_type IN ('trip', 'family_trip', 'flat_sharing', 'expense_management', 'other')),
    trip_start_date DATE,
    trip_end_date DATE,
    CHECK (
        (group_type IN ('trip', 'family_trip') AND trip_start_date IS NOT NULL AND trip_end_date IS NOT NULL AND trip_start_date <= trip_end_date)
        OR (group_type NOT IN ('trip', 'family_trip') AND trip_start_date IS NULL AND trip_end_date IS NULL)
    ),
    created_by UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create group_members junction table
CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, person_id)
);

-- Create payment_sources table
CREATE TABLE payment_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Credit Card', 'UPI', 'Cash', 'Other')),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    paid_by_id UUID NOT NULL REFERENCES people(id),
    date DATE NOT NULL,
    tag TEXT NOT NULL CHECK (tag IN ('Food', 'Groceries', 'Transport', 'Travel', 'Housing', 'Utilities', 'Entertainment', 'Shopping', 'Health', 'Other')),
    payment_source_id UUID REFERENCES payment_sources(id),
    comment TEXT,
    split_mode TEXT NOT NULL CHECK (split_mode IN ('equal', 'unequal', 'percentage', 'shares')),
    split_participants JSONB NOT NULL,
    created_by UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_person_id ON group_members(person_id);
CREATE INDEX idx_transactions_group_id ON transactions(group_id);
CREATE INDEX idx_transactions_paid_by_id ON transactions(paid_by_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_tag ON transactions(tag);

-- AI item classification cache (global, shared across all users)
CREATE TABLE ai_item_cache (
  normalized_name  TEXT        PRIMARY KEY,
  category         TEXT        NOT NULL
                   CHECK (category IN ('Food','Groceries','Transport','Travel',
                                       'Housing','Utilities','Entertainment',
                                       'Shopping','Health','Other')),
  source           TEXT        NOT NULL DEFAULT 'gemini'
                   CHECK (source IN ('keyword','gemini')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_item_cache ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can add new entries (no UPDATE/DELETE — entries are immutable)
CREATE POLICY "cache_insert"
  ON ai_item_cache FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_people_updated_at BEFORE UPDATE ON people FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payment_sources_updated_at BEFORE UPDATE ON payment_sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial sample data
-- First, insert people with specific UUIDs for consistency
INSERT INTO people (id, name, avatar_url) VALUES
    ('00000000-0000-0000-0000-000000000001', 'You', ''),
    ('00000000-0000-0000-0000-000000000002', 'Alice', ''),
    ('00000000-0000-0000-0000-000000000003', 'Bob', ''),
    ('00000000-0000-0000-0000-000000000004', 'Charlie', ''),
    ('00000000-0000-0000-0000-000000000005', 'Diana', '');

-- Insert groups with specific UUIDs
INSERT INTO groups (id, name, currency, group_type, trip_start_date, trip_end_date, created_by) VALUES
    ('10000000-0000-0000-0000-000000000001', 'Trip to Bali', 'INR', 'trip', '2024-07-09', '2024-07-15', '00000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002', 'Apartment Bills', 'EUR', 'flat_sharing', NULL, NULL, '00000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000003', 'Weekend Getaway', 'USD', 'family_trip', '2024-07-14', '2024-07-16', '00000000-0000-0000-0000-000000000001');

-- Insert group members using the UUIDs
INSERT INTO group_members (group_id, person_id) VALUES
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
    ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004'),
    ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005'),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002'),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004'),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005');

-- Insert payment source with UUID
INSERT INTO payment_sources (id, name, type) VALUES
    ('20000000-0000-0000-0000-000000000001', 'Cash', 'Cash');

-- Insert transactions with proper UUIDs
INSERT INTO transactions (id, group_id, description, amount, paid_by_id, date, tag, split_mode, split_participants, created_by) VALUES
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Flight tickets', 50000, '00000000-0000-0000-0000-000000000001', '2024-07-10', 'Travel', 'equal', '[{"personId": "00000000-0000-0000-0000-000000000001", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000002", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000003", "value": 1}]', '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Hotel booking', 75000, '00000000-0000-0000-0000-000000000002', '2024-07-11', 'Housing', 'equal', '[{"personId": "00000000-0000-0000-0000-000000000001", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000002", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000003", "value": 1}]', '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Dinner at fancy restaurant', 12000, '00000000-0000-0000-0000-000000000003', '2024-07-12', 'Food', 'equal', '[{"personId": "00000000-0000-0000-0000-000000000001", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000002", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000003", "value": 1}]', '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Electricity Bill', 75, '00000000-0000-0000-0000-000000000004', '2024-07-01', 'Utilities', 'equal', '[{"personId": "00000000-0000-0000-0000-000000000001", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000004", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000005", "value": 1}]', '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'Internet Bill', 50, '00000000-0000-0000-0000-000000000001', '2024-07-05', 'Utilities', 'equal', '[{"personId": "00000000-0000-0000-0000-000000000001", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000004", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000005", "value": 1}]', '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', 'Gas for the car', 60, '00000000-0000-0000-0000-000000000002', '2024-07-15', 'Transport', 'equal', '[{"personId": "00000000-0000-0000-0000-000000000001", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000002", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000004", "value": 1}]', '00000000-0000-0000-0000-000000000001'),
    ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', 'Groceries for the trip', 120, '00000000-0000-0000-0000-000000000001', '2024-07-15', 'Groceries', 'equal', '[{"personId": "00000000-0000-0000-0000-000000000001", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000002", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000004", "value": 1}, {"personId": "00000000-0000-0000-0000-000000000005", "value": 1}]', '00000000-0000-0000-0000-000000000001');

-- Enable Row Level Security (RLS)
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sources ENABLE ROW LEVEL SECURITY;

-- ⚠ DO NOT create "Allow all operations" policies here.
-- Open policies (USING (true) FOR ALL) leak every user's data to the anon key.
-- Apply the Clerk-aware policies from supabase/migrations/ instead, especially:
--   20260412000005_use_clerk_user_id_in_rls.sql
--   20260412000006_fix_requesting_user_id.sql
--   20260412000007_fix_group_members_visibility.sql
--   20260728000000_phase_a_rls_people_visibility.sql
--   20260912000000_groups_created_by_person_fk.sql
--   20260912000002_people_email_normalize.sql
--   20260912000003_invite_and_deletion_uniques.sql
--   20260912000004_drop_unused_functions.sql
--   20260912000005_groups_insert_own_person.sql
--   20260912000007_create_my_group.sql
--   20260913000000_replica_identity_default.sql
--   20260914000000_transactions_money_invariants.sql
--   20260916000000_transaction_authorship.sql
--   20260917000000_identity_claim_containment.sql
--   20260917000001_restrict_person_lookup.sql
--   20260917000002_restrict_people_visibility.sql
--   20260917000003_restrict_invite_preview.sql
--   20260917000004_disable_ai_cache_reads.sql
--   20260917000005_delete_group_server_side.sql
--   20260917170449_restrict_people_insert.sql
-- Fresh installs: run those migrations after this schema file.

-- R-20 containment: authenticated clients create people only through RPCs.
REVOKE INSERT ON TABLE public.people FROM authenticated;
