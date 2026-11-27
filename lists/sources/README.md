# Source snapshots

Raw inputs for `pnpm jam lists build`, pinned to exact commits or revisions so every build is
reproducible. Nothing here is edited by hand; corrections go in `lists/overrides.jsonc`.

Sources that need the network are refreshed with `pnpm jam lists fetch` (all of them, or name
some: `gsi`, `highpoints`, `wikidata`, `wikipedia`, `osm`, `moe`, `gokaido`). Run it on a machine with normal
internet access, then `pnpm jam lists build`.

| Folder | What | Original data | Licence and credit |
| --- | --- | --- | --- |
| `gsi-mountains` | GSI's mountain list: coordinates, elevation, reading, prefectures | GSI 日本の主な山岳標高. `1003zan<date>.csv` is GSI's own CSV, saved by `lists fetch`; until it exists the build uses `mountains.jsonl`, an older edition via mountix | GSI content terms (compatible with CC BY 4.0); credit GSI. mountix is MIT |
| `gsi-highpoints` | The highest point of each prefecture | GSI 都道府県の最高地点 (2025-04-01) | GSI content terms; credit GSI |
| `kongo` | Membership, numbering and English names for the 100, 200, 300 Meizan, the 100 highest and the 100 low mountains | The kongo project | MIT |
| `wikipedia` | 山梨百名山: membership, numbers, readings, heights, article coordinates. 四国八十八箇所, 西国三十三所, 日本100名城 and 続日本100名城: members, numbers, article and Wikidata coordinates. 花の百名山, 関東百名山, 関西百名山 and 日本の滝百選: members in the article's numbering or order, with the same. Post towns of the 五街道, for splitting them into stages | Japanese Wikipedia (coordinates also Wikidata) | CC BY-SA 4.0 |
| `wikidata` | 坂東三十三観音 and 秩父三十四観音: temples, numbers, coordinates | Wikidata | CC0 |
| `moe-tokai` | 東海自然歩道 tracks: one GPX file, 3 main-line and 115 branch tracks, and the ministry's notes | 環境省「東海自然歩道GPSデータ」, saved by `lists fetch moe` | 公共データ利用規約 (PDL1.0, compatible with CC BY 4.0); credit 環境省 |
| `gokaido` | Tracks of the five Edo-period highways. Not committed: fetched by `lists fetch gokaido` | 五街道GPX by 国道愛好家 くにみち, pinned commit | CC BY-NC-SA 4.0: non-commercial, and the built route files share the licence (so they aren't committed either) |
| `osm` | Cycle routes, long trails, 四国遍路 and 熊野古道, Yamanashi peaks | OpenStreetMap via Overpass, saved by `lists fetch osm` | ODbL; credit OpenStreetMap contributors |
| `n03-prefectures` | Prefecture outlines at two levels of detail, and each prefecture in full detail (`outlines/`) | MLIT National Land Numerical Information (行政区域, N03), simplified by SmartNews Media Research Institute; full detail via niiyz/JapanCityGeoJson | MLIT terms; credit required |
| `n03-municipalities` | Every municipality with its outline and names, for the Municipalities list | MLIT N03, simplified by SmartNews Media Research Institute; English names from nobuf/list-of-cities-in-japan | MLIT terms, credit required; MIT |
| `michi-100` | 日本の道100選: 104 roads with a hand-checked point each, where one could be found | Assembled by hand from the Japanese Wikipedia list, Wikidata and OpenStreetMap | CC BY-SA 4.0 (membership), CC0, ODbL |

Each folder's `SOURCE.md` names the exact commit, revision or URL.
