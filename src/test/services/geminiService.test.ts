import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: { message: 'not deployed' } }),
    },
  },
}));

describe('geminiService (no client API key)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('suggestTagForDescription returns empty when edge function is unavailable', async () => {
    const { suggestTagForDescription } = await import('../../../services/geminiService');
    const result = await suggestTagForDescription('Lunch at a fancy place');
    expect(result).toBe('');
  });

  it('returns empty for short / empty descriptions', async () => {
    const { suggestTagForDescription } = await import('../../../services/geminiService');
    expect(await suggestTagForDescription('')).toBe('');
    expect(await suggestTagForDescription('  ')).toBe('');
  });

  it('getIconForCategory maps known tags', async () => {
    const { getIconForCategory } = await import('../../../services/geminiService');
    expect(getIconForCategory('Travel')).toBe('✈️');
    expect(getIconForCategory('Food')).toBe('🍔');
  });

  it('uses tag from edge function when present', async () => {
    const { supabase } = await import('../../../lib/supabase');
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: { tag: 'Travel' },
      error: null,
    } as any);

    const { suggestTagForDescription } = await import('../../../services/geminiService');
    const result = await suggestTagForDescription('Weekend trip booking');
    expect(result).toBe('Travel');
  });
});
