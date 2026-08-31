import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viteConfigSource = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

describe('Tauri production asset configuration', () => {
  it('uses relative asset URLs for the local app protocol', () => {
    expect(viteConfigSource).toMatch(/\bbase:\s*['"]\.\/['"]/);
  });
});
