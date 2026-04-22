import React from 'react'
import { render, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for the Clerk → Supabase Realtime auth bridge.
 *
 * The bug these tests guard against: `setRealtimeAuth` was defined inside
 * SupabaseAuthContext but never invoked. Realtime WebSocket channels therefore
 * connected with only the anon apikey, and any RLS policy that depends on
 * auth.jwt() over Realtime received zero events.
 *
 * See ARCHITECTURE.md §9 for the auth flow and §15 for the history.
 */

// --- Mocks -------------------------------------------------------------------
// vi.mock factories are hoisted above imports, so any shared spies must be
// declared with vi.hoisted to be visible at that time.
const h = vi.hoisted(() => ({
  mockGetToken: vi.fn<() => Promise<string | null>>(),
  mockSignOut: vi.fn<() => Promise<void>>(),
  mockEnsureUserExists: vi.fn(),
  setRealtimeAuthSpy: vi.fn<(token?: string | null) => Promise<void>>(),
  clerkState: {
    user: null as any,
    session: null as any,
    isUserLoaded: true,
    isSessionLoaded: true,
  },
}))

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: h.clerkState.user, isLoaded: h.clerkState.isUserLoaded }),
  useSession: () => ({ session: h.clerkState.session, isLoaded: h.clerkState.isSessionLoaded }),
  useClerk: () => ({ signOut: h.mockSignOut }),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { realtime: { setAuth: vi.fn() } },
  getClerkSupabaseToken: async () => {
    const token = await h.mockGetToken()
    return token ?? ''
  },
  setRealtimeAuth: h.setRealtimeAuthSpy,
}))

vi.mock('../../../services/supabaseApiService', () => ({
  ensureUserExists: (...args: any[]) => h.mockEnsureUserExists(...args),
}))

// Import AFTER mocks are registered.
import { SupabaseAuthProvider, useAuth } from '../../../contexts/SupabaseAuthContext'

// --- Test harness ------------------------------------------------------------

const Probe: React.FC<{ onAuth?: (v: ReturnType<typeof useAuth>) => void }> = ({ onAuth }) => {
  const auth = useAuth()
  onAuth?.(auth)
  return <div data-testid="probe">{auth.person?.id ?? 'no-person'}</div>
}

const renderWithProvider = (onAuth?: (v: ReturnType<typeof useAuth>) => void) =>
  render(
    <SupabaseAuthProvider>
      <Probe onAuth={onAuth} />
    </SupabaseAuthProvider>,
  )

// --- Setup -------------------------------------------------------------------

beforeEach(() => {
  // NOTE: fake timers are opt-in per-test (see interval/unmount tests below).
  // Using them globally breaks @testing-library's waitFor, which polls via
  // setTimeout.
  h.setRealtimeAuthSpy.mockReset().mockResolvedValue(undefined)
  h.mockGetToken.mockReset().mockResolvedValue('jwt-token-v1')
  h.mockSignOut.mockReset().mockResolvedValue(undefined)
  h.mockEnsureUserExists.mockReset().mockResolvedValue({
    id: 'person-1',
    name: 'Test User',
    avatarUrl: '',
    email: 'test@example.com',
    authUserId: 'clerk-user-1',
  })
  h.clerkState.user = null
  h.clerkState.session = null
  h.clerkState.isUserLoaded = true
  h.clerkState.isSessionLoaded = true
})

afterEach(() => {
  vi.useRealTimers() // safe even if a test didn't enable fake timers
})

// --- Tests -------------------------------------------------------------------

describe('SupabaseAuthContext — Realtime auth wiring', () => {
  it('calls setRealtimeAuth with the Clerk JWT when a session loads', async () => {
    h.clerkState.user = { id: 'clerk-user-1', primaryEmailAddress: { emailAddress: 'test@example.com' }, fullName: 'Test User' }
    h.clerkState.session = { id: 'sess-1' }

    renderWithProvider()

    await waitFor(() => {
      expect(h.setRealtimeAuthSpy).toHaveBeenCalledWith('jwt-token-v1')
    })
  })

  it('primes Realtime auth BEFORE resolving the person (so bridges find an authed WS)', async () => {
    h.clerkState.user = { id: 'clerk-user-1', primaryEmailAddress: { emailAddress: 'test@example.com' }, fullName: 'Test User' }
    h.clerkState.session = { id: 'sess-1' }

    const callOrder: string[] = []
    h.setRealtimeAuthSpy.mockImplementation(async () => {
      callOrder.push('setRealtimeAuth')
    })
    h.mockEnsureUserExists.mockImplementation(async () => {
      callOrder.push('ensureUserExists')
      return { id: 'person-1', name: 'Test User', avatarUrl: '', email: 'test@example.com', authUserId: 'clerk-user-1' }
    })

    renderWithProvider()

    await waitFor(() => {
      expect(callOrder).toEqual(['setRealtimeAuth', 'ensureUserExists'])
    })
  })

  it('refreshes the Realtime JWT on an interval (Clerk tokens expire in ~60s)', async () => {
    // Fake timers from the start so the setInterval created during render is
    // under our control. We flush microtasks with advanceTimersByTimeAsync(0)
    // instead of waitFor (which would hang under fake timers).
    vi.useFakeTimers()

    h.clerkState.user = { id: 'clerk-user-1', primaryEmailAddress: { emailAddress: 'test@example.com' }, fullName: 'Test User' }
    h.clerkState.session = { id: 'sess-1' }

    renderWithProvider()

    // Let the async syncUser effect resolve (getToken → setRealtimeAuth → ensureUserExists).
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(h.setRealtimeAuthSpy).toHaveBeenCalledTimes(1)
    expect(h.setRealtimeAuthSpy).toHaveBeenLastCalledWith('jwt-token-v1')

    // Simulate Clerk rotating the token before the interval fires.
    h.mockGetToken.mockResolvedValue('jwt-token-v2')

    await act(async () => { await vi.advanceTimersByTimeAsync(50_000) })

    expect(h.setRealtimeAuthSpy).toHaveBeenCalledTimes(2)
    expect(h.setRealtimeAuthSpy).toHaveBeenLastCalledWith('jwt-token-v2')
  })

  it('clears Realtime auth on sign-out', async () => {
    h.clerkState.user = { id: 'clerk-user-1', primaryEmailAddress: { emailAddress: 'test@example.com' }, fullName: 'Test User' }
    h.clerkState.session = { id: 'sess-1' }

    let authRef: ReturnType<typeof useAuth> | undefined
    renderWithProvider((v) => { authRef = v })

    await waitFor(() => expect(h.setRealtimeAuthSpy).toHaveBeenCalledWith('jwt-token-v1'))

    await act(async () => {
      await authRef!.signOut()
    })

    expect(h.setRealtimeAuthSpy).toHaveBeenLastCalledWith(null)
  })

  it('stops refreshing after unmount (no leaked interval)', async () => {
    h.clerkState.user = { id: 'clerk-user-1', primaryEmailAddress: { emailAddress: 'test@example.com' }, fullName: 'Test User' }
    h.clerkState.session = { id: 'sess-1' }

    const { unmount } = renderWithProvider()
    await waitFor(() => expect(h.setRealtimeAuthSpy).toHaveBeenCalledTimes(1))

    unmount()

    // After unmount, fake-advance past two refresh windows and confirm no ticks.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })

    expect(h.setRealtimeAuthSpy).toHaveBeenCalledTimes(1)
  })
})
