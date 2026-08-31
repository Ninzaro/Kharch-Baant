import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WelcomeScreen from '../../../components/auth/WelcomeScreen';

describe('WelcomeScreen', () => {
  it('calls onContinue when fallback button is pressed', async () => {
    const onContinue = vi.fn();
    render(<WelcomeScreen onContinue={onContinue} />);
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('calls onGoogleSignIn when Continue with Google is pressed', async () => {
    const onGoogleSignIn = vi.fn();
    const onEmailSignIn = vi.fn();
    render(
      <WelcomeScreen
        onGoogleSignIn={onGoogleSignIn}
        onEmailSignIn={onEmailSignIn}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it('calls onEmailSignIn when Continue with Email is pressed', async () => {
    const onGoogleSignIn = vi.fn();
    const onEmailSignIn = vi.fn();
    render(
      <WelcomeScreen
        onGoogleSignIn={onGoogleSignIn}
        onEmailSignIn={onEmailSignIn}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /continue with email/i }));
    expect(onEmailSignIn).toHaveBeenCalledTimes(1);
  });
});

