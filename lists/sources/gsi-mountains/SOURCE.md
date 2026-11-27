# GSI mountain list (via mountix)

- File: `mountains.jsonl` (one JSON object per line)
- Downloaded from: https://github.com/codemountains/mountix/blob/1325247de2465c10b5b01f71496dc26c96b2b240/migrations/data/mountix_db-mountains.json
- Commit: `1325247de2465c10b5b01f71496dc26c96b2b240` (2026-05-31)
- Original data: 国土地理院「日本の主な山岳標高」 https://www.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html
- `_id` matches GSI's row number (連番) in that list.
- Edition: earlier than GSI's 2025-04-01 revision (for example 羅臼岳 is 1,661 m here and 1,660 m in current GSI data).
  Where a peak is also in the kongo lists, the build uses kongo's newer elevation.
- Credit: 出典：国土地理院「日本の主な山岳標高」を加工して作成
- mountix licence: MIT (`LICENSE-mountix`)
- Known issue: mountix's 百名山 and 二百名山 tags contain homonym mistakes (for example a 1,645 m 薬師岳 tagged instead of the 2,926 m one), so the build ignores those tags and takes membership from kongo.
