# 五街道 tracks

- Source: https://github.com/japan-road-jp/Gokaodo-Map (五街道GPX・五街道KML・五街道SHP, 2024-08-15 revision)
- Commit: 3d3094558b093774b23d1314c0180f26e64ab9c5
- Author: 国道愛好家 くにみち (japan.road.jp@gmail.com)
- Licence: CC BY-NC-SA 4.0 (the repository's LICENSE, fetched alongside). Non-commercial use only;
  anything derived from these tracks (the built route files) is shared under the same licence.

Not committed. Because of the non-commercial licence, the GPX files and the route files built
from them (`lists/routes/{tokaido,nakasendo,koshu-kaido,nikko-kaido,oshu-kaido}.geojson`) are in
`.gitignore`, so the repository holds no non-commercial data. `pnpm jam lists fetch gokaido`
downloads them from the pinned commit and checks each against its SHA-256 (in `fetch.ts`); then
`pnpm jam lists build` builds the five lists. Until then the five lists show as not built.

The files are the repository's GPX files, renamed:

| File | Original | Covers |
| --- | --- | --- |
| tokaido-1.gpx | data/gpx/Tokaido1_v3.gpx | 東海道 日本橋 – 宮 |
| tokaido-2.gpx | data/gpx/Tolaodo_2_v3.gpx | 東海道 桑名 – 三条大橋 (宮–桑名 is the sea crossing 七里の渡し) |
| nakasendo.gpx | data/gpx/Nakasendo_1.2.gpx | 中山道 日本橋 – 草津追分 |
| nikko-kaido.gpx | data/gpx/Nikko Kaido.gpx | 日光道中 日本橋 – 日光神橋 |
| oshu-kaido.gpx | data/gpx/Oshu Kaido.gpx | 奥州道中 宇都宮 – 白河追分 (日本橋 – 宇都宮 is shared with 日光道中) |
| koshu-kaido.gpx | data/gpx/Koshu_Kaido_v2.gpx | 甲州道中 日本橋 – 下諏訪追分 |

The published site shows these routes; that is the personal, non-commercial use the licence allows,
with the credit in `lists/credits.json`.
