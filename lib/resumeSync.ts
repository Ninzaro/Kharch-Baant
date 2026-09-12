import { queryClient } from './queryClient';
import { getClerkSupabaseToken, setRealtimeAuth } from './supabase';

/** Resume after sleep / network: fresh JWT on Realtime, then refetch REST. */
export async function resumeAfterBackground(): Promise<void> {
  const token = await getClerkSupabaseToken({ skipCache: true });
  await setRealtimeAuth(token);
  await queryClient.invalidateQueries();
}
