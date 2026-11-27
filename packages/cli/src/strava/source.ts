import { z } from 'zod';

import type { StravaHttp } from './http.ts';
import { decodePolyline } from './polyline.ts';

/**
 * Where activities come from. The sync only talks to this interface, so a reader for Strava's
 * bulk export (or another service) can replace the API without touching the rest.
 */
export interface ActivitySource {
  /** Pages of activities that start after `after` (Unix seconds), oldest first, from `page` (1-based). */
  listPage(query: {
    after: number;
    before?: number;
    page: number;
    perPage: number;
  }): Promise<SourceActivity[]>;
  /** Full-detail samples for one activity, when the source has them. */
  getTrack(id: number): Promise<FullTrack | undefined>;
}

export const summarySchema = z.looseObject({
  id: z.number(),
  name: z.string().default(''),
  sport_type: z.string().optional(),
  type: z.string().optional(),
  start_date: z.string(),
  start_date_local: z.string(),
  timezone: z.string().optional(),
  distance: z.number().default(0),
  moving_time: z.number().default(0),
  elapsed_time: z.number().default(0),
  total_elevation_gain: z.number().default(0),
  workout_type: z.number().nullish(),
  commute: z.boolean().default(false),
  trainer: z.boolean().default(false),
  manual: z.boolean().default(false),
  private: z.boolean().default(false),
  visibility: z.string().optional(),
  start_latlng: z.array(z.number()).nullish(),
  end_latlng: z.array(z.number()).nullish(),
  map: z.looseObject({ summary_polyline: z.string().nullish() }).nullish(),
});
export type SourceActivity = z.infer<typeof summarySchema>;

export interface FullTrack {
  coordinates: [number, number][];
  elevations: number[] | null;
  /** Seconds from the start, as Strava gives them. */
  times: number[] | null;
}

const streamsSchema = z.looseObject({
  latlng: z.looseObject({ data: z.array(z.tuple([z.number(), z.number()])) }).optional(),
  altitude: z.looseObject({ data: z.array(z.number()) }).optional(),
  time: z.looseObject({ data: z.array(z.number()) }).optional(),
});

export class StravaApiSource implements ActivitySource {
  readonly #http: StravaHttp;

  constructor(http: StravaHttp) {
    this.#http = http;
  }

  async listPage({
    after,
    before,
    page,
    perPage,
  }: {
    after: number;
    before?: number;
    page: number;
    perPage: number;
  }): Promise<SourceActivity[]> {
    // With `after`, Strava lists oldest first, so page numbers stay stable while new activities arrive.
    const raw = await this.#http.get<unknown[]>('/athlete/activities', {
      after,
      before,
      page,
      per_page: perPage,
    });
    return z.array(summarySchema).parse(raw);
  }

  async getTrack(id: number): Promise<FullTrack | undefined> {
    const raw = await this.#http.get<unknown>(`/activities/${id}/streams`, {
      keys: 'latlng,altitude,time',
      key_by_type: 'true',
    });
    const streams = streamsSchema.parse(raw);
    const latlng = streams.latlng?.data;
    if (!latlng || latlng.length < 2) return undefined;
    const same = (values: number[] | undefined) =>
      values && values.length === latlng.length ? values : null;
    return {
      coordinates: latlng.map(([lat, lon]) => [lon, lat]),
      elevations: same(streams.altitude?.data),
      times: same(streams.time?.data),
    };
  }
}

/** The summary track, when the activity has one. */
export const summaryTrack = (activity: SourceActivity): [number, number][] | undefined => {
  const encoded = activity.map?.summary_polyline;
  if (!encoded || activity.trainer || activity.manual) return undefined;
  const points = decodePolyline(encoded);
  return points.length >= 2 ? points : undefined;
};
