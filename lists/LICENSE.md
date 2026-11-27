# Licences of the data in `lists/`

The MIT licence in the repository's [LICENSE](../LICENSE) covers the source code, the
documentation and the hand-written files here (`overrides.jsonc`, the README files). It does
**not** cover the data: everything under `lists/sources/` and every list built from it keeps the
licence of the source it comes from. This is a summary for orientation, not legal advice; the
linked terms are what count.

| Source                                                                                                                                                                     | Used for                                                                                                   | Licence                                                         | What it asks                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [GSI 日本の主な山岳標高](https://www.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html) and [都道府県の最高地点](https://www.gsi.go.jp/KOKUJYOHO/MOUNTAIN/todofuken.pdf) | Summits, heights, readings; prefectural high points                                                        | GSI content terms of use (compatible with CC BY 4.0)            | Credit the Geospatial Information Authority of Japan                               |
| [MLIT 国土数値情報（行政区域）](https://nlftp.mlit.go.jp/ksj/), simplified by SmartNews Media Research Institute                                                           | Prefecture and municipality outlines                                                                       | MLIT National Land Numerical Information terms of use           | Credit, and say the data was processed                                             |
| [OpenStreetMap](https://www.openstreetmap.org/copyright)                                                                                                                   | Cycle routes, long trails, pilgrimage routes, some peaks, positions looked up by name                      | ODbL 1.0                                                        | Credit OpenStreetMap contributors; a database derived from it is shared under ODbL |
| [Japanese Wikipedia](https://ja.wikipedia.org/)                                                                                                                            | Membership and order of the temple, castle, peak, waterfall and road lists; post towns                     | CC BY-SA 4.0                                                    | Credit; adaptations are shared under the same licence                              |
| [Wikidata](https://www.wikidata.org/)                                                                                                                                      | Coordinates, English labels, the 坂東 and 秩父 circuits                                                    | CC0 1.0                                                         | Nothing                                                                            |
| [kongo](https://github.com/ryunosuke0922/kongo)                                                                                                                            | Membership, numbering and English names of the 100, 200, 300 Meizan, the 100 highest and 100 low mountains | MIT                                                             | Keep the copyright notice (`sources/kongo/LICENSE`)                                |
| [nobuf/list-of-cities-in-japan](https://github.com/nobuf/list-of-cities-in-japan)                                                                                          | English names of municipalities                                                                            | MIT                                                             | Keep the copyright notice                                                          |
| [環境省 東海自然歩道GPSデータ](https://www.env.go.jp/nature/long-trail.html)                                                                                               | 東海自然歩道 tracks                                                                                        | 公共データ利用規約 第1.0版 (PDL 1.0, compatible with CC BY 4.0) | Credit the Ministry of the Environment                                             |
| [五街道GPX (国道愛好家 くにみち)](https://github.com/japan-road-jp/Gokaodo-Map)                                                                                            | The five Edo-period highways                                                                               | CC BY-NC-SA 4.0                                                 | Credit; **non-commercial use only**; adaptations share the licence                 |

## What follows from this

- **The five highways are not in the repository.** Their source and the route files built from it
  are fetched and built on your own machine (`pnpm jam lists fetch gokaido`). A site that
  publishes them is bound by the non-commercial term.
- **A built site carries the credits.** `pnpm jam build` writes every source used into
  `meta.json`, and the site shows them under "List and boundary sources". Do not remove that.
- **The built list files are mixed works.** Each `.geojson` under `lists/` names its sources in
  its `metadata.sources`; treat a file as under the strictest licence listed there (for most
  point lists CC BY-SA 4.0 or ODbL, not MIT).
- Each `sources/<folder>/SOURCE.md` names the exact revision and terms of its files.
