-- Kharch-Baant Database Migration: Supabase Auth to Clerk Auth
-- Run this in your Supabase SQL Editor AFTER setting up Clerk Custom JWT Template

-- 1. Create a custom function that extracts the 'sub' claim from the JWT (this is the Clerk user ID)
CREATE OR REPLACE FUNCTION requesting_user_id() RETURNS text AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')
$$ LANGUAGE sql STABLE;


-- 2. DROP EVERYTHING FIRST so PostgreSQL allows altering column types
-- People
DROP POLICY IF EXISTS "Users can view people in their groups" ON people;
DROP POLICY IF EXISTS "Users can insert people" ON people;
DROP POLICY IF EXISTS "Users can update their people" ON people;

-- Groups
DROP POLICY IF EXISTS "Users can view their groups" ON groups;
DROP POLICY IF EXISTS "Users can insert groups" ON groups;
DROP POLICY IF EXISTS "Users can update their groups" ON groups;
DROP POLICY IF EXISTS "Users can delete their groups" ON groups;

-- Group Members
DROP POLICY IF EXISTS "Users can view group members" ON group_members;
DROP POLICY IF EXISTS "Users can insert group members" ON group_members;
DROP POLICY IF EXISTS "Users can delete group members" ON group_members;

-- Payment Sources
DROP POLICY IF EXISTS "Users can view own payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can insert payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can update own payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can delete own payment sources" ON payment_sources;

-- Drop previous naming variations that might exist on live database
DROP POLICY IF EXISTS "Users can view their payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can insert their payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can update their payment sources" ON payment_sources;
DROP POLICY IF EXISTS "Users can delete their payment sources" ON payment_sources;

-- Transactions
DROP POLICY IF EXISTS "Users can view group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can insert group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can update group transactions" ON transactions;
DROP POLICY IF EXISTS "Users can delete group transactions" ON transactions;

-- Foreign Keys
ALTER TABLE IF EXISTS people DROP CONSTRAINT IF EXISTS people_user_id_fkey;
ALTER TABLE IF EXISTS groups DROP CONSTRAINT IF EXISTS groups_created_by_fkey;
ALTER TABLE IF EXISTS payment_sources DROP CONSTRAINT IF EXISTS payment_sources_user_id_fkey;


-- 3. Modify or Add missing auth columns as TEXT (for Clerk IDs)
DO $$ 
BEGIN
    -- People Table: Add or Alter user_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'people' AND column_name = 'user_id') THEN
        ALTER TABLE people ADD COLUMN user_id TEXT;
    ELSE
        ALTER TABLE people ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    END IF;

    -- Groups Table: Add or Alter created_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'groups' AND column_name = 'created_by') THEN
        ALTER TABLE groups ADD COLUMN created_by TEXT;
    ELSE
        ALTER TABLE groups ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;
    END IF;

    -- Payment Sources Table: Add or Alter user_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_sources' AND column_name = 'user_id') THEN
        ALTER TABLE payment_sources ADD COLUMN user_id TEXT;
    ELSE
        ALTER TABLE payment_sources ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    END IF;
END $$;


-- 4. RECREATE POLICIES using requesting_user_id()

-- PEOPLE
CREATE POLICY "Users can view people in their groups" ON people
    FOR SELECT USING (
        user_id = requesting_user_id() OR
        EXISTS (
            SELECT 1 FROM group_members gm
            JOIN groups g ON gm.group_id = g.id
            WHERE g.created_by = requesting_user_id() AND gm.person_id = people.id
        )
    );

CREATE POLICY "Users can insert people" ON people
    FOR INSERT WITH CHECK (user_id = requesting_user_id());

CREATE POLICY "Users can update their people" ON people
    FOR UPDATE USING (user_id = requesting_user_id());

-- GROUPS
CREATE POLICY "Users can view their groups" ON groups
    FOR SELECT USING (
        created_by = requesting_user_id() OR
        EXISTS (
            SELECT 1 FROM group_members gm
            JOIN people p ON gm.person_id = p.id
            WHERE gm.group_id = groups.id AND p.user_id = requesting_user_id()
        )
    );

CREATE POLICY "Users can insert groups" ON groups
    FOR INSERT WITH CHECK (created_by = requesting_user_id());

CREATE POLICY "Users can update their groups" ON groups
    FOR UPDATE USING (created_by = requesting_user_id());

CREATE POLICY "Users can delete their groups" ON groups
    FOR DELETE USING (created_by = requesting_user_id());

-- GROUP MEMBERS
CREATE POLICY "Users can view group members" ON group_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = group_members.group_id AND g.created_by = requesting_user_id()
        ) OR
        EXISTS (
            SELECT 1 FROM people p
            WHERE p.id = group_members.person_id AND p.user_id = requesting_user_id()
        )
    );

CREATE POLICY "Users can insert group members" ON group_members
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = group_members.group_id AND g.created_by = requesting_user_id()
        )
    );

CREATE POLICY "Users can delete group members" ON group_members
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = group_members.group_id AND g.created_by = requesting_user_id()
        )
    );

-- PAYMENT SOURCES
CREATE POLICY "Users can view own payment sources" ON payment_sources
    FOR SELECT USING (user_id = requesting_user_id());

CREATE POLICY "Users can insert payment sources" ON payment_sources
    FOR INSERT WITH CHECK (user_id = requesting_user_id());

CREATE POLICY "Users can update own payment sources" ON payment_sources
    FOR UPDATE USING (user_id = requesting_user_id());

CREATE POLICY "Users can delete own payment sources" ON payment_sources
    FOR DELETE USING (user_id = requesting_user_id());

-- TRANSACTIONS
CREATE POLICY "Users can view group transactions" ON transactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = transactions.group_id AND (
                g.created_by = requesting_user_id() OR
                EXISTS (
                    SELECT 1 FROM group_members gm
                    JOIN people p ON gm.person_id = p.id
                    WHERE gm.group_id = g.id AND p.user_id = requesting_user_id()
                )
            )
        )
    );

CREATE POLICY "Users can insert group transactions" ON transactions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = transactions.group_id AND (
                g.created_by = requesting_user_id() OR
                EXISTS (
                    SELECT 1 FROM group_members gm
                    JOIN people p ON gm.person_id = p.id
                    WHERE gm.group_id = g.id AND p.user_id = requesting_user_id()
                )
            )
        )
    );

CREATE POLICY "Users can update group transactions" ON transactions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = transactions.group_id AND (
                g.created_by = requesting_user_id() OR
                EXISTS (
                    SELECT 1 FROM group_members gm
                    JOIN people p ON gm.person_id = p.id
                    WHERE gm.group_id = g.id AND p.user_id = requesting_user_id()
                )
            )
        )
    );

CREATE POLICY "Users can delete group transactions" ON transactions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = transactions.group_id AND g.created_by = requesting_user_id()
        )
    );

-- 5. Drop trigger that creates user_profile automatically via auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
