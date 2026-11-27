import {
  BikeIcon,
  CircleIcon,
  FootprintsIcon,
  type LucideIcon,
  MountainIcon,
  MountainSnowIcon,
  PersonStandingIcon,
} from 'lucide-react';

const TYPE_ICONS: Record<string, LucideIcon> = {
  hike: MountainIcon,
  trail_run: MountainSnowIcon,
  run: PersonStandingIcon,
  walk: FootprintsIcon,
  ride: BikeIcon,
};

/** An activity type's icon; decorative unless labelled. */
export const TypeIcon = ({ type, label }: { type: string; label?: string }) => {
  const Icon = TYPE_ICONS[type] ?? CircleIcon;
  return (
    <Icon
      className="size-4.5 shrink-0"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
};
