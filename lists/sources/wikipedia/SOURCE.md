# Japanese Wikipedia

- Source: https://ja.wikipedia.org/wiki/山梨百名山 (revision 111673593), CC BY-SA 4.0.
  The list itself was chosen by Yamanashi Prefecture in 1997.
- `yamanashi-hyakumeizan.json`: the page's list table (number, name, reading, elevation, range)
  plus each linked article's primary coordinates from the GeoData API, where it has them.
  Readings with several lines keep the first.
- Coordinates here are a last resort. The build prefers GSI's mountain list, then
  OpenStreetMap peaks, and skips article coordinates given to two decimals or fewer
  (some articles round to the nearest 0.1°).
- `jam lists fetch` refreshes this file the same way.

## Numbered temples and castles

- `shikoku-88.json` (四国八十八箇所), `saigoku-33.json` (西国三十三所), `castles-100.json`
  (日本100名城) and `castles-zoku-100.json` (続日本100名城, numbered 101–200), from the articles of
  those names, CC BY-SA 4.0. Each file records the page revision.
- Membership and numbers: every row of the rendered articles' tables (the HTML, since some of
  these articles build their tables from templates) that has a list number (`1`, `第1番`)
  and a linked temple or castle after it (a link whose name ends in 寺, else one with 院, 堂, 庵 or 坊; or 城, 館,
  郭, 台場, 陣屋, チャシ or 砦, else a site, 遺跡, 史跡 or 跡, as 吉野ヶ里 is linked). Rows without a number (番外) are skipped. `jam lists fetch`
  logs any number it found no row for, and rows that repeat a number.
- Coordinates: each linked article's primary coordinates (GeoData), and P625 of its Wikidata
  item (`pageprops.wikibase_item`). The build uses the article's position first and Wikidata's
  when the article has none or it is off land, and lists in `lists/review.md` every item where
  the two are more than 1 km apart.
- Where a row links the wrong article (続日本100名城 #124 links only 台場), `lists/overrides.jsonc`
  corrects the name and position.
- `jam lists fetch wikipedia` refreshes these with the 山梨百名山 file.

## Post towns of the 五街道

- `post-towns-tokaido.json` (東海道五十三次), `post-towns-nakasendo.json` (中山道六十九次),
  `post-towns-koshu-kaido.json` (甲州街道), `post-towns-nikko-kaido.json` (日光街道) and
  `post-towns-oshu-kaido.json` (奥州街道), from the articles of those names, CC BY-SA 4.0.
- Each numbered row of the rendered tables ("1. 品川宿"), in page order, with its linked
  article's coordinates and Wikidata item (English label, P625).
- The build places each post town on its 五街道 line (from `../gokaido`) and cuts the line
  there. Post towns more than 1.5 km from the line are left out: shared sections (奥州道中's line
  starts at 宇都宮) and towns without coordinates. One that lands out of order is left out and
  named in `lists/review.md`; towns within 150 m of each other (合宿 such as 上・下高井戸) are
  one boundary.
- Where an article gives no usable position (none, wrong, or off the line), the build uses an
  OpenStreetMap place of the same name (芦野宿, 芦野宿跡 or 芦野) on the line between the towns
  either side, from `../osm/post-town-places.json`. `lists/review.md` names every town placed
  this way and every town still missing.
- An article is about its town when it is on a post town (高井戸宿 for 下高井戸宿 and 上高井戸宿)
  or on the place the town is named after (吉野町 for 吉野宿). Many 甲州街道 towns link the
  village they were in instead (富浜村, 大月町, 初狩村, 笹子村), so several towns would share the
  village's point and name. Such a town sits at the OpenStreetMap place of its own name nearest
  the village's point (a board, a stone or a bus stop, within 2.5 km), where there is one, and
  the village's English label is not used. Towns that share an article on a post town are one
  boundary named after it; any other towns at one place are named after each of them
  (白野宿・阿弥陀海道宿, both at 笹子村's point).
- A town listed twice in a row under the same number is one town: where one table ends with a
  town and the next begins with it (東海道五十三次 repeats 大津宿, unlinked, at the head of its
  京街道 table; 甲州街道 repeats 甲府柳町宿), the repeat only fills in what the first row lacks.
- English names are the Wikidata label of an article about the town. A town without one is
  named after an OpenStreetMap place of its name within 2.5 km, from the same file: one named
  like the town (千住宿 → Senju-juku), else like the place (国領 → Kokuryō), taking its
  romanisation, English name or romanised reading. Those are place names, since whether 宿 is
  read juku or shuku varies. Labels that are not the town's (猿橋宿's "Saruhashi Bridge", 栗原宿's
  "Kurihara resort" for くりばら) are corrected there too. Where
  there is none, `postTownNames` in `lists/overrides.jsonc` gives one by hand; `lists/review.md`
  names every town named from OpenStreetMap and every one still without an English name.

## Lists of mountains and waterfalls

- `hana-no-hyakumeizan.json` (花の百名山, 田中澄江 1980), `kanto-hyakumeizan.json` (関東百名山,
  山と溪谷社), `kansai-hyakumeizan.json` (関西百名山, 山と溪谷社大阪支局 1998) and `taki-100.json`
  (日本の滝百選, 1990), from the articles of those names, CC BY-SA 4.0. Each file records the page
  revision. Written by `jam lists fetch wikipedia`; not there until it has run.
- Membership: read from the rendered article however it lays the list out. In order of
  preference: tables with a column that numbers the list (several numbered blocks side by side
  are fine), taking the name from the column headed 山名 or 名称, or else the first name after
  the number; numbered lists; tables with such a name column and no numbers, numbered in page
  order. Each file's `note` says which it was.
- `problems` in each file lists what could not be read: numbers with no entry, rows whose number
  was already taken, names with no linked article. The build copies them into `lists/review.md`
  and the list is partial while any member is missing or has no position.
- Coordinates and English names as for the temples and castles: the linked article's primary
  coordinates, then its Wikidata item's P625; the item's English label. A mountain within 1 km
  of a GSI summit of the same name becomes that GSI place.
