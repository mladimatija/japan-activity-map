# 日本の道100選 (Japan's 100 roads)

`roads.json` is assembled by hand, not fetched: `pnpm jam lists fetch` doesn't touch it.

- Membership, order, municipalities: the list in the Japanese Wikipedia article
  [日本の道100選](https://ja.wikipedia.org/wiki/日本の道100選) as read on 2026-11-27 (CC BY-SA 4.0).
  The article follows the selection made in 1986 and 1987 for the Ministry of Construction's
  「道の日」: 104 roads.
- English names: the English Wikipedia or Wikidata name where one exists, otherwise
  romanised here.
- Positions: a road is a line, and this list places one point on or beside each: the linked
  article's coordinates (`wikipedia`), the Wikidata item's coordinates (`wikidata`, CC0), or an
  OpenStreetMap object of that name in that municipality (`osm`, ODbL, found with Nominatim on
  2026-11-27; `ref` names it). Each was checked against the municipality in the list.
- A second pass (also 2026-11-27) placed 26 more at an OpenStreetMap object on or beside the
  road: the road under another name, the quarter it runs through, or a landmark it passes (a
  museum, a park, a pass, a harbour), each in the municipality the list names. These say where
  the road is, not where it starts.
- A third pass placed four more at a landmark that stands on the road: #6 at 十和田市現代美術館,
  #50 at the 恋路ヶ浜 board on the cycle path, #56 at 道の駅草津, #64 at the 淡路島南IC bus stop on the expressway.
- Not placed (12): #7 一関市道金沢線・岩が崎線, #8 寺町通り, #14 ひな市通り, #17 旧奥州街道,
  #23 ハナミズキ通り, #38 白馬山麓線, #45 板取街道, #70 大山道路, #72 みゆきの道, #95 大津街道,
  #97 佐伯市道山際線, #98 北滝ロマン道路. OpenStreetMap has no object of that name in the right
  place (searched through Nominatim under the list's name and other names), and no landmark
  could be tied to the road with confidence. They are in the list without a point; someone who
  knows the road can add one in a minute.

To place one more, add `lat`, `lon`, `from` and `ref` to its entry and run `pnpm jam lists build`.
