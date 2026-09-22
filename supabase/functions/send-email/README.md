# send-email Edge Function

Sends transactional email via Brevo. **API key stays in Supabase secrets only.**

## Secrets

```bash
supabase secrets set BREVO_API_KEY=xkeysib-your_key
supabase secrets set BREVO_SENDER_EMAIL=noreply@your-domain.com
```

`BREVO_SENDER_EMAIL` must be a sender already verified in Brevo.

Do **not** put these in `VITE_*` or `.env.local` for the browser.

## Deploy

```bash
supabase functions deploy send-email
```

## Auth

Requires `Authorization: Bearer <Clerk JWT>` (sent automatically by `supabase.functions.invoke` via the app's fetch interceptor).

## Types

`group_invite`
