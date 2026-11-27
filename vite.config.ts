import { defineConfig } from 'vite-plus';

// One config for the whole workspace: Oxlint (lint), Oxfmt (format) and type checking via `vp check`.
// The web app has its own Vite config, in packages/web.
export default defineConfig({
  lint: {
    ignorePatterns: ['data/**', 'dist/**', 'lists/**'],
    // Hook rules and JSX accessibility, beside the defaults.
    plugins: ['typescript', 'unicorn', 'oxc', 'react', 'jsx-a11y'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'typescript/consistent-type-imports': 'error',
      'typescript/no-floating-promises': 'error',
      'typescript/no-explicit-any': 'error',
      // Arrow functions throughout: `const f = () => {}`, not `function f() {}`.
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      // role="img", "group" and "status" on a div or svg are what ARIA asks for here.
      'jsx-a11y/prefer-tag-over-role': 'off',
      // Cannot see the label a Base UI `render={<button />}` receives from its wrapper.
      'jsx-a11y/control-has-associated-label': 'off',
    },
    overrides: [
      {
        files: ['packages/cli/**', 'packages/web/vite.config.ts'],
        env: { node: true },
      },
      {
        files: ['packages/web/src/**'],
        env: { browser: true },
      },
      {
        // Node's test runner returns a promise from test() that it awaits itself.
        files: ['packages/*/test/**'],
        env: { node: true },
        rules: { 'typescript/no-floating-promises': 'off' },
      },
      {
        // The checks keep [label, element] pairs in arrays; nothing there is rendered as a list.
        files: ['packages/web/dev/**'],
        rules: { 'react/jsx-key': 'off' },
      },
      {
        // shadcn components, kept as generated.
        files: ['packages/web/src/components/ui/**'],
        rules: {
          'jsx-a11y/click-events-have-key-events': 'off',
          'jsx-a11y/no-noninteractive-element-interactions': 'off',
          'jsx-a11y/no-noninteractive-tabindex': 'off',
          'jsx-a11y/label-has-associated-control': 'off',
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: [
      'data/**',
      'dist/**',
      'lists/sources/**',
      'lists/**/*.geojson',
      'lists/*.json',
      'lists/review.md',
      'pnpm-lock.yaml',
    ],
    // Two spaces per indent level, never tab characters (as in .editorconfig).
    useTabs: false,
    tabWidth: 2,
    singleQuote: true,
    printWidth: 100,
    overrides: [
      {
        // JSONC as most editors and JSON validators read it: no trailing commas.
        files: ['**/*.jsonc', '**/*.json5'],
        options: { trailingComma: 'none' },
      },
    ],
  },
});
