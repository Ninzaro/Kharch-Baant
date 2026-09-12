// Audit-only shim. `utils/calculations.ts` does `import { Transaction, SplitMode,
// SplitParticipant } from '../types'` as a VALUE import of three type-only names.
// Under `node --experimental-strip-types` those exports vanish from types.ts, so
// we re-export the real runtime values and add inert bindings for the type names.
export * from '../../types.ts';
export const Transaction = undefined;
export const SplitMode = undefined;
export const SplitParticipant = undefined;
