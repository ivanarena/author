import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/.vite/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.data/**',
      '**/to_import/**'
    ]
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.ts', '**/*.svelte.ts'],
    languageOptions: {
      parser: ts.parser
    }
  },
  {
    files: ['**/*.svelte.ts'],
    rules: {
      'svelte/prefer-svelte-reactivity': 'off'
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser
      }
    },
    rules: {
      'svelte/require-each-key': 'off'
    }
  }
);
