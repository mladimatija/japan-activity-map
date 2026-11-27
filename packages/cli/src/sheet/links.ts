import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type IndexedList, readListIndex } from '../lists/index-file.ts';
import { LISTS_DIR } from '../lists/sources.ts';

/** What a sheet reference points at. */
export interface LinkTarget {
  /** place: a peak, temple or high point. item: a list item with no coordinates. route: a route item. */
  kind: 'place' | 'item' | 'route';
  id: string;
  /** For messages: the target's Japanese and English names. */
  label: string;
}

type Resolution =
  | { ok: true; target: LinkTarget; by: 'id' | 'name' }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'ambiguous'; candidates: LinkTarget[] };

interface Feature {
  properties: { id: string; placeId?: string | null; name: { ja: string; en: string } };
}

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Names compare after NFKC, lower case, no spaces, and ヶ/ケ/ヵ treated alike. */
const normaliseName = (name: string) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[ヶヵケ]/g, 'ケ');

/** Ids and names of every place and list item in the built lists. */
export class LinkIndex {
  /** Lists the index names whose file is not on this machine; rows cannot link to them. */
  readonly missing: readonly IndexedList[];
  readonly #byId = new Map<string, LinkTarget>();
  readonly #byName = new Map<string, Map<string, LinkTarget>>();

  constructor(listsDir = LISTS_DIR) {
    const indexPath = join(listsDir, 'index.json');
    if (!existsSync(indexPath))
      throw new Error('lists/index.json is missing. Run `pnpm jam lists build` first.');
    const places = new Map<string, LinkTarget>();
    for (const feature of (read(join(listsDir, 'places.geojson')) as { features: Feature[] })
      .features) {
      const target: LinkTarget = {
        kind: 'place',
        id: feature.properties.id,
        label: `${feature.properties.name.ja} (${feature.properties.name.en})`,
      };
      places.set(target.id, target);
      this.#addId(target.id, target);
      this.#addName(feature.properties.name.ja, target);
      this.#addName(feature.properties.name.en, target);
    }
    const catalog = readListIndex(listsDir);
    this.missing = catalog.missing;
    for (const list of catalog.lists) {
      // Areas (the prefecture outlines) are not something a row links to.
      if (!list.file || list.kind === 'area') continue;
      const features = (read(join(listsDir, list.file)) as { features: Feature[] }).features;
      for (const feature of features) {
        const { id, placeId, name } = feature.properties;
        const target: LinkTarget =
          list.kind === 'route'
            ? { kind: 'route', id, label: `${name.ja} (${name.en})` }
            : placeId
              ? (places.get(placeId) ?? { kind: 'place', id: placeId, label: name.ja })
              : { kind: 'item', id, label: `${name.ja} (${name.en})` };
        this.#addId(id, target);
        this.#addName(name.ja, target);
        this.#addName(name.en, target);
      }
      // A route list with a single route (東海道) can be named by the list itself.
      const [only] = features;
      if (list.kind === 'route' && features.length === 1 && only) {
        const target = this.#byId.get(only.properties.id);
        if (target) {
          this.#addId(list.id, target);
          this.#addName(list.title.ja, target);
          this.#addName(list.title.en, target);
        }
      }
    }
  }

  #addId(id: string, target: LinkTarget): void {
    if (!this.#byId.has(id)) this.#byId.set(id, target);
  }

  #addName(name: string, target: LinkTarget): void {
    const key = normaliseName(name);
    if (key === '') return;
    const targets = this.#byName.get(key) ?? new Map<string, LinkTarget>();
    targets.set(`${target.kind}:${target.id}`, target);
    this.#byName.set(key, targets);
  }

  /** By id first, then by exact name in Japanese or English. */
  resolve(reference: string): Resolution {
    const byId = this.#byId.get(reference.trim());
    if (byId) return { ok: true, target: byId, by: 'id' };
    const named = [...(this.#byName.get(normaliseName(reference))?.values() ?? [])];
    const [first] = named;
    if (named.length === 1 && first) return { ok: true, target: first, by: 'name' };
    if (named.length > 1) return { ok: false, reason: 'ambiguous', candidates: named };
    return { ok: false, reason: 'missing' };
  }
}
