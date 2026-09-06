import { describe, expect, it, vi } from 'vitest';
import {
  consumeCapturedSsoCallback,
  historyPathForAppUrl,
  isSsoCallbackUrl,
  queryAndHashFromAppUrl,
  applyNativeAppUrl,
} from '../../../utils/nativeDeepLinks';

describe('nativeDeepLinks', () => {
  it('detects custom-scheme SSO callbacks', () => {
    expect(isSsoCallbackUrl('kharchbaant://sso-callback?__clerk_created_session=sess_abc')).toBe(true);
    expect(isSsoCallbackUrl('kharchbaant://invite/token')).toBe(false);
  });

  it('preserves query parameters on the in-app history path', () => {
    const next = historyPathForAppUrl(
      'kharchbaant://sso-callback?__clerk_created_session=sess_abc&__clerk_status=complete'
    );
    expect(next).toBe('/sso-callback?__clerk_created_session=sess_abc&__clerk_status=complete');
  });

  it('preserves hash parameters from Clerk redirects', () => {
    const next = historyPathForAppUrl('kharchbaant://sso-callback#__clerk_status=complete');
    expect(next).toBe('/sso-callback#__clerk_status=complete');
  });

  it('maps invite deep links without treating them as SSO', () => {
    expect(historyPathForAppUrl('kharchbaant://invite/abc%20123')).toBe('/invite/abc 123');
  });

  it('parses intent-style host plus query', () => {
    const { query } = queryAndHashFromAppUrl(
      'kharchbaant://sso-callback?__clerk_created_session=sess_1'
    );
    expect(query).toBe('?__clerk_created_session=sess_1');
  });

  it('calls clerk.handleRedirectCallback(params, spaNavigate) without window.location', async () => {
    const clerk: any = {
      loaded: Promise.resolve(),
      session: null,
      user: null,
      client: { signedInSessions: [] },
      handleRedirectCallback: vi.fn().mockImplementation(async () => {
        clerk.session = { id: 'sess_x' };
        clerk.user = { id: 'user_x' };
        clerk.client = { signedInSessions: [{ id: 'sess_x' }] };
      }),
    };
    applyNativeAppUrl('kharchbaant://sso-callback?__clerk_created_session=sess_x');
    const ok = await consumeCapturedSsoCallback(clerk);
    expect(ok).toBe(true);
    expect(clerk.handleRedirectCallback).toHaveBeenCalledTimes(1);
    expect(clerk.handleRedirectCallback.mock.calls[0][0]).toMatchObject({
      signInFallbackRedirectUrl: '/',
    });
    expect(typeof clerk.handleRedirectCallback.mock.calls[0][1]).toBe('function');
  });
});
