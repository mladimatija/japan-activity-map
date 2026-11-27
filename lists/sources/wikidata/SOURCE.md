# Wikidata pilgrimage circuits

- Source: Wikidata (https://www.wikidata.org), CC0 (no attribution required; credited anyway).
- `bando-33.json`: members of Q806417 (坂東三十三観音), 33 temples.
- `chichibu-34.json`: members of Q11596109 (秩父札所三十四観音霊場), 34 temples.
- Membership is "part of" (P361) with a series ordinal (P1545) qualifier, which is the temple's
  number in the circuit. Coordinates are P625. 善光寺, listed as part of both without a number
  (the customary thank-you visit after finishing), is left out.
- `jam lists fetch wikidata` refreshes both files with the same query.
- Not used for 四国八十八箇所, 西国三十三所 or the castle lists: in November 2026 Wikidata's own
  sets were incomplete (Q1972399 四国八十八箇所: 7 numbered members; Q30927700 続日本100名城: 58;
  Q1139439 日本100名城: 99; Q750721 西国三十三所 had a wrong second #31). Those come from the
  Wikipedia list articles (see `../wikipedia/SOURCE.md`), with Wikidata only for coordinates.
