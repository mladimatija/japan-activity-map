import type { ActivityType } from '@jam/core';

/** Strava's old exports number their types. */
const NUMBERED: Record<string, ActivityType> = {
  '1': 'ride',
  '4': 'hike',
  '9': 'run',
  '10': 'walk',
};

/** Tried in order, so "trail run" is found before "run" and "hike" before "walk". */
const WORDS: [ActivityType, RegExp][] = [
  ['trail_run', /trail\s*run|トレイルラン|トレラン/],
  ['hike', /hik|trek|mountaineer|backpack|登山|ハイキング|ハイク|トレッキング|山歩|縦走/],
  ['walk', /walk|ウォーキング|ウォーク|散歩|徒歩/],
  ['run', /run|jog|ランニング|ラン$|ジョギング|マラソン/],
  ['ride', /ride|cycl|bik|サイクリング|ライド|自転車|ロードバイク/],
];

/**
 * The activity type a GPX `<type>` means, or undefined when it names none of the five: "Hiking",
 * "trail_running", "Trail Run", "cycling", "登山", "ランニング" and the like all read.
 */
export const gpxActivityType = (type: string | undefined): ActivityType | undefined => {
  if (!type) return undefined;
  const text = type.normalize('NFKC').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (text === '') return undefined;
  return NUMBERED[text] ?? WORDS.find(([, pattern]) => pattern.test(text))?.[0];
};
