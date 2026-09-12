# 🚀 SUPABASE DATABASE MIGRATION GUIDE

This guide will help you migrate from your current Supabase database to a new one with the complete invite system included.

## 📋 What You'll Get

After migration, your new database will have:
- ✅ All your existing tables (people, groups, transactions, payment_sources)
- ✅ All applied migrations (Clerk integration, ownership, archiving)
- ✅ **NEW**: Complete invite system (temporary links, email invitations)
- ✅ **NEW**: MailerSend integration ready
- ✅ Performance optimized with proper indexes
- ✅ Clean, production-ready schema

## 🔄 Migration Steps

### Step 1: Create New Supabase Project
1. Go to https://supabase.com/dashboard
2. Click **"New Project"**
3. Choose your organization
4. Set project name: `Kharch-Baant-Production`
5. Choose region (same as current for better performance)
6. Set a strong database password (save it!)
7. Wait for project creation (2-3 minutes)

### Step 2: Run Database Migration
1. In your new project, go to **SQL Editor**
2. Click **"New Query"**
3. Copy the entire contents of `migrations/COMPLETE_DATABASE_MIGRATION.sql`
4. Paste into the SQL Editor
5. Click **"Run"** to execute the migration
6. ✅ You should see "Success. No rows returned" message

### Step 3: Get New Project Credentials
1. Go to **Settings → API** in your new project
2. Copy the **Project URL** (e.g., `https://abcdef123.supabase.co`)
3. Copy the **anon public** key
4. Go to **Settings → Database**
5. Copy the **Connection string** (for migrations)

### Step 4: Update Environment Variables
1. Copy `.env.local.new` to `.env.local`
2. Replace placeholder values with your new project details:
   ```bash
   VITE_SUPABASE_URL=https://YOUR_NEW_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=your_new_anon_key_here
   SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_NEW_PROJECT_ID.supabase.co:5432/postgres
   ```

### Step 5: Update TypeScript Types
1. Install Supabase CLI if not already installed:
   ```bash
   npm install -g supabase
   ```
2. Generate new types for your database:
   ```bash
   supabase gen types typescript --project-id YOUR_NEW_PROJECT_ID > lib/database.types.ts
   ```

### Step 6: Test Your Application
1. Start your development server:
   ```bash
   npm run dev
   ```
2. Test basic functionality:
   - ✅ Sign in with Clerk
   - ✅ Create a group
   - ✅ Add transactions
   - ✅ **NEW**: Try "Invite with Link" button

## 🎯 What's New After Migration

### Invite System Features
1. **Temporary Links**: 30-day expiration, multi-use capability
2. **Email Invitations**: Send invites via MailerSend
3. **User Isolation**: Clean data separation between users
4. **Security**: Secure token generation, usage tracking

### Database Tables Added
- `group_invites`: Manages shareable invite links
- `email_invites`: Tracks email invitation status

### New API Functions Available
- `createGroupInvite()`: Generate invite links
- `validateInvite()`: Check invite validity
- `acceptInvite()`: Join group via invite
- `sendInviteEmail()`: Send email invitations (needs MailerSend setup)

## 🔧 Optional: Set Up MailerSend (for Email Invites)

1. Go to https://www.mailersend.com/
2. Create account and verify domain
3. Get API key from dashboard
4. Set Edge secrets (not `VITE_*`): `MAILERSEND_API_KEY` and `MAILERSEND_FROM_EMAIL` in the Supabase dashboard. See `.env.example`.

## 🚨 Important Notes

- **Keep your old database**: Don't delete it until you're sure the migration worked
- **Test thoroughly**: Make sure all features work before switching users
- **Clerk stays the same**: Your authentication settings don't change
- **User data**: Start fresh or migrate specific data as needed

## 🐛 Troubleshooting

### If migration fails:
1. Check SQL Editor for error messages
2. Ensure your new project is fully created
3. Try running sections of the migration script separately

### If app doesn't connect:
1. Double-check environment variables
2. Ensure anon key is correctly copied
3. Verify project URL format

### If TypeScript errors:
1. Regenerate database types
2. Restart your development server
3. Check import paths in your code

## ✅ Success Checklist

After migration, you should be able to:
- [ ] Sign in with Clerk authentication
- [ ] Create and view groups
- [ ] Add transactions and manage expenses
- [ ] **NEW**: Click "Invite with Link" and get shareable URL
- [ ] **NEW**: Use "Add New Member" to send email invites
- [ ] See clean user isolation (no dummy data)

## 🎉 You're Done!

Your new database is now production-ready with the complete invite system. You can now implement the remaining frontend features to use the new invite functionality.

---

**Need Help?** If you encounter any issues during migration, check the error messages carefully and ensure all steps were followed exactly as described.