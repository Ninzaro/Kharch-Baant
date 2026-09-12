// Read-only Node loader hooks so the repo's real utils/calculations.ts can be
// executed unmodified: (1) resolve extensionless relative TS imports,
// (2) drop the type-only `import { ... } from '../types'` line in memory
//     (Node's type-stripper keeps it, but types.ts exports no runtime values).
// Nothing on disk is touched.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.(ts|tsx|js|mjs|json)$/.test(specifier)) {
    for (const ext of ['.ts', '.tsx']) {
      try {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(specifier + ext, context);
      } catch {}
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('/utils/calculations.ts')) {
    const src = readFileSync(fileURLToPath(url), 'utf8')
      .replace(/^import\s*\{[^}]*\}\s*from\s*'\.\.\/types';?$/m, '');
    return { format: 'module-typescript', source: src, shortCircuit: true };
  }
  return next(url, context);
}
