import { resolve } from 'node:path';

import { defineConfig } from 'vite-plus';

// Bundles dev/check-setup-ui.tsx for Node (JSX and all); see dev/check-setup-ui.sh.
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  oxc: { jsx: { runtime: 'automatic' } },
  logLevel: 'warn',
  build: {
    ssr: resolve(import.meta.dirname, 'check-setup-ui.tsx'),
    outDir:
      process.env.JAM_SETUP_UI_OUT ??
      resolve(import.meta.dirname, '../node_modules/.check-setup-ui'),
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'check-setup-ui.mjs' } },
  },
});
