# kongo mountain lists

- Files: `mountains.json` (日本百名山), `nihyakumeizan.json`, `sambyakumeizan.json` (#201–300), `sambyakumeizan-source.json` (official 300 Meizan numbers), `hyakukozan.json` (日本百高山), `hyakuteizan.json` (日本百低山, 101 mountains under 1,500 m)
- Downloaded from: https://github.com/ryunosuke0922/kongo/tree/434135fb52ad49a93388e4ae0f3eaf74690a97c3/src/data
- Commit: `434135fb52ad49a93388e4ae0f3eaf74690a97c3` (2026-11-18)
- The project states that summits and elevations were checked against GSI's 2026-03-31 edition and that 300 Meizan membership was checked against the Japanese Alpine Club's 300 Meizan list.
- Licence: MIT, Copyright (c) 2022 ryunosuke (`LICENSE`)
- Coordinates: the build replaces kongo coordinates with GSI's wherever a GSI summit is within 1 km and the names or elevations agree. The rest keep kongo's coordinates, which may come from YAMAP landmarks; they are flagged in `lists/review.md`.
