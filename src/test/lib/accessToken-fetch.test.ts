import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * D-24: supabase-js fetchWithAuth must set Authorization from accessToken
 * without a second getToken in global.fetch.
 */
describe('supabase-js accessToken Authorization', () => {
  it('sends Bearer from accessToken exactly once per REST call', async () => {
    let tokenGets = 0;
    const fetches: RequestInit[] = [];
    const fakeFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetches.push(init || {});
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = createClient('https://example.supabase.co', 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => {
        tokenGets += 1;
        return 'jwt-test';
      },
      global: { fetch: fakeFetch as typeof fetch },
    });

    await client.from('people').select('id').limit(1);

    expect(tokenGets).toBe(1);
    expect(fakeFetch).toHaveBeenCalled();
    const headers = new Headers(fetches[0].headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-test');
  });
});
