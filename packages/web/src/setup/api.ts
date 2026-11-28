/** What the setup page asks of the local server (`jam setup --web`), and the shapes it answers with. */

/** Marks this bundle as the setup page: `jam audit` fails if it finds it in a folder to publish. */
export const MARKER = 'jam-setup';

export type Start = 'demo' | 'quick' | 'full' | 'change';
export type Kind =
  | 'text'
  | 'date'
  | 'number'
  | 'confirm'
  | 'choice'
  | 'multi'
  | 'secret'
  | 'location'
  | 'zones'
  | 'json'
  | 'info';

export interface StepOption {
  value: string | number | boolean;
  label: string;
  help?: string;
}

export interface ShownStep {
  id: string;
  group: string;
  kind: Kind;
  title: string;
  help?: string;
  options?: StepOption[];
  optional: boolean;
  sensitive?: 'secret' | 'location';
  stored: boolean;
  value?: unknown;
}

export interface PlanAction {
  id: string;
  /** Its place in the pipeline; plans merge by it. */
  order: number;
  title: string;
  command: string;
  network: boolean;
  browser: boolean;
  slow?: string;
  skip?: string;
}

export interface FileChange {
  name: string;
  created: boolean;
  diff: string[];
}

export interface View {
  steps: ShownStep[];
  errors: Record<string, string>;
  changes: FileChange[];
  plan: PlanAction[];
}

export interface SetupState {
  facts: {
    stravaCredentials: boolean;
    stravaScope: string | null;
    listsMissing: string[];
    listsBuilt: boolean;
    sheetExists: boolean;
    garminKey?: boolean;
    yamapToken?: boolean;
    yamapTokenRefused?: string | null;
    siteBuilt: boolean;
    demoAvailable: boolean;
  };
  demo: { available: boolean; reason?: string };
  /** The groups change mode offers. */
  groups: { id: string; title: string }[];
  /** Every group's title, by id. */
  titles: Record<string, string>;
  zones: number;
  /** The site's own map style, for the zone picker. */
  mapStyle: string;
  running: string | null;
  reviews: { name: string; what: string }[];
}

export interface Answers {
  start: Start;
  group?: string;
  answers: Record<string, unknown>;
}

export type RunEvent =
  | { type: 'log'; level: string; line: string }
  | { type: 'progress'; done: number; total: number; what: string }
  | { type: 'start'; id: string }
  | { type: 'end'; id: string; code: number }
  | { type: 'authorize'; url: string };

export interface SetupApi {
  state(): Promise<SetupState>;
  /** Checks the answers and says what would change; writes nothing. */
  answers(body: Answers): Promise<View>;
  /** Writes the config files. Rejects with the view when an answer is wrong. */
  apply(body: Answers): Promise<{ written: string[]; plan: PlanAction[] }>;
  run(id: string): Promise<void>;
  /** Calls back for each line and each start and end; returns a function that stops listening. */
  events(onEvent: (event: RunEvent) => void): () => void;
  review(name: string): Promise<string>;
  /** Stops the running command, where it can be stopped. Rejects with the reason when it cannot. */
  stop(): Promise<void>;
  /** Routes that look like one route, from the last grouping. */
  merges(): Promise<MergeCandidate[]>;
  /** Adds one of them to config/routes.jsonc, by its place in the list. */
  merge(index: number): Promise<MergeCandidate[]>;
  /** The tracks as they would be published, cut at the zones; null before a preview is written. */
  preview(): Promise<PreviewTracks | null>;
  /** Sends a .zip or .gpx to the folder the GPX import reads; resolves with how many files it holds. */
  upload(file: File): Promise<{ saved: string; files: number }>;
  shutdown(finished: boolean): Promise<void>;
}

export interface MergeCandidate {
  index: number;
  routes: { name: string; count: number }[];
  reason: string;
  merged: boolean;
}

export interface PreviewTracks {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }[];
}

const json = async <T>(response: Response): Promise<T> => {
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
};

/** Every change carries the page's own header; another site cannot add it without a preflight. */
const post = (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jam-Setup': '1' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });

export const httpApi: SetupApi = {
  state: async () => json<SetupState>(await fetch('/api/state', { credentials: 'same-origin' })),
  answers: async (body) => json<View>(await post('/api/answers', body)),
  apply: async (body) => json(await post('/api/apply', body)),
  run: async (id) => {
    await json(await post(`/api/actions/${encodeURIComponent(id)}`, {}));
  },
  events: (onEvent) => {
    const source = new EventSource('/api/events');
    for (const type of ['log', 'start', 'end', 'authorize', 'progress'] as const)
      source.addEventListener(type, (event) => {
        onEvent({
          type,
          ...(JSON.parse((event as MessageEvent<string>).data) as object),
        } as RunEvent);
      });
    return () => source.close();
  },
  review: async (name) => {
    const response = await fetch(`/api/review/${encodeURIComponent(name)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  },
  stop: async () => {
    await json(await post('/api/stop', {}));
  },
  merges: async () =>
    (
      await json<{ merges: MergeCandidate[] }>(
        await fetch('/api/merges', { credentials: 'same-origin' }),
      )
    ).merges,
  merge: async (index) =>
    (await json<{ merges: MergeCandidate[] }>(await post('/api/merges', { index }))).merges,
  preview: async () => {
    const response = await fetch('/api/privacy-preview', { credentials: 'same-origin' });
    return response.ok ? ((await response.json()) as PreviewTracks) : null;
  },
  upload: async (file) =>
    json(
      await fetch('/api/gpx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Jam-Setup': '1',
          // Only a name: the server decides the folder and cuts the name down itself.
          'X-Jam-File-Name': encodeURIComponent(file.name),
        },
        body: file,
        credentials: 'same-origin',
      }),
    ),
  shutdown: async (finished) => {
    await post('/api/shutdown', { finished });
  },
};
