# Municipalities

- `municipalities.geojson`: every municipality (市区町村, with Tokyo's 23 wards; a designated city
  counts once) with its outline, code, prefecture, and Japanese and English name. Written by
  `pnpm jam lists fetch municipalities`. The site build ticks the ones a published track passes
  through and publishes them as the Municipalities list.
- Outlines: https://github.com/smartnews-smri/japan-topography, commit
  `b403e71eb97f1fdf32f63d16bd485129f703855e`, `data/municipality/geojson/s0010/N03-21_210101_designated_city.json`
  (N03 2021 edition, simplified to 1 %), rounded to 5 decimals
- Credit: 出典：国土交通省国土数値情報（行政区域データ）を加工して作成
- English names: https://github.com/nobuf/list-of-cities-in-japan (MIT), commit
  `abffcb263d0fd92e5180ef7419909554fadf50c7`, `build/cities_in_japan_2024.csv`
