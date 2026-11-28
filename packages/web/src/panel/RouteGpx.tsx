import { DownloadIcon } from 'lucide-react';

import { Button } from '../components/ui/button.tsx';
import type { Data, List, ListItem } from '../data.ts';
import { gpxFileName, routeGpx, saveGpx } from '../gpx.ts';
import { t } from '../i18n.ts';
import { referenceByList, useLoaded } from '../lazy.ts';
import { nameIn, useLang } from '../names.tsx';

/**
 * Saves a route's line as a GPX file, to follow in a navigation app: one item of a route list, or
 * with no item the whole list, a track per item. Shown once the route's file has arrived.
 */
export const RouteGpxButton = ({
  data,
  list,
  item,
}: {
  data: Data;
  list: List;
  item?: ListItem;
}) => {
  const lang = useLang();
  useLoaded();
  const features = referenceByList
    .get(list.id)
    ?.features.filter((feature) => !item || feature.properties.id === item.id);
  if (!features?.length) return null;
  const listName = nameIn(list.title, lang);
  const name = item && list.items.length > 1 ? `${listName} ${nameIn(item.name, lang)}` : listName;
  const save = () => {
    const credit = data.meta.credits
      .filter((entry) => entry.usedBy.includes(list.id))
      .map((entry) =>
        lang === 'ja' ? (entry.attributionJa ?? entry.attribution) : entry.attribution,
      )
      .join('; ');
    const gpx = routeGpx(
      features.map((feature) => ({
        name: nameIn(feature.properties.name, lang),
        lines: feature.geometry.coordinates,
      })),
      { name, ...(credit ? { credit } : {}) },
    );
    void saveGpx(gpxFileName(name), gpx);
  };
  return (
    <Button variant="outline" size="sm" onClick={save}>
      <DownloadIcon data-icon="inline-start" />
      {item || list.items.length === 1 ? t('Download GPX') : t('Download all as GPX')}
    </Button>
  );
};
