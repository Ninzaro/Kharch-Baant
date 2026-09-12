// Audit-only ESM resolve hook. Two jobs, both read-only:
//  1. extensionless relative imports in app code -> add `.ts`
//  2. `../types` -> the shim that materialises its type-only named exports
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const SHIM = new URL('./_types-shim.mts', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (/(^|\/)\.\.?\/types$/.test(specifier) || specifier === '../types') {
    return { url: SHIM, format: 'module-typescript', shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[mc]?[tj]sx?$/.test(specifier)) {
      return next(specifier + '.ts', context);
    }
    throw err;
  }
}
