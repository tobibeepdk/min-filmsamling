import js from '@eslint/js';
import globals from 'globals';
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'index-*.js',
      'sw.js',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
];
