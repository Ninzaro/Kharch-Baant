/** Stable JSON so a lost response can be recognized as the write that landed. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
    return JSON.stringify(Number(value));
  }
  return JSON.stringify(value);
}

/** True when the stored row already contains this update. Used after a lost response. */
export function storedTransactionMatchesUpdate(
  row: Record<string, unknown>,
  update: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(update)) {
    const actual = row[key];
    if (key === 'amount') {
      if (Number(actual) !== Number(expected)) return false;
      continue;
    }
    if (key === 'payers' || key === 'split_participants') {
      if (stableJson(actual ?? null) !== stableJson(expected ?? null)) return false;
      continue;
    }
    if ((actual ?? null) !== (expected ?? null)) return false;
  }
  return true;
}
