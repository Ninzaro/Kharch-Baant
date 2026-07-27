import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchKeyword } from '../../../services/tagKeywords';

// ─── tagKeywords ─────────────────────────────────────────────────────────────

describe('matchKeyword', () => {
  it('matches a single keyword exactly', () => {
    expect(matchKeyword('beer')).toBe('Food');
    expect(matchKeyword('uber')).toBe('Transport');
    expect(matchKeyword('netflix')).toBe('Entertainment');
  });

  it('matches the first keyword word in a multi-word description', () => {
    expect(matchKeyword('chicken biryani for dinner')).toBe('Food');
    expect(matchKeyword('uber ride to office')).toBe('Transport');
    expect(matchKeyword('bigbasket grocery order')).toBe('Groceries');
  });

  it('returns null for unknown descriptions', () => {
    expect(matchKeyword('hibiscus special mocktail')).toBeNull();
    expect(matchKeyword('xyz')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(matchKeyword('')).toBeNull();
  });

  it('covers all tag categories', () => {
    expect(matchKeyword('paneer')).toBe('Food');
    expect(matchKeyword('dmart')).toBe('Groceries');
    expect(matchKeyword('metro')).toBe('Transport');
    expect(matchKeyword('flight')).toBe('Travel');
    expect(matchKeyword('rent')).toBe('Housing');
    expect(matchKeyword('electricity')).toBe('Utilities');
    expect(matchKeyword('movie')).toBe('Entertainment');
    expect(matchKeyword('amazon')).toBe('Shopping');
    expect(matchKeyword('gym')).toBe('Health');
  });
});

// ─── tagClassifier (integration) ─────────────────────────────────────────────

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnValue({ then: vi.fn() }),
    }),
  },
}));

vi.mock('../../../services/geminiService', () => ({
  suggestTagForDescription: vi.fn().mockResolvedValue('Food'),
}));

describe('classifyDescription', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('returns empty string for short descriptions (≤3 chars)', async () => {
    const { classifyDescription } = await import('../../../services/tagClassifier');
    expect(await classifyDescription('hi')).toBe('');
    expect(await classifyDescription('ok')).toBe('');
  });

  it('resolves via keyword rules without hitting Gemini', async () => {
    const { classifyDescription } = await import('../../../services/tagClassifier');
    const { suggestTagForDescription } = await import('../../../services/geminiService');

    const result = await classifyDescription('Chicken Biryani');
    expect(result).toBe('Food');
    expect(suggestTagForDescription).not.toHaveBeenCalled();
  });

  it('resolves via keyword rules for transport', async () => {
    const { classifyDescription } = await import('../../../services/tagClassifier');
    const { suggestTagForDescription } = await import('../../../services/geminiService');

    const result = await classifyDescription('Uber ride to office');
    expect(result).toBe('Transport');
    expect(suggestTagForDescription).not.toHaveBeenCalled();
  });

  it('falls through to suggest-tag edge path for unknown descriptions', async () => {
    const { classifyDescription } = await import('../../../services/tagClassifier');
    const { suggestTagForDescription } = await import('../../../services/geminiService');

    const result = await classifyDescription('Hibiscus Special Mocktail');
    expect(suggestTagForDescription).toHaveBeenCalledWith('Hibiscus Special Mocktail');
    expect(typeof result).toBe('string');
  });

  it('returns empty string for descriptions that are 3 chars or fewer after normalizing', async () => {
    const { classifyDescription } = await import('../../../services/tagClassifier');
    expect(await classifyDescription('   ok  ')).toBe('');
  });
});
