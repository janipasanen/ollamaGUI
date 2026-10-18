import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/target/**',
      '**/*.d.ts',
      // Keep lint fast: tests are covered by `tsc` in CI; lint the source tree here.
      'src-frontend/test/**',
    ],
  },
  // Browser + Node.js built-in globals for JS/Node files so `no-undef`
  // understands process/console/require/module etc. (Vite/Tauri scripts).
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.nodeBuiltin },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // #614 step 2: make the React hooks contracts real errors.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // Honor the repo's conventions: `_`-prefixed args are intentionally unused,
      // and fields destructured only to omit them from a rest object are allowed.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_' },
      ],
      // #614 step 2 scope: these flag pre-existing, codebase-wide patterns
      // (liberal `any`, streaming-logic dead assignments, no error `cause` on
      // throw). Kept as warnings so the gate stays achievable; fix incrementally
      // rather than purging in a tooling PR.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
);
