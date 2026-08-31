import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WelcomeScreen from '../../../components/auth/WelcomeScreen';

describe('WelcomeScreen', () => {
  it('calls onContinue when Get started is pressed', async () => {
    const onContinue = vi.fn();
    render(<WelcomeScreen onContinue={onContinue} />);
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});


