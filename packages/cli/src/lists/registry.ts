import type { CoordinateSource, PlaceKind } from '@jam/core';

import { distanceM } from './geo.ts';
import type { GsiPlace, LonLat } from './gsi.ts';
import { namesOverlap } from './names.ts';

export interface PlaceDraft {
  id: string;
  kind: PlaceKind;
  position: LonLat;
  ja: string;
  en?: string;
  kana?: string;
  summit?: string;
  elevationM?: number;
  prefectures: string[];
  coordinateSource: CoordinateSource;
  gsiSerial?: number;
  wikidata?: string;
  lists: Set<string>;
}

/** Every place the lists point at. A peak in several lists is one place. */
export class Registry {
  readonly places = new Map<string, PlaceDraft>();

  forGsi(gsi: GsiPlace): PlaceDraft {
    const id = `peak-${gsi.serial}`;
    let place = this.places.get(id);
    if (!place) {
      place = {
        id,
        kind: 'peak',
        position: gsi.position,
        ja: gsi.main,
        kana: gsi.kanaMain,
        ...(gsi.summit ? { summit: gsi.summit } : {}),
        elevationM: gsi.elevationM,
        prefectures: gsi.prefectures,
        coordinateSource: 'gsi',
        gsiSerial: gsi.serial,
        lists: new Set(),
      };
      this.places.set(id, place);
    }
    return place;
  }

  /** A place from another source: reuses one of the same kind and name within `radiusM`. */
  external(draft: Omit<PlaceDraft, 'lists'>, radiusM: number): PlaceDraft {
    for (const place of this.places.values()) {
      if (
        place.kind === draft.kind &&
        place.coordinateSource !== 'gsi' &&
        distanceM(place.position, draft.position) <= radiusM &&
        namesOverlap(place.ja, draft.ja)
      ) {
        return place;
      }
    }
    const existing = this.places.get(draft.id);
    if (existing) return existing;
    const place: PlaceDraft = { ...draft, lists: new Set() };
    this.places.set(place.id, place);
    return place;
  }
}
