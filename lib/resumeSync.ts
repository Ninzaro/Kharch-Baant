import { queryClient } from './queryClient';
import { getClerkSupabaseToken, setRealtimeAuth } from './supabase';

// ponytail: one in-flight resume; split locks if resume paths need independent cadence
let inflight: Promise<void> | null = null;

/** Resume after sleep / network: fresh JWT on Realtime, then refetch REST. */
export async function resumeAfterBackground(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const token = await getClerkSupabaseToken({ skipCache: true });
    await setRealtimeAuth(token);
    await queryClient.invalidateQueries();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
