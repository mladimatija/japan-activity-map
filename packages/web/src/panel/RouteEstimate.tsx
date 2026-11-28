import { useMemo } from 'react';

import { Note } from '../components/app.tsx';
import type { Data, List } from '../data.ts';
import { estimateSeconds, paceKind, usualPace } from '../estimate.ts';
import { distanceText, duration, numberText } from '../format.ts';
import { isJa, t } from '../i18n.ts';

/**
 * What is left of a route and about how long it would take: "29.5 km to go, about 9 h 15 min
 * moving at your usual walking pace". Nothing when it is all covered, or when there are too few
 * outings of the kind to know a usual pace.
 */
export const RouteEstimate = ({
  data,
  list,
  lengthM,
  coveredM,
}: {
  data: Data;
  list: List;
  lengthM: number | undefined;
  coveredM: number | undefined;
}) => {
  const kind = paceKind(list.theme);
  const pace = useMemo(() => usualPace(data.activities, kind), [data.activities, kind]);
  const left = Math.max(0, (lengthM ?? 0) - (coveredM ?? 0));
  // Under a few hundred metres the route is as good as done, and an estimate would be noise.
  if (!pace || left < 500) return null;
  const seconds = estimateSeconds(left, pace);
  // Past ten hours the estimate is to the hour, and is said in hours alone.
  const hours = numberText(Math.round(seconds / 3600));
  const time = seconds < 36_000 ? duration(seconds) : isJa() ? `${hours}時間` : `${hours} h`;
  return (
    <Note className="mt-2 mb-0">
      {kind === 'ride'
        ? t('{distance} to go: about {time} moving, at the pace of your {count} rides.', {
            distance: distanceText(left, 1),
            time,
            count: pace.count,
          })
        : t('{distance} to go: about {time} moving, at the pace of your {count} walks and hikes.', {
            distance: distanceText(left, 1),
            time,
            count: pace.count,
          })}{' '}
      {t('A rough figure: the climb of the route is not known.')}
    </Note>
  );
};
