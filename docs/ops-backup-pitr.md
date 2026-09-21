# Point-in-time recovery and backups (R-33)

Play production is live. If a member (or a bug) deletes data, **RLS cannot undo it**. Enable PITR in the dashboard. This is ops only — no app or Clerk changes.

## Enable PITR (Supabase)

1. [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. **Project Settings → Add-ons** (or **Database → Backups**, depending on plan).
3. Enable **Point in Time Recovery** if the plan includes it.
4. Confirm a **retention window** (7 days is typical).
5. Note the timezone; restores are UTC.

If PITR is not on the plan:

1. Schedule a nightly `pg_dump` to storage **you** control (not only Supabase).
2. Test **one restore** to a throwaway project before you need it.

```bash
# Example (service role stays off the laptop in production; run from a locked CI secret)
pg_dump "$DATABASE_URL" --format=custom --file="kharch-baant-$(date -u +%Y%m%d).dump"
```

## After an incident

- PITR: restore to a timestamp **before** the wipe; do not overwrite production until you verify the copy.
- Dump: restore to a new database, confirm balances, then cut over.

## Do not

- Store dumps in this git repo.
- Disable RLS to “make restore easier.”
- Change Clerk / Google sign-in as part of backup.
