# Prefecture outlines

- `prefectures-s0010.json`: simplified to 1 % of vertices (about 61,000 points), used for matching
- `prefectures-s0001.json`: simplified to 0.1 % (about 8,000 points), used for display
- Downloaded from: https://github.com/smartnews-smri/japan-topography/tree/b403e71eb97f1fdf32f63d16bd485129f703855e/data/municipality/geojson
- Commit: `b403e71eb97f1fdf32f63d16bd485129f703855e`
- Original data: 国土交通省 国土数値情報（行政区域データ, N03）, 2021 edition, https://nlftp.mlit.go.jp/ksj/
- Credit: 出典：国土交通省国土数値情報（行政区域データ）を加工して作成
- The SmartNews Media Research Institute asks for no credit for its processing.

## Detailed outlines

- `outlines/<code>.geojson`: each prefecture at full detail, its municipalities merged, as two
  features: its area, and its land borders (the stretches it shares with a neighbour, found as the
  points both prefectures' outlines have). Borders are simplified to 5 m and the coast to 25 m;
  rocks under 5,000 m² are left out. For the selected prefecture's highlight on the map. Written by
  `pnpm jam lists fetch outlines`, which reads all 47 before writing any.
- Downloaded from: https://github.com/niiyz/JapanCityGeoJson (one file per prefecture under
  `geojson/prefectures`, the N03 2020 edition converted to GeoJSON)
- Commit: `f163894b3b6acfe31e772da6fce87b13427d3b56`
- Credit: 出典：国土交通省国土数値情報（行政区域データ）を加工して作成
