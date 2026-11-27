# 東海自然歩道 GPS data (Ministry of the Environment)

- Page: https://www.env.go.jp/nature/long-trail.html (「東海自然歩道のGPSデータを公開しました」,
  March 2025). The zip linked there in November 2026 was https://www.env.go.jp/content/000304454.zip
  (556 KB).
- Licence: env.go.jp content is under 公共データ利用規約 (第1.0版), PDL1.0, unless marked
  otherwise (https://www.env.go.jp/mail.html). Attribution only, commercial use allowed, like
  CC BY 4.0. Credit: 出典：環境省「東海自然歩道GPSデータ」(page URL) を加工して作成, PDL1.0.
- `jam lists fetch moe` finds the zip link on the page, extracts every GPX file here (converted
  to UTF-8 where the file declares Shift_JIS) and writes `manifest.json` with the zip URL, the
  date and each file's name in the archive. The page asks users to read the notes in the zip;
  they are saved here as UTF-8 text, and anything else in the zip is listed under `notExtracted`.
- The November 2026 zip has one file, `東海自然歩道_全線_250331.gpx`: three main-line tracks
  (named 0, 1 and 2; about 1,140, 51 and 118 km) and 115 tracks named `東海自然歩道本線以外.GPX(n)`,
  the branches and detours (about 360 km). The ministry's own figure for the whole trail is
  1,749.8 km (2023).
- `jam lists build` makes one route item per main-line track and leaves the 本線以外 tracks out.
