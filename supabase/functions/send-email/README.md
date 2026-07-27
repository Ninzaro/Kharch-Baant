# send-email Edge Function

Sends transactional email via MailerSend. **API key stays in Supabase secrets only.**

## Secrets

```bash
supabase secrets set MAILERSEND_API_KEY=mlsn.your_rotated_key
supabase secrets set MAILERSEND_FROM_EMAIL=noreply@your-domain.com
```

Do **not** put these in `VITE_*` or `.env.local` for the browser.

## Deploy

```bash
supabase functions deploy send-email
```

## Auth

Requires `Authorization: Bearer <Clerk JWT>` (sent automatically by `supabase.functions.invoke` via the app's fetch interceptor).

## Types

`welcome` | `group_invite` | `member_added` | `settle_up` | `new_expense`
