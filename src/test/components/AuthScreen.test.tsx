import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signInWithGoogle = vi.fn();
const signUpWithGoogle = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  SignIn: () => <div data-testid="clerk-sign-in" />,
  SignUp: () => <div data-testid="clerk-sign-up" />,
}));

vi.mock('../../../hooks/useNativeGoogleSignIn', () => ({
  useNativeGoogleSignIn: () => ({
    signInWithGoogle,
    busy: false,
    isLoaded: true,
  }),
}));

vi.mock('../../../hooks/useNativeGoogleSignUp', () => ({
  useNativeGoogleSignUp: () => ({
    signUpWithGoogle,
    busy: false,
    isLoaded: true,
  }),
}));

vi.mock('../../../services/nativeAuthBridge', () => ({
  isAndroidNativeApp: () => true,
}));

import AuthScreen from '../../../components/auth/AuthScreen';

describe('AuthScreen native Clerk routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps sign-in separate and switches to Clerk sign-up locally', () => {
    render(<AuthScreen />);

    expect(screen.getByTestId('clerk-sign-in')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByTestId('clerk-sign-up')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(signUpWithGoogle).toHaveBeenCalledOnce();
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });
});
