import { createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite-plus';

const DIST = resolve(import.meta.dirname, '../../dist');
/**
 * The data served at /data: the build in dist/data, or the folder JAM_WEB_DATA names (the demo's
 * build, for `pnpm demo:web`). Only ever what was asked for: with nothing built, the app says so.
 */
const DATA = process.env.JAM_WEB_DATA ? resolve(process.env.JAM_WEB_DATA) : join(DIST, 'data');

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Serves the build output (dist/data, or JAM_WEB_DATA) at /data, as the published site does; a missing file is a 404. */
const dataHandler: Handler = (request, response) => {
  const path = normalize(join(DATA, decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')));
  if (!path.startsWith(DATA + sep) || !existsSync(path) || !statSync(path).isFile()) {
    // Answer here rather than fall through to index.html, so the app can say the data is missing.
    response.statusCode = 404;
    response.end();
    return;
  }
  response.setHeader(
    'Content-Type',
    path.endsWith('.json') || path.endsWith('.geojson')
      ? 'application/json'
      : 'application/octet-stream',
  );
  createReadStream(path).pipe(response);
};

/** The same /data in `vp dev` and `vp preview`. */
const serveData = (): Plugin => ({
  name: 'jam-serve-data',
  configureServer(server) {
    server.middlewares.use('/data', dataHandler);
  },
  configurePreviewServer(server) {
    server.middlewares.use('/data', dataHandler);
  },
});

/** The app is built into dist/ beside dist/data, which belongs to `jam build` and is left alone. */
const cleanApp = (): Plugin => ({
  name: 'jam-clean-app',
  apply: 'build',
  buildStart() {
    rmSync(join(DIST, 'assets'), { recursive: true, force: true });
    rmSync(join(DIST, 'index.html'), { force: true });
  },
});

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [tailwindcss(), serveData(), cleanApp()],
  // "@/…" as in components.json, for components the shadcn CLI adds.
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  oxc: { jsx: { runtime: 'automatic' } },
  build: {
    outDir: DIST,
    emptyOutDir: false,
    // Only the map library is this big (about 1.1 MB, 300 kB compressed); nothing else comes near.
    chunkSizeWarningLimit: 1200,
    // Fonts stay files, however small: the published site allows fonts from its own origin only
    // (font-src 'self'), which a data: URL is not.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        // The libraries change far less often than the app, so they get a file of their own: a
        // new version of the site is then a small download for someone who has been before. The
        // map library stays apart; it is loaded beside the shell, not before it.
        manualChunks: (id: string) =>
          !id.includes('node_modules') || /maplibre|react-map-gl|vis\.gl/.test(id)
            ? undefined
            : 'vendor',
      },
      // Base UI marks its modules 'use client' for React Server Components; a client-only app can
      // drop the directive, so the warning about it says nothing here.
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
      },
    },
  },
});
