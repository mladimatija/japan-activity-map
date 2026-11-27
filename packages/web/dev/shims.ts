// Just enough of a browser for the data layer and the panel to run under Node, against a real build.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA = process.env.JAM_WEB_DATA ?? join(process.cwd(), 'dist/data');
const g = globalThis as Record<string, unknown>;

const context = new Proxy(
  {},
  {
    get: (_, key) =>
      key === 'getImageData'
        ? (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          })
        : () => undefined,
    set: () => true,
  },
);

export const replaced: string[] = [];
const listeners = new Map<string, () => void>();

g.document = {
  baseURI: 'https://example.test/site/',
  title: '',
  createElement: () => ({
    getContext: () => context,
    toDataURL: () => 'data:image/png;base64,',
    width: 0,
    height: 0,
  }),
};
g.location = { hash: '', pathname: '/site/', search: '' };
const write = (_: unknown, __: string, url: string) => {
  replaced.push(url);
  (g.location as { hash: string }).hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
};
export const pushed: string[] = [];
g.history = {
  replaceState: write,
  pushState: (state: unknown, title: string, url: string) => {
    pushed.push(url);
    write(state, title, url);
  },
};
g.window = {
  addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
  removeEventListener: (name: string) => listeners.delete(name),
  dispatch: (name: string) => listeners.get(name)?.(),
};
g.ImageData = class {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
};
g.fetch = async (url: URL) => {
  const path = decodeURIComponent(url.pathname.replace(/^\/site\/data\//, ''));
  try {
    return new Response(await readFile(join(DATA, path)), { status: 200 });
  } catch {
    return new Response('', { status: 404 });
  }
};
