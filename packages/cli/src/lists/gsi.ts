import { prefectureByJa, type Position } from '@jam/core';

import { roundPosition } from './geo.ts';
import { romajiOf, splitSummit, stripAlternatives } from './names.ts';
import type { GsiList } from './sources.ts';

export type LonLat = [number, number];
const POINT_DECIMALS = 6;

export const round = (position: Position, decimals = POINT_DECIMALS): LonLat => {
  const [lon, lat] = roundPosition(position, decimals);
  return [lon, lat];
};

export interface GsiPlace {
  serial: number;
  fullName: string;
  main: string;
  summit?: string;
  kanaMain: string;
  kanaSummit?: string;
  elevationM: number;
  prefectures: string[];
  position: LonLat;
}

export const toGsiPlaces = (list: GsiList): GsiPlace[] =>
  list.rows.map((row) => {
    const { main, summit } = splitSummit(row.name);
    const kana = splitSummit(row.kana);
    const prefectures = row.prefectures.map((name) => {
      const prefecture = prefectureByJa(name);
      if (!prefecture) throw new Error(`GSI row ${row.serial}: unknown prefecture ${name}`);
      return prefecture.code;
    });
    return {
      serial: row.serial,
      fullName: row.name,
      main,
      ...(summit ? { summit } : {}),
      kanaMain: kana.main,
      ...(kana.summit ? { kanaSummit: kana.summit } : {}),
      elevationM: row.elevationM,
      prefectures: [...new Set(prefectures)].sort(),
      position: round([row.lon, row.lat]),
    };
  });

/**
 * Item name for lists built straight from GSI. English is romanised from GSI's reading so these
 * lists read consistently, whatever English name a place got elsewhere.
 */
export const gsiItemName = (gsi: GsiPlace): { ja: string; en: string; kana: string } => {
  const main = romajiOf(gsi.kanaMain);
  const summit = gsi.kanaSummit ? romajiOf(gsi.kanaSummit) : undefined;
  return {
    ja: gsi.summit ? `${gsi.main}（${gsi.summit}）` : gsi.main,
    en: summit ? `${main} (${summit})` : main,
    kana: gsi.kanaSummit
      ? `${stripAlternatives(gsi.kanaMain)}（${stripAlternatives(gsi.kanaSummit)}）`
      : gsi.kanaMain,
  };
};
