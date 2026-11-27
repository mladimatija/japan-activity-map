/** What a build may publish and what an audit must not find, worked out from the store and config. */
import type { Config } from '@jam/core';

import type { Store } from '../store/store.ts';
import { loadToken } from '../strava/auth.ts';
import type { Forbidden } from './audit.ts';
import { type PublishSettings, selectPublic, type Selection } from './publish.ts';
import { applyZones, loadZones, type Zone } from './zones.ts';

/** The publish rules applied to the whole store, with the zones as clipping uses them. */
export const publishSelection = (
  store: Store,
  config: Config,
  dryRun: boolean,
): { selection: Selection; zones: Zone[]; settings: PublishSettings } => {
  const zones = loadZones(config.privacyZones);
  const settings: PublishSettings = {
    site: config.site,
    thresholds: config.thresholds,
    zones: applyZones(store.db, zones, config.thresholds, dryRun),
    salt: store.salt,
  };
  return { selection: selectPublic(store.db, settings), zones, settings };
};

/** Everything the audit must not find, from the store, the config and the publish rules. */
export const forbiddenFor = (
  store: Store,
  config: Config,
  selection: Selection,
  zones: Zone[],
): Forbidden => {
  const linked = new Set(
    selection.activities.filter((activity) => activity.link).map((activity) => activity.stravaId),
  );
  const hiddenStravaIds = store.db
    .all<{ strava_id: number }>('SELECT strava_id FROM activities WHERE strava_id IS NOT NULL')
    .map((row) => Number(row.strava_id))
    .filter((id) => !linked.has(id));
  const credentials: string[] = [];
  if (config.secrets.strava) credentials.push(config.secrets.strava.clientSecret);
  if (config.secrets.deploy?.apiToken) credentials.push(config.secrets.deploy.apiToken);
  if (config.secrets.deploy?.accountId) credentials.push(config.secrets.deploy.accountId);
  if (config.secrets.deploy?.netlifyToken) credentials.push(config.secrets.deploy.netlifyToken);
  try {
    const token = loadToken();
    if (token) credentials.push(token.accessToken, token.refreshToken);
  } catch {
    // An unreadable token file holds nothing usable to leak.
  }
  return {
    zones,
    hiddenStravaIds,
    excludedPublicIds: selection.excluded.map((activity) => activity.publicId),
    salt: store.salt,
    credentials,
  };
};
