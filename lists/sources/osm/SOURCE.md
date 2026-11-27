# OpenStreetMap

- Source: OpenStreetMap, via the Overpass API. © OpenStreetMap contributors, ODbL 1.0
  (https://www.openstreetmap.org/copyright). Lists built from these files carry that credit.
- Written by `pnpm jam lists fetch osm`. Needs normal internet access, so run it on your own
  machine; it takes several minutes.
- `routes-index.json`: tags of every route relation whose name matches one of the OSM route
  lists in `packages/cli/src/lists/definitions.ts`, plus every national cycle route
  (network=ncn), so new candidates show up.
- `relation-<id>.json`: one matched relation with its stage relations and full way geometry.
- `yamanashi-peaks.json`: named peaks in and around Yamanashi, used to place 山梨百名山 peaks
  that are not in GSI's list.
- `post-town-places.json`: places named like the 五街道's post towns, within 2 km of each
  highway's bounding box, for the towns whose Wikipedia articles give no usable position. Written
  by `lists fetch osm` once the post towns (`lists fetch wikipedia`) and the tracks
  (`lists fetch gokaido`) are there.
