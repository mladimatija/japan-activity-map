import { resolve } from 'node:path';

import { defineConfig } from 'vite-plus';

// Bundles dev/check-web.tsx for Node (JSX and all); see dev/check-web.sh.
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  oxc: { jsx: { runtime: 'automatic' } },
  logLevel: 'warn',
  build: {
    ssr: resolve(import.meta.dirname, 'check-web.tsx'),
    outDir:
      process.env.JAM_WEB_CHECK_OUT ?? resolve(import.meta.dirname, '../node_modules/.check-web'),
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'check-web.mjs' } },
  },
});
