# Features to be added

Parked product work. Not part of the `audit/03-deadcode.md` pass. Do not implement while closing dead-code findings unless explicitly scheduled.

---

## Group-wise summary report (Excel / PDF)

**Origin:** discussed after D-05 (creator-only group delete). Deletion-request UI was removed instead of building reports into that flow.

**Intent:** One shareable group report for **active groups** (on demand) and as a **last step before the creator deletes** a group. Same feature, two entry points. Hard delete still removes DB rows — a report after delete only exists if the file was saved first (or a future snapshot table is designed).

### Contents

- Top spender
- Top spend category
- Date-wise / per-day spend
- Per member: amount paid, share of expenses, final balance
- Overall group picture (totals + who owes whom)

### Formats and share

- User picks **Excel** or **PDF**
- Download + share (Web Share / Capacitor), not PNG-only

### Existing building blocks (do not duplicate blindly)

- `GroupSummaryModal` — total spent, by payer, by category; PNG via `html2canvas`
- `ShareModal` — share/download a PNG
- `calculateGroupBalances` — canonical nets (use this; do not re-roll)

### Stack note

PDF/Excel likely need new libraries (`jspdf`, SheetJS/ExcelJS). That is a major-dep exception: update `ARCHITECTURE.md` §2 before adding them.

### Effort (rough)

- MVP (stats + one format + download + optional delete-gate): ~3–5 days
- Full (both formats, share, Android, tests, polish): ~1–2 weeks
- Persist reports after delete: extra design (snapshot table + RLS)

### Status

Not started. Resume only when the user names this feature (not a D-xx id).
