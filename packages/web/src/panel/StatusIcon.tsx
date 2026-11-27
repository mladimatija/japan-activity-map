import { useMemo } from 'react';

import { STATUS_LABELS } from '../format.ts';
import { type Status, statusIconUrl } from '../map/palette.ts';

const urls = new Map<Status, string>();

/** The same marker the map uses for a status, so the panel and legend match it. */
export const StatusIcon = ({
  status,
  size = 16,
  decorative = false,
}: {
  status: Status;
  size?: number;
  /** Beside its label already: hidden from screen readers. */
  decorative?: boolean;
}) => {
  const url = useMemo(() => {
    let value = urls.get(status);
    if (!value) {
      value = statusIconUrl(status, 48);
      urls.set(status, value);
    }
    return value;
  }, [status]);
  return (
    <img
      className="flex-none"
      src={url}
      width={size}
      height={size}
      alt={decorative ? '' : STATUS_LABELS[status]}
      title={decorative ? undefined : STATUS_LABELS[status]}
    />
  );
};
