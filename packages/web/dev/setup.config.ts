import { renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite-plus';

// The setup page (`jam setup --web`): its own entry and its own output folder, never dist/, so
// nothing of it can be published with the site. `jam audit` checks that too.
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist-setup');

/** The server serves index.html; the entry is setup.html so the public site's entry stays alone. */
const asIndex = (): Plugin => ({
  name: 'jam-setup-index',
  apply: 'build',
  closeBundle() {
    renameSync(join(OUT, 'setup.html'), join(OUT, 'index.html'));
  },
});

export default defineConfig({
  root: ROOT,
  base: './',
  plugins: [tailwindcss(), asIndex()],
  resolve: { alias: { '@': join(ROOT, 'src') } },
  oxc: { jsx: { runtime: 'automatic' } },
  server: {
    // `pnpm setup:dev` beside a running `jam setup --web`: set JAM_SETUP_API to its address.
    open: '/setup.html',
    proxy: process.env.JAM_SETUP_API ? { '/api': process.env.JAM_SETUP_API } : {},
  },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: join(ROOT, 'setup.html'),
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
      },
    },
  },
});
