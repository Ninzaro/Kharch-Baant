# Backups without PITR (R-32)

Play production is live. This Supabase plan has **no PITR**. The backup is a nightly logical dump on this PC. No app or Clerk changes.

## Nightly dump

Script: `scripts/nightly-db-dump.ps1`

It writes `schema-*.sql` and `data-*.sql` to `%USERPROFILE%\Kharch-Baant-backups` and deletes files older than 14 days. The folder is outside the git repo.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\nightly-db-dump.ps1
```

The machine must be on, Docker Desktop must be running (`supabase db dump` uses a `pg_dump` container), and `npx supabase` must already be logged in and linked to the Play project. A scheduled task only runs if Windows is awake.

The first dump was not taken on 2026-09-22: Docker was not running on this PC. Do not register the scheduled task until one manual dump succeeds.

Register once (2:00 local time):

```powershell
schtasks /Create /TN "Kharch-Baant nightly dump" /SC DAILY /ST 02:00 /RL LIMITED /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -File D:\Coding\Kharch-Baant\scripts\nightly-db-dump.ps1"
```

Copy the newest pair to a second disk or cloud drive you control. Do not commit the SQL.

## Restore test (still required)

1. Create a throwaway Supabase project (free is enough).
2. Apply `schema-*.sql`, then `data-*.sql`.
3. Confirm a known group and balance, then delete the throwaway project.

That test has not been run yet. A dump that was never restored is not a backup.

## After an incident

Restore the newest dump pair onto a new database, confirm balances, then cut over. Do not overwrite production until that copy looks right.

## Do not

- Store dumps in this git repo.
- Disable RLS to “make restore easier.”
- Change Clerk / Google sign-in as part of backup.
