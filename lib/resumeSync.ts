import { queryClient } from './queryClient';
import { getClerkSupabaseToken, setRealtimeAuth } from './supabase';
import { reapplyPendingToCache } from './outbox';
import { flushPendingMoneyWrites } from '../services/pendingMoneySync';

// ponytail: one in-flight resume; split locks if resume paths need independent cadence
let inflight: Promise<void> | null = null;

/** Resume after sleep / network: fresh JWT, replay saved writes, then refetch. */
export async function resumeAfterBackground(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const token = await getClerkSupabaseToken({ skipCache: true });
    await setRealtimeAuth(token);
    await flushPendingMoneyWrites();
    await queryClient.invalidateQueries();
    reapplyPendingToCache(queryClient);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
