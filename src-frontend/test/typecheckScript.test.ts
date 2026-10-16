import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #617: bare `tsc --noEmit` (tsconfig.json) only type-checks src-frontend, so
// vite.config.ts and the Playwright e2e config/specs were unchecked. The
// `typecheck` script must exist and cover BOTH, and `build` must run it first.
describe('typecheck wiring (#617)', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

  it('defines a typecheck script', () => {
    expect(typeof pkg.scripts.typecheck).toBe('string');
  });

  it('type-checks the e2e tsconfig (playwright config + specs)', () => {
    expect(pkg.scripts.typecheck).toContain('tsconfig.e2e.json');
  });

  it('type-checks the node tsconfig (vite.config.ts)', () => {
    expect(pkg.scripts.typecheck).toContain('tsconfig.node.json');
  });

  it('runs typecheck before vite build', () => {
    expect(pkg.scripts.build.startsWith('npm run typecheck')).toBe(true);
  });

  it('writes the node tsbuildinfo inside gitignored node_modules', () => {
    expect(pkg.scripts.typecheck).toContain('node_modules/.cache/tsconfig.node.tsbuildinfo');
  });
});
