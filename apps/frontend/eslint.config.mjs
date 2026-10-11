// ESLint flat config (eslint 9). Replaces the deprecated `next lint`
// invocation, which crashed on the unresolvable @typescript-eslint v6/v9
// mismatch — explicit v8 devDependencies + this config fix the resolution.
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  {
    // Vendored third-party assets (minified pdf.js worker) are not our code.
    ignores: ['node_modules/**', '.next/**', 'out/**', 'next-env.d.ts', 'public/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['*.config.js', '*.config.mjs'],
    rules: {
      // CommonJS config files legitimately use require().
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default eslintConfig;
