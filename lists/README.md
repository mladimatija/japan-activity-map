# Reference lists

Built by `pnpm jam lists build` from the files in `sources/` and the hand corrections in
`overrides.jsonc`. Check them with `pnpm jam lists validate`. Sources that need the network
are refreshed with `pnpm jam lists fetch` (see `sources/README.md`).

| File                         | What it holds                                                               |
| ---------------------------- | --------------------------------------------------------------------------- |
| `index.json`                 | Catalog of every list: built ones with counts, blocked ones with the reason |
| `prefectures.geojson`        | The 47 prefecture outlines for display (simplified, 5 decimals)             |
| `prefectures-detail.geojson` | Detailed outlines, used for point-in-prefecture checks                      |
| `places.geojson`             | Shared places. A peak in several lists is one place                         |
| `peaks/*.geojson`            | One file per point list, with its metadata as a foreign member              |
| `pilgrimage/`, `castles/`    | The same for temple circuits and castle lists                               |
| `waterfalls/`                | The same for waterfall lists                                                |
| `routes/*.geojson`           | One file per route list                                                     |
| `credits.json`               | Sources, licences and required attribution lines                            |
| `review.md`                  | What the build couldn't settle on its own. Read it after each build         |

Only `overrides.jsonc` and `sources/` are edited by hand. Everything else is generated, so a
change there is lost on the next build.

Attribution that must appear on the public site is in `credits.json`, including:

- 出典：国土地理院「日本の主な山岳標高」を加工して作成
- 出典：国土交通省国土数値情報（行政区域データ）を加工して作成
- © OpenStreetMap contributors (for lists built from OpenStreetMap)
- 出典：環境省「東海自然歩道GPSデータ」を加工して作成 (for the 東海自然歩道)
- The 五街道 route files are CC BY-NC-SA 4.0 (non-commercial, share-alike); they are built locally
  from fetched tracks and never committed

## Known gaps

What the sources couldn't settle. Each one is also in `review.md` or `index.json` after a build.

- 山梨百名山 #56 達沢山 and #60 春日山 are placed by hand in `overrides.jsonc` (no open
  source gives their position). 春日山 uses the signed 1,158 m summit, not the list's 1,235 m.
- 花の百名山, 関東百名山, 関西百名山 and 日本の滝百選 come from their Japanese Wikipedia list
  articles (`lists fetch wikipedia`), read however the article lays the list out. They aren't
  built until that has run. After the first fetch, read `review.md`: it names every number the
  article gave no entry for, every name with no linked article (so no coordinates), every name
  with no English label, and where the article doesn't number the list (花の百名山 and 日本の滝百選
  have no official numbers; theirs are the article's order). A mountain that GSI lists is placed
  on its GSI summit and shared with the other lists it is on; the rest, and every waterfall, sit
  at their article's position, which for a waterfall is the fall itself, not the viewing spot.
- Summits those articles give no position for. There were 35 (most have no article of their
  own): 22 are placed from OpenStreetMap, 2 from GSI's place-name search, 1 from Wikidata and 8 are tied to
  their row in GSI's list, each checked by name and prefecture and written in `overrides.jsonc`
  (`itemCoordinates`; `gsi` names the GSI row). The last three are placed at the highest cell of
  GSI's 10 m elevation model: 関西 #93 矢筈岳 where GSI's map prints the name; 関東 #14 帳付山 and
  関西 #87 五大尊岳, which no GSI map names, at the only top of the listed height on the ridge
  each is described on. Those two are the least certain positions in the lists; their notes say
  so. English names Wikidata lacks are in `itemNames`.
- 日本の道100選 (`michi-100`) is kept by hand in `sources/michi-100/roads.json`: 104 roads, each
  as one point on or beside the road. 92 have a point; the other 12 are listed without one
  until a point is checked (the file's `SOURCE.md` says how to add one, and names the 12).
- 日本百名道 isn't built. It is one author's selection (須藤英一), and no open source lists
  it: Japanese Wikipedia has no list article and Wikidata no item, only about a hundred road and mountain articles citing the
  book as a reference. A citation doesn't say a road is one of the hundred, so a list made from
  them would be a guess at someone's selection, and the selection itself is the author's work.
  日本の道100選, the official selection, stands in for it. With the book in hand, a copy for your
  own map is one file: `sources/michi-100/roads.json` shows the shape.
- 四国八十八箇所, 西国三十三所, 日本100名城 and 続日本100名城 come from the Japanese Wikipedia
  list articles (`lists fetch wikipedia`); Wikidata's own sets for them are incomplete. Check
  `review.md` for items whose Wikidata and article positions disagree.
- 日本百低山 is the kongo project's list (101 mountains under 1,500 m); its membership hasn't
  been checked against the book.
- Long-distance nature trails in OpenStreetMap are mostly fragments. A route list is built
  only when OpenStreetMap has at least half its official length, and is partial below 90%:
  みちのく潮風トレイル is partial (about half mapped); 九州, 中国, 四国, 近畿, 中部北陸, 東北 and
  北海道自然歩道, 信越トレイル and 北海道東トレイル aren't built. 九州オルレ has no official length
  set, so it is built with only the courses OpenStreetMap has. There is no other open source to
  build them from: the Ministry of the Environment publishes GPS data for 東海自然歩道 only, and
  the trails' own maps are PDFs or apps without an open licence. Nothing needs changing here when
  that improves: `pnpm jam lists fetch osm` and `lists build` pick a trail up once OpenStreetMap
  has half of it (`review.md` says how much it has each time).
- 東海自然歩道 is the main line only (about 1,310 km of the official 1,750); the ministry's
  115 branch and detour tracks are left out.
- 雪国魚沼Golden Cycle Route and あまいち (3rd National Cycle Routes, July 2026) aren't in
  OpenStreetMap yet, and their official routes are only in apps (ツール・ド, Ride with GPS)
  with no open licence. `lists fetch osm` picks them up once they are mapped.
- Japan Trail: about 10,000 km, only in the Japan Long Trail Association app.
- 沖ノ鳥島 is missing from both prefecture outlines.
- Route sections: the 五街道 are split into stages between post towns once
  `lists fetch wikipedia` has their post towns (each stage named 品川宿–川崎宿; 東海道's sea crossing
  宮–桑名 has no stage). Cycle routes have stages only where OpenStreetMap has them.
- 五街道 licence: CC BY-NC-SA 4.0, so the tracks and the five route files built from them are
  not committed (`.gitignore`). `lists fetch gokaido` downloads the tracks from a pinned commit;
  on a fresh clone the five lists stay unbuilt until then.
- Stage names are cleaned by the build (`packages/cli/src/lists/route-names.ts`): the list's
  own name comes off each stage, 関東ふれあいの道's "KFT - T23 - …" becomes "Tochigi 23: …",
  四国遍路 stages are named by temple, and English names are tidied. Names still wrong after
  that are corrected by OpenStreetMap relation id in `overrides.jsonc` (`routeNames`).
- Lengths from OpenStreetMap include branches, so some are longer than the official figure
  (太平洋岸自転車道: 1,545 km built, 1,487 km official).
- GSI high points: names and heights were transcribed by hand from GSI's PDF; `lists fetch`
  only refreshes the coordinates.
