-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DANGER — DO NOT RUN ON PRODUCTION / SHARED DATABASES                    ║
-- ║  Disabling RLS exposes all rows to the anon key. Historical emergency    ║
-- ║  only. Prefer supabase/migrations/* Clerk RLS policies.                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- EMERGENCY FIX: Disable Row Level Security temporarily
-- Run this in your Supabase SQL Editor to fix the immediate issue

-- Disable RLS on people table to fix the immediate error
ALTER TABLE people DISABLE ROW LEVEL SECURITY;

-- Optional: Also disable on other tables if needed
-- ALTER TABLE groups DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE payment_sources DISABLE ROW LEVEL SECURITY;

-- Note: This is a temporary fix. For production, you should:
-- 1. Either keep RLS disabled for simpler setup, OR
-- 2. Update the RLS policies to match your actual schema columns
-- 3. Your current schema uses 'clerk_user_id' not 'user_id'
