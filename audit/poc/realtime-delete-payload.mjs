/**
 * Proof for S-02: subscribe event '*' on transactions, delete a row, print old_record keys.
 *
 *   $env:VITE_SUPABASE_URL="https://….supabase.co"
 *   $env:VITE_SUPABASE_ANON_KEY="eyJ…"
 *   $env:USER_JWT="eyJ…"   # Clerk session JWT
 *   node audit/poc/realtime-delete-payload.mjs
 *
 * After REPLICA IDENTITY DEFAULT, old_record should only have `id`.
 * The app no longer binds DELETE; this script still uses '*' so we prove the WAL payload.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const jwt = process.env.USER_JWT;
if (!url || !anon || !jwt) {
  console.error('Need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, USER_JWT');
  process.exit(1);
}

const supabase = createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${jwt}` } },
  realtime: { params: { apikey: anon } },
});

await supabase.realtime.setAuth(jwt);

const ch = supabase
  .channel('poc-delete-tx')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, (payload) => {
    console.log('eventType', payload.eventType);
    console.log('old keys', payload.old ? Object.keys(payload.old) : payload.old);
    console.log('old', payload.old);
    process.exit(0);
  })
  .subscribe((s) => console.log('channel', s));

console.log('Subscribed. Delete a transactions row from another session, then wait.');
setTimeout(() => {
  console.error('timeout: no event in 60s');
  ch.unsubscribe();
  process.exit(2);
}, 60_000);
