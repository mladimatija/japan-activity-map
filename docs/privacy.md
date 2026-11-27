# Privacy and what is published

Everything is synced and matched on your own machine. Only the build output is published, and
these rules decide what goes into it. `pnpm jam zones` shows what they do with your data, and
`pnpm jam audit` checks an output folder.

## Privacy zones

Zones are places you don't want anyone to find from your tracks, such as home, work, or where you
stayed. Copy `config/privacy-zones.example.jsonc` to `config/privacy-zones.jsonc` (git-ignored,
never published):

```jsonc
{
  "zones": [
    { "label": "home", "lat": 35.6812, "lon": 139.7671, "radiusM": 400 },
    { "label": "work", "lat": 35.6586, "lon": 139.7454, "radiusM": 250 },
  ],
}
```

Give coordinates; addresses aren't looked up. Right-click the place in a map app to copy them. Only
places in Japan matter, since nothing outside Japan is published.

How a zone is applied:

- The track is cut exactly at the zone's edge, not at the nearest recorded point. A run that
  passes through a zone is split in two, and pieces left shorter than `privacy.minFragmentM`
  (100 m) are dropped. An activity entirely inside a zone has no track on the site but keeps its
  distance and other statistics.
- The edge isn't centred on the real place. Each zone's centre is moved once, at random, by
  up to `privacy.centreShiftShare` (50%) of its radius. The move is stored in the local store, so it
  is the same on every build. The radius grows by the same amount, so the real circle is always
  covered.
- The radius varies per activity by up to `privacy.radiusJitterM` (50 m). The variation is
  fixed by the activity and the secret salt, so it too is stable. Cut points therefore don't
  trace one circle. A further 10 m is always added, so that a cut point rounded for publishing
  can never land just inside the real zone.

What this means: someone fitting a circle to many cut points finds only the moved centre. The real
place is somewhere within half the radius of it, so with a 400 m zone, anywhere within 200 m. Choose
the radius with that in mind. A larger `centreShiftShare` hides more, at the cost of cutting more
track.

Everything derived from tracks in the build uses the cut tracks: route lines, the heatmap,
elevation profiles, map bounds, and start and finish markers.

## What is left out

| Left out                                      | Unless                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Activities outside Japan                      | never                                                                                              |
| Activities without GPS                        | `publish.activitiesWithoutGps` is on; then only those in the Asia/Tokyo time zone                  |
| Activities set to Only You on Strava          | `publish.includeOnlyMeActivities` is on (Followers-only activities are published like public ones) |
| Sheet rows with `hide` set to yes             | never                                                                                              |
| Activities not yet matched (`pnpm jam match`) | they are matched                                                                                   |
| Time of day                                   | `publish.timeOfDay` is on; hour-of-day charts use totals only                                      |
| Seconds along tracks (for splits)             | `publish.paceAlongTracks` is on, as it is by default (see below)                                   |
| Commutes, from the heatmap                    | `publish.commutesInHeatmap` is on                                                                  |
| Activity names                                | when `publish.activityNames` is off, each is called by its type ("Run", "ランニング")              |

The publish settings are in `config/site.jsonc`.

`publish.paceAlongTracks` publishes the seconds at each point of a track, for the splits in an
activity's detail. They count from the first point of each published stretch, so they carry no time
of day, and a stretch that resumes after a privacy zone starts again from 0: the time spent inside
the zone isn't in them. What they add is your pace along the way, as Strava shows it on a public
activity. Turn it off to publish heights only.

## Strava links

`publish.stravaLinks` in `config/site.jsonc` adds a link to each Strava activity. The sheet's
`show_strava_link` column overrides it per activity. With the link off, neither the link nor the
Strava id is published. Every activity is identified by a public id made from the secret salt,
which stays the same after `strava wipe` and a refetch.

## The audit

`pnpm jam audit [folder]` checks a folder of output files (by default `dist/`, which `pnpm jam build`
writes) and fails if it finds:

- a privacy zone's coordinates, written with 4 to 6 decimals, or its address;
- any coordinate pair in a JSON file inside a real zone (the real one, not the moved one);
- a Strava id that isn't inside a published link;
- the public id of an activity that is left out;
- an internal act_ or route_ id, since those carry their creation time;
- the secret salt, the Strava client secret or tokens, the Cloudflare token or the account id.

Public geometry isn't a leak where it crosses a zone: a list's place, a reference route, a
prefecture border. The build tells the audit which points those are, and leaves the same list
beside the store (`data/audit-reference.txt`, never published) so that `pnpm jam audit` run on its
own agrees with the build it follows. A track's bounding box isn't a point either: its corner is
worked out from points that are checked themselves.

It also warns, without failing, when the folder holds demo data (`"demo": true` in its
`meta.json`, from `pnpm jam demo`): made-up activities aren't private, but they aren't yours to
publish as your own either.

It prints each check with what it covered, so a pass tells you something. The build runs it
every time and refuses to publish on a failure.

## Checking it

- `pnpm jam zones` lists each zone without its position: the radius used, how far the centre moved,
  how many tracks are cut, and why activities are left out.
- `pnpm jam zones --preview` writes the cut tracks to `data/privacy-preview.geojson`, to look at
  in a GeoJSON viewer. It stays local.
- `pnpm check:privacy` runs the checks on made-up runs around 東京駅 in a temporary folder.
