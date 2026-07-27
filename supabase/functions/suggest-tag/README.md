# suggest-tag Edge Function

Server-side Gemini category suggestion. Keeps `GEMINI_API_KEY` off the client.

## Secrets

```bash
supabase secrets set GEMINI_API_KEY=your_key_here
# optional:
supabase secrets set GEMINI_MODEL=gemini-2.0-flash
```

## Deploy

```bash
supabase functions deploy suggest-tag
```

## Client

`services/geminiService.ts` → `supabase.functions.invoke('suggest-tag')`.
If the function is missing or unconfigured, classification falls back to keywords + cache only.
