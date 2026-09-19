import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    'ui/dist/**',
    '.agents/**',
    '.claude/**',
    '.codebuddy/**',
    '.codex/**',
    '.cursor/**',
  ]),
  {
    files: ['ui/src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['ui/src/components/ui/**/*.{ts,tsx}', 'ui/src/hooks/use-mobile.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['ui/src/**/*.{ts,tsx}'],
    ignores: ['ui/src/components/ui/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/overflow-(?:auto|scroll|[xy]-auto)/]',
          message: '不要用 overflow-auto / overflow-scroll。需要滚动用 ScrollArea，并给内容 p-1。',
        },
        {
          selector: 'TemplateElement[value.raw=/overflow-(?:auto|scroll|[xy]-auto)/]',
          message: '不要用 overflow-auto / overflow-scroll。需要滚动用 ScrollArea，并给内容 p-1。',
        },
      ],
    },
  },
  {
    files: ['ui/src/App.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['mcp-server/**/*.ts', 'vite.config.ts', 'vite-source-loc.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
