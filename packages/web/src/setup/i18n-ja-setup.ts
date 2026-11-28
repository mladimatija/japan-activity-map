/**
 * The setup page in Japanese, keyed by the English it replaces. Kept apart from i18n-ja.ts so the
 * public site does not carry it: src/setup/main.tsx registers it (registerTranslations in i18n.ts).
 * Step titles and help are written in English in packages/cli/src/setup and looked up here.
 */
export const SETUP_JA: Record<string, string> = {
  'A .zip of GPX files, or .gpx files in data/activities, from any app that exports them. The site is then built from these instead of Strava.':
    'GPXファイルをまとめた.zip、またはdata/activitiesに置いた.gpxファイル。GPXを書き出せるアプリならどれでも使えます。サイトはStravaの代わりにこれらから作られます。',
  'A file whose own type is missing or not understood counts as this.':
    '種類が書かれていない、または読み取れないファイルはこの種類として扱います。',
  'Folder of GPX files': 'GPXファイルのフォルダ',
  'GPX files': 'GPXファイル',
  'Import GPX files': 'GPXファイルを取り込む',
  'Relative to the repository. Empty: data/activities. Put .gpx files or a .zip of them there. See docs/gpx.md.':
    'リポジトリからの相対パス。空欄の場合はdata/activities。.gpxファイル、またはそれらをまとめた.zipを置いてください。docs/gpx.mdを参照。',
  'Strava activities and GPX activities can both be in the local store; the site shows one of the two, plus the sheet. Changing this later deletes nothing.':
    'StravaのアクティビティとGPXのアクティビティは、どちらもローカルストアに置いておけます。サイトにはどちらか一方とシートが表示されます。あとで切り替えても何も削除されません。',
  'Type of a GPX file that names none': '種類が書かれていないGPXファイルの種類',
  'Which is the site built from?': 'サイトをどちらから作りますか？',
  'Put your GPX files, or a .zip of them, in data/activities.':
    'GPXファイル、またはそれらをまとめた.zipをdata/activitiesに置いてください。',
  'Any app that exports GPX will do. One file is one activity; importing a file again updates it. See docs/gpx.md.':
    'GPXを書き出せるアプリならどれでも使えます。1ファイルが1アクティビティになり、同じファイルをもう一度取り込むと更新されます。docs/gpx.mdを参照。',
  'Drop a .zip or .gpx file here, or choose one.':
    '.zipまたは.gpxファイルをここにドロップするか、選択してください。',
  'Choose a file': 'ファイルを選択',
  'It is saved in the GPX folder on this computer and imported when the plan runs. Up to 512 MB; put a larger export into the folder yourself.':
    'このコンピューターのGPXフォルダに保存され、プランの実行時に取り込まれます。512 MBまで。それより大きい場合はフォルダに直接置いてください。',
  'Sending {name}…': '{name} を送信中…',
  'Saved {name}: {count} GPX files.': '{name} を保存しました: GPXファイル {count} 件。',
  'The file was not taken.': 'ファイルを受け付けられませんでした。',
  'Only a .zip or .gpx file is taken.': '.zipまたは.gpxファイルのみ受け付けます。',
  'The file is too large.': 'ファイルが大きすぎます。',
  'The archive holds no GPX file.': 'このアーカイブにGPXファイルがありません。',
  'This is not a GPX file.': 'GPXファイルではありません。',
  'the GPX folder is not there yet': 'GPXフォルダがまだありません',
  '19 is roughly 60 m across in Japan.': '19は日本ではおよそ60 m四方です。',
  '5 is about 1 m.': '5桁でおよそ1 mです。',
  'A CSV or .xlsx file of activities, with GPX tracks if you have them.':
    'アクティビティをまとめたCSVまたは.xlsxファイル。GPXトラックがあれば併用できます。',
  'A TileJSON address': 'TileJSONのアドレス',
  'A link leads back to your profile. Off: neither the link nor the Strava id is published.':
    'リンクからあなたのプロフィールにたどり着けます。オフの場合、リンクもStravaのIDも公開されません。',
  'A list of lists of activities that form a route of their own: [[789]].':
    '独立したルートにするアクティビティのリストのリスト: [[789]]。',
  'A list of lists of activities whose routes become one: [[123, 456]].':
    'ルートを1つにまとめるアクティビティのリストのリスト: [[123, 456]]。',
  'A list of { "name", "query" }; the query is the part of a site address after #. "default" keeps the built-in ones, [] offers none.':
    '{ "name", "query" } のリスト。queryはサイトのアドレスの#より後の部分です。"default"で組み込みのビューを使い、[]でビューなしになります。',
  'A place counts as visited within (m)': '訪問済みとみなす距離 (m)',
  'A sheet you keep by hand': '手入力のシート',
  'A style address, or "none" to give everyone the light style.':
    'スタイルのアドレス。"none"にすると全員にライトスタイルを表示します。',
  'A tile address': 'タイルのアドレス',
  'Activities per page': '1ページあたりのアクティビティ数',
  'Activities to split off': '切り離すアクティビティ',
  'Activity types to keep': '取り込むアクティビティの種類',
  'Also hides activity names and pace along tracks.':
    'アクティビティ名とトラック上のペースも非公開にします。',
  'Also publishes Strava links and the time of day.': 'Stravaへのリンクと時刻も公開します。',
  'An https address with {z}, {x} and {y}.': '{z}、{x}、{y}を含むhttpsのアドレス。',
  'An object keyed by any activity in the route: { "12345678901": "Riverside loop" }. `pnpm jam routes review` lists candidates in data/routes-review.md.':
    'ルート内の任意のアクティビティをキーにしたオブジェクト: { "12345678901": "Riverside loop" }。`pnpm jam routes review` を実行すると候補が data/routes-review.md に書き出されます。',
  'An object keyed by list id, such as { "nihon-100-meijo": { "pointRadiusM": 300 } }.':
    'リストIDをキーにしたオブジェクト。例: { "nihon-100-meijo": { "pointRadiusM": 300 } }。',
  'An object such as { "Hike": "hike", "EBikeRide": "ride" }. Sport types not listed are skipped.':
    '{ "Hike": "hike", "EBikeRide": "ride" } のようなオブジェクト。ここにないスポーツタイプは取り込まれません。',
  'Any MapLibre style address. OpenFreeMap Positron needs no key.':
    'MapLibreのスタイルのアドレス。OpenFreeMapのPositronはキー不要です。',
  'Build the reference lists': '参照リストをビルド',
  'Build the site data': 'サイトのデータをビルド',
  'Build the web app (pnpm web:build)': 'ウェブアプリをビルド (pnpm web:build)',
  'CSV or .xlsx, relative to the repository. Keep it in data/. Start from templates/activity-sheet.csv; the columns are in templates/README.md.':
    'CSVまたは.xlsx。リポジトリからの相対パスで指定します。data/ に置いてください。templates/activity-sheet.csv をひな形にでき、列の説明は templates/README.md にあります。',
  'Carries its own credit.': 'クレジット表記はTileJSONに含まれます。',
  'Check the reference lists': '参照リストを検証',
  'Commutes trace the line between home and work.': '通勤の記録は自宅と職場を結ぶ線になります。',
  'Compares the street two tracks cover, not their total distance.':
    '合計距離ではなく、2つのトラックが通った道を比べます。',
  'Create one at https://www.strava.com/settings/api with Authorization Callback Domain "localhost", then ask Strava to raise it to "up to 10 athletes": without that the API answers 403. Reading activities through the API also needs a Strava subscription. See docs/strava-setup.md.':
    'https://www.strava.com/settings/api でアプリケーションを作成し、Authorization Callback Domainを"localhost"にします。次に、Stravaに「10人まで」への引き上げを申請してください。これがないとAPIは403を返します。APIでアクティビティを読むにはStravaのサブスクリプションも必要です。docs/strava-setup.md を参照してください。',
  'Credit the tiles ask for': 'タイルが求めるクレジット表記',
  'Cycle routes and long trails. Several minutes.':
    'サイクリングルートとロングトレイル。数分かかります。',
  'Days before a pull counts as stale': '取得が古いとみなすまでの日数',
  'Decimals in coordinates': '座標の小数桁数',
  'Deepest zoom the tiles have': 'タイルの最大ズーム',
  'Demo data': 'デモデータ',
  Deploy: 'デプロイ',
  'Distance tolerance (%)': '距離の許容差 (%)',
  'Download reference sources': '参照データをダウンロード',
  'Each choice sets several switches; full setup has every switch on its own.':
    'どれを選んでも複数のスイッチがまとめて設定されます。詳細セットアップでは1つずつ設定できます。',
  'Elevation tiles for the terrain switch on the map.': '地図の地形表示に使う標高タイル。',
  'Empty: from the beginning.': '空欄: 最初から。',
  'Empty: the demo command decides.': '空欄: デモコマンドが決めます。',
  'Empty: today.': '空欄: 今日。',
  'Empty: up to today.': '空欄: 今日まで。',
  'End tolerance (m)': '終点の許容差 (m)',
  English: '英語',
  'Every municipality with its outline.': 'すべての市区町村とその境界。',
  'Every published track loses the part near this point. Find it by right-clicking your home on a map. Empty skips it: tracks then show where they start.':
    '公開されるすべてのトラックから、この地点の周辺が切り取られます。地図で自宅を右クリックすると座標がわかります。空欄にすると設定されず、トラックの出発地点がそのまま見えます。',
  'Fetch a large batch of full tracks now?': '詳細トラックを今まとめて取得しますか？',
  'Fetch full tracks for up to 400 activities': '最大400件のアクティビティの詳細トラックを取得',
  'Fetch your Strava activities': 'Stravaのアクティビティを取得',
  'First day to fetch (YYYY-MM-DD)': '取得する最初の日 (YYYY-MM-DD)',
  'Flag matches this close to the radius (m)': '半径にこれだけ近い一致を要確認にする (m)',
  'For dates and times without an offset.': 'オフセットのない日時に使います。',
  'Free, no key, on AWS Open Data.': '無料、キー不要。AWS Open Dataで提供されています。',
  'Full tracks fetched after each pull': '取得のたびに取り込む詳細トラックの数',
  'Grid zoom': 'グリッドのズーム',
  'Group repeated activities into routes': '繰り返したアクティビティをルートにまとめる',
  'Heights and times for height profiles, records and pace. 80 fits one 15-minute Strava window; 0 turns it off.':
    '標高プロフィール、記録、ペースのための標高と時刻。80件ならStravaの15分枠に収まります。0でオフになります。',
  'Higher hides more and cuts more track.':
    '大きくするほどよく隠れますが、切り取られるトラックも増えます。',
  'Home location to hide (latitude, longitude)': '隠す自宅の位置 (緯度, 経度)',
  'How far a zone centre may move (share of its radius)':
    'ゾーンの中心をずらす最大幅 (半径に対する割合)',
  'How heights are packed': '標高のエンコード方式',
  'How much each activity varies the radius (m)': 'アクティビティごとの半径のゆらぎ (m)',
  'Import activities set to "Only You"?': '「自分のみ」のアクティビティも取り込みますか？',
  'Import the activity sheet': 'アクティビティのシートを取り込む',
  'Include commutes in the heatmap': '通勤をヒートマップに含める',
  'Is your Strava API application ready?': 'StravaのAPIアプリケーションは準備できていますか？',
  Japanese: '日本語',
  'Keep what is set': '今の設定のまま',
  'Language of the made-up names': '架空の名前の言語',
  'Last day of the history (YYYY-MM-DD)': '履歴の最終日 (YYYY-MM-DD)',
  'Last day to fetch (YYYY-MM-DD)': '取得する最後の日 (YYYY-MM-DD)',
  'Leave the publish switches as they are.': '公開のスイッチを変更しません。',
  'Link each activity to Strava': '各アクティビティにStravaへのリンクを付ける',
  'List routes that may need merging or splitting': '統合や分割が必要そうなルートを一覧にする',
  'Local port for the sign-in redirect': 'サインインのリダイレクトに使うローカルポート',
  'Longest gap bridged inside a stretch (m)': '区間内でつなぐ最大の途切れ (m)',
  'Make demo data and build a demo site': 'デモデータを作ってデモサイトをビルド',
  'Map style (light)': '地図のスタイル (ライト)',
  'Map style for dark mode': 'ダークモード用の地図スタイル',
  'Mapzen Terrain Tiles': 'Mapzen Terrain Tiles',
  'Margin round the coast that counts as Japan (m)': '日本とみなす海岸からの余白 (m)',
  'Match activities to the lists': 'アクティビティをリストと照合',
  Matching: '照合',
  'More open': 'より多く公開',
  'More private': 'より非公開',
  'Names and pace along tracks; no Strava links, no time of day.':
    '名前とトラック上のペースは公開。Stravaへのリンクと時刻は非公開。',
  'Needs wider Strava access, so the sign-in is asked for again. In quick setup, yes also publishes them.':
    'Stravaへのより広いアクセス権が必要なため、もう一度サインインが求められます。かんたんセットアップで「はい」にすると公開もされます。',
  'No published point moves more than this.': '公開される点はこれ以上動きません。',
  Off: 'オフ',
  'Off: dates only. Start times repeated over months show a routine.':
    'オフ: 日付のみ。何か月分もの開始時刻からは生活のリズムが読み取れます。',
  'Off: each activity is shown as its type, such as "Hike".':
    'オフ: 各アクティビティは「ハイキング」のように種類で表示されます。',
  'One line for search engines and link previews. May be empty.':
    '検索エンジンとリンクのプレビュー用の1行。空欄でもかまいません。',
  'One or more. Each source brings its own questions.':
    '1つ以上選びます。選んだものに応じて質問が加わります。',
  'Only applies when they are imported (see Strava).':
    '取り込まれている場合にのみ有効です (Stravaの設定を参照)。',
  Output: '出力',
  'Places whose surroundings are cut from every published track: a label, a position and a radius each.':
    '公開されるすべてのトラックから周辺が切り取られる場所。それぞれにラベル、位置、半径があります。',
  'Prefecture outlines in full detail. About 500 MB.': '都道府県の詳細な境界。約500 MB。',
  Privacy: 'プライバシー',
  'Privacy zones': 'プライバシーゾーン',
  'Public address of the site': 'サイトの公開アドレス',
  'Publish "Only You" activities': '「自分のみ」のアクティビティを公開する',
  'Publish activities without GPS': 'GPSのないアクティビティを公開する',
  'Publish activity names': 'アクティビティ名を公開する',
  'Publish pace along tracks': 'トラック上のペースを公開する',
  'Publish the time of day': '時刻を公開する',
  'Radius per list': 'リストごとの半径',
  Recommended: 'おすすめ',
  'Reference lists': '参照リスト',
  'Reference sources to download now': '今ダウンロードする参照データ',
  'Regroup every route from scratch': 'すべてのルートを最初からまとめ直す',
  'Remove the demo data': 'デモデータを削除',
  'Route grouping': 'ルートのグループ化',
  'Route names': 'ルート名',
  Routes: 'ルート',
  'Routes to merge': '統合するルート',
  'Saved views': '保存済みビュー',
  'Seconds at each point, restarting after each privacy zone; gives splits and records. No time of day.':
    '各点の経過秒数。プライバシーゾーンのあとは0から数え直します。スプリットや記録の表示に使われ、時刻は含みません。',
  Seed: 'シード',
  'Share of a route item that counts as done': '達成とみなすルート区間の割合',
  'Share of grid cells two tracks must share': '2つのトラックが共有すべきグリッドセルの割合',
  'Shortest covered stretch of a route that counts (m)': '通ったとみなす最短の区間 (m)',
  'Shortest track fragment kept (m)': '残すトラック断片の最短の長さ (m)',
  'Show what the privacy zones do': 'プライバシーゾーンの効果を表示',
  'Shown in the top bar and the browser tab.': '上部のバーとブラウザのタブに表示されます。',
  'Shown on the map; HTML allowed.': '地図上に表示されます。HTMLが使えます。',
  'Sign in to Strava': 'Stravaにサインイン',
  Site: 'サイト',
  'Site description': 'サイトの説明',
  'Site title': 'サイトのタイトル',
  'Start tolerance (m)': '始点の許容差 (m)',
  'Start-up size budget (KB, compressed)': '起動時の読み込みサイズの上限 (KB、圧縮後)',
  Strava: 'Strava',
  'Strava API address': 'Strava APIのアドレス',
  'Strava Client ID': 'StravaのClient ID',
  'Strava Client Secret': 'StravaのClient Secret',
  'Strava sign-in address': 'Stravaのサインイン用アドレス',
  'Strava sport types and what they count as': 'Stravaのスポーツタイプと対応する種類',
  'Temple, castle, flower-mountain and waterfall lists.': '札所、城、花の百名山、滝のリスト。',
  'Terrain and hillshade': '地形と陰影',
  'The build fails when the files loaded at start are larger.':
    '起動時に読み込むファイルがこれを超えるとビルドは失敗します。',
  'The committed lists work as they are. gokaido adds the five historic highways (not committed: non-commercial licence). osm takes several minutes; outlines is about 500 MB.':
    'コミット済みのリストはそのまま使えます。gokaidoは五街道を追加します (非商用ライセンスのためコミットされていません)。osmは数分かかり、outlinesは約500 MBです。',
  'The five historic highways. Not committed (non-commercial licence).':
    '五街道。非商用ライセンスのためコミットされていません。',
  'The number on your application page. Stored in config/secrets.jsonc.':
    'アプリケーションのページにある番号。config/secrets.jsonc に保存されます。',
  'The same seed gives the same history. Empty: the demo command decides.':
    '同じシードからは同じ履歴ができます。空欄: デモコマンドが決めます。',
  'The weekly job skips the pull when the last one is newer.':
    '前回の取得がこれより新しければ、週次の処理は取得を省きます。',
  'Tile address': 'タイルのアドレス',
  'Tile size': 'タイルのサイズ',
  'TileJSON address': 'TileJSONのアドレス',
  'Time zone for the sheet': 'シートのタイムゾーン',
  'Track simplification (m)': 'トラックの簡略化 (m)',
  'Treadmill and gym sessions count in totals; they never appear on the map.':
    'トレッドミルやジムの記録は合計に含まれますが、地図には表示されません。',
  'Treat laps of a section as the same route': '同じ区間の周回を同じルートとして扱う',
  'Typed without being shown. Stored in config/secrets.jsonc, readable only by you.':
    '入力内容は表示されません。config/secrets.jsonc に保存され、あなただけが読めます。',
  'Up to 400 activities, Japan first. About an hour, because Strava limits requests.':
    '最大400件、日本国内を優先。Stravaのリクエスト制限のため1時間ほどかかります。',
  'What is published': '公開する内容',
  'What to publish': '公開する内容',
  'Where activities come from': 'アクティビティの取得元',
  'Where do your activities come from?': 'アクティビティはどこから取り込みますか？',
  'Where the sheet is': 'シートの場所',
  'Write the cut tracks to data/privacy-preview.geojson':
    '切り取り後のトラックを data/privacy-preview.geojson に書き出す',
  'Years of made-up history': '架空の履歴の年数',
  'You give the encoding and the credit.': 'エンコード方式とクレジット表記を自分で指定します。',
  'Your activities through the Strava API. Needs a Strava API application and a subscription.':
    'Strava API経由のアクティビティ。StravaのAPIアプリケーションとサブスクリプションが必要です。',
  'This is needed.': '入力が必要です。',
  'Give latitude and longitude, for example 35.6812, 139.7671.':
    '緯度と経度を入力してください。例: 35.6812, 139.7671',
  'Latitude and longitude are numbers.': '緯度と経度は数値で入力してください。',
  'That is outside Japan. Latitude comes first (about 24 to 46), then longitude (about 123 to 154).':
    '日本の範囲外です。先に緯度 (およそ24〜46)、次に経度 (およそ123〜154) を入力してください。',
  'The Client ID is a number.': 'Client IDは数字です。',
  'Choose at least one source.': '取得元を1つ以上選んでください。',
  'Set the application up first, then run setup again.':
    '先にアプリケーションを用意してから、もう一度セットアップを実行してください。',
  'Addresses are not looked up. Give each zone a lat and lon instead.':
    '住所からの検索は行いません。各ゾーンに緯度と経度を指定してください。',
  'A date as YYYY-MM-DD.': '日付はYYYY-MM-DD形式で入力してください。',
  'Expected a number.': '数値を入力してください。',
  'already signed in': 'サインイン済み',
  'the sheet file is not there yet': 'シートのファイルがまだありません',
  'not available in this version': 'このバージョンでは利用できません',
  'a minute or two; osm several minutes; outlines about 500 MB':
    '1〜2分。osmは数分、outlinesは約500 MB',
  'a few minutes for a long history; waits when Strava limits requests':
    '履歴が長いと数分。Stravaの制限にかかると待機します',
  'about an hour': '約1時間',
  'about a minute': '約1分',
  'new and uncertain matches': '新しい一致と不確かな一致',
  'routes to merge or split': '統合または分割するルート',
  'sheet rows needing a look': '確認が必要なシートの行',
  'what the list build left open': 'リストのビルドで未解決のまま残った点',
  'Japan Activity Map setup': 'Japan Activity Map セットアップ',
  'Back to start': '最初の画面に戻る',
  'Activity type for YAMAP activities': 'YAMAP の活動の種類',
  'Copy your sign-in token from yamap.com.': 'yamap.com からサインイン用トークンをコピーします。',
  'Each track is one request; the next run carries on with the rest.':
    '軌跡1件につきリクエスト1回です。残りは次回の実行で続きから取得します。',
  'Fetch YAMAP activities': 'YAMAP の活動を取得',
  'First day to fetch from YAMAP (YYYY-MM-DD)': 'YAMAP から取得する最初の日（YYYY-MM-DD）',
  'Open your profile on yamap.com and copy the address, such as https://yamap.com/users/1234567. Only the number is kept.':
    'yamap.com で自分のプロフィールを開き、https://yamap.com/users/1234567 のようなアドレスをコピーしてください。保存されるのは数字だけです。',
  'Paste it here; it is not shown. Stored in config/secrets.jsonc, readable only by you. Leave it empty to keep the one stored, or to add it later: the list is fetched without it, the tracks are not.':
    'ここに貼り付けてください。表示はされません。config/secrets.jsonc に保存され、読めるのはあなただけです。空欄のままにすると、保存済みのものをそのまま使うか、あとで追加できます。一覧はトークンなしでも取得できますが、軌跡は取得できません。',
  'Sign in at https://yamap.com. Open the browser developer tools (F12), then Application (Chrome, Edge) or Storage (Firefox, Safari), then Cookies, then https://yamap.com. Copy the value of the cookie named yamap_token. It works like a password for your YAMAP account: keep it to yourself. YAMAP has no official way to do this, and the token stops working when YAMAP signs that browser out; every command then says so. See docs/yamap.md.':
    'https://yamap.com にサインインします。ブラウザの開発者ツール（F12）を開き、Application（Chrome、Edge）または Storage（Firefox、Safari）→ Cookies → https://yamap.com の順に進み、yamap_token という名前の Cookie の値をコピーしてください。この値は YAMAP アカウントのパスワードと同じ働きをするので、他人に渡さないでください。YAMAP 公式の方法ではなく、そのブラウザが YAMAP からサインアウトされるとトークンは使えなくなります。その場合はどのコマンドもそう知らせます。docs/yamap.md を参照してください。',
  'Strava, GPX, Garmin and YAMAP activities can all be in the local store; the site shows one of them, plus the sheet. Changing this later deletes nothing.':
    'Strava、GPX、Garmin、YAMAP の活動はすべてローカルのストアに置いておけます。サイトに出るのはそのうち1つと、シートの分です。あとで変更しても何も削除されません。',
  'This time only: fetch YAMAP activities from this day (YYYY-MM-DD)':
    '今回のみ：この日以降の YAMAP の活動を取得（YYYY-MM-DD）',
  'This time only: fetch YAMAP activities up to this day (YYYY-MM-DD)':
    '今回のみ：この日までの YAMAP の活動を取得（YYYY-MM-DD）',
  'YAMAP does not say what kind of activity a recording is; all of them get this type.':
    'YAMAP は記録がどの種類の活動かを示さないため、すべてこの種類になります。',
  'YAMAP sign-in token (the yamap_token cookie)':
    'YAMAP のサインイン用トークン（yamap_token という Cookie）',
  'YAMAP tracks downloaded per run': '1回の実行でダウンロードする YAMAP の軌跡の数',
  'Your YAMAP profile address, or the number in it':
    'YAMAP のプロフィールのアドレス、またはその中の数字',
  'Your own YAMAP activities and their tracks, with the sign-in token from your browser. YAMAP has no official way to do this: read docs/yamap.md first.':
    'ブラウザのサインイン用トークンを使って、自分の YAMAP の活動と軌跡を取得します。YAMAP 公式の方法ではありません。先に docs/yamap.md を読んでください。',
  'Your profile, the sign-in token, dates': 'プロフィール、サインイン用トークン、日付',
  'YAMAP refused the stored sign-in token at the last sync. It has expired: paste a new one below.':
    '前回の同期で、保存済みのサインイン用トークンが YAMAP に拒否されました。有効期限が切れています。下に新しいものを貼り付けてください。',
  'A token stops working when YAMAP signs that browser out. Sign in at yamap.com again and copy the yamap_token cookie as described below.':
    'そのブラウザが YAMAP からサインアウトされると、トークンは使えなくなります。yamap.com にもう一度サインインし、下の説明のとおり yamap_token の Cookie をコピーしてください。',
  'A profile address such as https://yamap.com/users/1234567, or just the number.':
    'https://yamap.com/users/1234567 のようなプロフィールのアドレスか、数字だけを入力してください。',
  'That does not look like a yamap_token value: one run of letters and digits, no spaces.':
    'yamap_token の値には見えません。空白を含まない、ひと続きの英数字のはずです。',
  'no YAMAP user id yet': 'YAMAP のユーザー ID がまだありません',
  'Strava, Garmin, YAMAP, GPX files, a sheet': 'Strava、Garmin、YAMAP、GPX ファイル、シート',
  YAMAP: 'YAMAP',
  'Empty: everything new. A day here fetches only from then on, without changing the settings.':
    '空欄：新しいものすべて。日付を入れると、設定は変えずにその日以降だけを取得します。',
  'This time only: fetch Garmin activities from this day (YYYY-MM-DD)':
    '今回のみ：この日以降の Garmin アクティビティを取得（YYYY-MM-DD）',
  'This time only: fetch Garmin activities up to this day (YYYY-MM-DD)':
    '今回のみ：この日までの Garmin アクティビティを取得（YYYY-MM-DD）',
  'This time only: fetch Strava activities from this day (YYYY-MM-DD)':
    '今回のみ：この日以降の Strava アクティビティを取得（YYYY-MM-DD）',
  'This time only: fetch Strava activities up to this day (YYYY-MM-DD)':
    '今回のみ：この日までの Strava アクティビティを取得（YYYY-MM-DD）',
  'Each recording (the track) is one request; the next run carries on with the rest.':
    '記録（トラック）1件につきリクエスト1回です。残りは次回の実行で続きから取得します。',
  'Empty: everything.': '空欄：すべて。',
  'Fetch Garmin activities': 'Garminのアクティビティを取得',
  'Fetch Garmin activities set to Only Me?':
    '「自分のみ」に設定したGarminのアクティビティも取得しますか？',
  'First day to fetch from Garmin (YYYY-MM-DD)': 'Garminから取得する最初の日（YYYY-MM-DD）',
  'Garmin personal API key': 'Garmin パーソナルAPIキー',
  'Garmin recordings downloaded per run': '1回の実行でダウンロードするGarminの記録数',
  'Off: they are skipped. On: they are stored, and published only when "Only You" activities are published.':
    'オフ：取得しません。オン：保存し、「自分のみ」のアクティビティを公開する設定のときだけ公開します。',
  'Strava, GPX and Garmin activities can all be in the local store; the site shows one of them, plus the sheet. Changing this later deletes nothing.':
    'Strava・GPX・Garminのアクティビティはすべてローカルに保存しておけます。サイトにはそのうち1つとシートを表示します。あとで切り替えても何も削除されません。',
  'The folder, and which source the site shows': 'フォルダと、サイトに表示するソース',
  'The key, dates, Only Me': 'キー、期間、「自分のみ」',
  'Typed without being shown; stored in config/secrets.jsonc, readable only by you. Leave it empty to keep the one stored, or to add it later.':
    '入力内容は表示されません。config/secrets.jsonc に保存され、読めるのはあなただけです。保存済みのキーを使う場合や、あとで追加する場合は空欄のままにしてください。',
  'Your activities through the Garmin Connect Personal API, with a key you create yourself. Free; needs no approval.':
    '自分で作成したキーを使い、Garmin Connect パーソナルAPIからアクティビティを取得します。無料で、審査は不要です。',
  'Create a personal API key on Garmin Connect.':
    'Garmin Connect でパーソナルAPIキーを作成してください。',
  'On the Garmin Connect website: Settings, Personal API Key, Create Key. It is free, needs no approval and lasts up to a year. Garmin shows the key once. See docs/garmin.md.':
    'Garmin Connect のウェブサイトで「設定」→「パーソナルAPIキー」→「キーを作成」。無料で審査は不要、有効期間は最長1年です。キーは一度しか表示されません。docs/garmin.md を参照。',
  'Strava, Garmin, GPX files, a sheet': 'Strava、Garmin、GPXファイル、シート',
  'no Garmin personal API key yet': 'Garmin パーソナルAPIキーがまだありません',
  Garmin: 'Garmin',
  Finish: '終了',
  'Saved: {groups}': '保存しました：{groups}',
  'Change another group below if you want to. These then run once, in this order:':
    '必要なら、下でほかのグループも変更してください。その後、次のコマンドをこの順に一度だけ実行します。',
  'Nothing needs to run for these changes. Change another group, or finish.':
    'この変更で実行が必要なものはありません。ほかのグループを変更するか、終了してください。',
  Language: '言語',
  'The setup command did not answer: {problem}':
    'セットアップコマンドから応答がありません: {problem}',
  'Asking the setup command…': 'セットアップコマンドに問い合わせています…',
  'Quick setup': 'かんたんセットアップ',
  'Full setup': '詳細セットアップ',
  'Change settings': '設定を変更',
  Run: '実行',
  'The config files are saved. These commands do the rest, one after another.':
    '設定ファイルを保存しました。残りは以下のコマンドが順に行います。',
  Review: '確認',
  'What the commands could not settle on their own is written to these files.':
    'コマンドだけでは決められなかった点が、これらのファイルに書き出されています。',
  'Set up your map': '地図をセットアップ',
  'This page asks what it needs, shows every change before writing it, and runs the first sync and build. It talks only to the setup command running on this computer.':
    'このページは必要なことを質問し、書き込む前にすべての変更を表示して、最初の同期とビルドを実行します。通信する相手は、このコンピューターで動いているセットアップコマンドだけです。',
  'Strava application details are stored.': 'Stravaアプリケーションの情報は保存済みです。',
  'No Strava application details yet.': 'Stravaアプリケーションの情報はまだありません。',
  'Signed in to Strava.': 'Stravaにサインイン済みです。',
  'Not signed in to Strava yet.': 'Stravaにはまだサインインしていません。',
  'Privacy zones: {count}.': 'プライバシーゾーン: {count}件。',
  'No privacy zone is set.': 'プライバシーゾーンは設定されていません。',
  'The site data has been built.': 'サイトのデータはビルド済みです。',
  'The site data has not been built yet.': 'サイトのデータはまだビルドされていません。',
  'Try with demo data': 'デモデータで試す',
  'A made-up history in its own folder, to see the site before connecting anything. Your own data is not touched.':
    '専用フォルダーに架空の履歴を作り、何も接続せずにサイトを確認できます。あなた自身のデータには触れません。',
  'About nine questions with the recommended defaults, then the first sync and build.':
    'おすすめの初期設定で9問ほど答えると、最初の同期とビルドまで進みます。',
  'Every setting, group by group.': 'すべての設定をグループごとに。',
  Start: '始める',
  'Not available in this version.': 'このバージョンでは利用できません。',
  'One group at a time, starting from what is set now. A diff is shown before saving.':
    '今の設定をもとに、1グループずつ変更します。保存の前に差分を表示します。',
  'Before the Strava questions': 'Stravaの質問の前に',
  'Open strava.com/settings/api and create an application.':
    'strava.com/settings/api を開いてアプリケーションを作成します。',
  'Set its Authorization Callback Domain to "localhost".':
    'Authorization Callback Domainを"localhost"にします。',
  'Ask Strava to raise it to "up to 10 athletes"; without that the API answers 403.':
    'Stravaに「10人まで」への引き上げを申請します。これがないとAPIは403を返します。',
  'Reading activities through the API needs a Strava subscription.':
    'APIでアクティビティを読むにはStravaのサブスクリプションが必要です。',
  'The sign-in itself happens later, on the run screen.':
    'サインインそのものは、あとの実行画面で行います。',
  'What will change': '変更される内容',
  'No config file needs to change.': '変更が必要な設定ファイルはありません。',
  'new file': '新しいファイル',
  'To bring things up to date': '最新の状態にするには',
  'Then these run': '続けて実行される内容',
  'Left out: {why}.': '実行しません: {why}。',
  Groups: 'グループ',
  '{count} answers need another look before saving.':
    '保存の前に見直しが必要な回答が{count}件あります。',
  Back: '戻る',
  'Save these changes': 'この変更を保存',
  Continue: '続ける',
  Next: '次へ',
  'Setup is complete': 'セットアップが完了しました',
  'Remove the demo data later': 'あとでデモデータを削除する',
  'See the site': 'サイトを見る',
  'Each week, or whenever you want the site up to date': '毎週、またはサイトを最新にしたいとき',
  'Change a setting later': 'あとで設定を変更する',
  'The setup command has stopped. You can close this tab.':
    'セットアップコマンドは終了しました。このタブは閉じてかまいません。',
  'Finish and stop the setup command': '完了してセットアップコマンドを終了',
  'Stored. Leave empty to keep it.': '保存済み。空欄のままなら変更しません。',
  'Home location to hide': '隠す自宅の位置',
  'Click the map where your home is. Every published track loses the part near that point. Skip it and tracks show where they start.':
    '地図上で自宅の場所をクリックしてください。公開されるすべてのトラックから、その周辺が切り取られます。設定しない場合、トラックの出発地点がそのまま見えます。',
  'Loading the map…': '地図を読み込んでいます…',
  'No privacy zones yet.': 'プライバシーゾーンはまだありません。',
  Remove: '削除',
  'Add a zone': 'ゾーンを追加',
  'Label, for example home': 'ラベル (例: home)',
  'Add this zone': 'このゾーンを追加',
  'A zone has that label already.': 'そのラベルのゾーンはすでにあります。',
  Radius: '半径',
  'Tracks are cut within about {distance} of the point you clicked. The centre is moved at random before it is used, so the cut does not point at your door.':
    'クリックした地点からおよそ{distance}以内のトラックが切り取られます。中心は使う前にランダムにずらされるので、切り口から自宅の位置は特定できません。',
  'No place chosen yet. Zoom in and click the map.':
    '場所はまだ選ばれていません。拡大して地図をクリックしてください。',
  'Clear the place': '場所をクリア',
  Waiting: '待機中',
  Running: '実行中',
  Done: '完了',
  Failed: '失敗',
  Skipped: 'スキップ',
  'Uses the network.': 'ネットワークを使います。',
  'Opens a browser tab.': 'ブラウザのタブを開きます。',
  'Can be slow: {how}.': '時間がかかることがあります: {how}。',
  'Signed in. Granted: {scope}.': 'サインイン済み。許可された範囲: {scope}。',
  'Open the Strava sign-in page': 'Stravaのサインインページを開く',
  'A step failed.': '失敗したステップがあります。',
  'Read its output below, fix what it says, then continue from that step.':
    '下の出力を読んで原因を直し、そのステップから再開してください。',
  'Continue from the failed step': '失敗したステップから再開',
  'Run these now': '今すぐ実行',
  'Skip running': '実行せずに進む',
  'One command runs at a time. Close other `jam` commands while this runs.':
    'コマンドは1つずつ実行されます。実行中はほかの `jam` コマンドを終了しておいてください。',
  'Output ({count} lines)': '出力 ({count}行)',
  'This file could not be read.': 'このファイルを読み込めませんでした。',
  'No review files yet. They appear after matching and route grouping have run.':
    '確認用のファイルはまだありません。照合とルートのグループ化を実行すると作られます。',
  'I have read this': '読みました',
  Open: '開く',
  'To look at what the privacy zones cut, run `pnpm jam zones --preview` and open data/privacy-preview.geojson in a map tool. It stays on this machine.':
    'プライバシーゾーンで切り取られる範囲を確認するには、`pnpm jam zones --preview` を実行し、data/privacy-preview.geojson を地図ツールで開いてください。ファイルはこのコンピューターの外には出ません。',
  'Or type the place: latitude, longitude': 'または場所を入力：緯度, 経度',
  // Stop, merges and the privacy preview
  '{seconds} s': '{seconds}秒',
  'Stop this step': 'この手順を止める',
  'A stopped step leaves what it had finished (downloaded sources, synced pages); running it again carries on.':
    '止めた手順は、済んだ分（ダウンロード済みのソース、同期済みのページ）を残します。もう一度実行すると続きから進みます。',
  'This step cannot be stopped; it ends by itself.':
    'この手順は止められません。自動的に終わります。',
  'Nothing is running.': '実行中の手順はありません。',
  'Routes that look like one route': '同じルートに見えるルート',
  'Merging writes the pair to config/routes.jsonc. It takes effect when routes are grouped and the site is built again.':
    '統合すると、その組が config/routes.jsonc に書き込まれます。ルートをまとめ直し、サイトをビルドし直すと反映されます。',
  Merge: '統合',
  Merged: '統合済み',
  'Run `pnpm jam routes` and `pnpm jam build` again for the merged routes to show.':
    '統合したルートを反映するには、`pnpm jam routes` と `pnpm jam build` をもう一度実行してください。',
  'What the privacy zones cut': 'プライバシーゾーンで切り取られる範囲',
  'Your tracks as they would be published: where a line stops short, a zone begins. The file stays on this machine.':
    '公開される形のトラックです。線が途切れている所からゾーンが始まります。ファイルはこのパソコンの外に出ません。',
  'No preview could be made. Sync and match activities first.':
    'プレビューを作れませんでした。先にアクティビティを同期し、照合してください。',
  'Show the cut tracks on a map': '切り取り後のトラックを地図で見る',
  'Working…': '処理中…',
  'No such candidate.': 'その候補はありません。',
  // The first screen and the trail
  'Strava application': 'Stravaアプリケーション',
  'Details stored': '情報を保存済み',
  'Not yet': '未設定',
  'Strava sign-in': 'Stravaへのサインイン',
  'Signed in': 'サインイン済み',
  '{count} set': '{count}件を設定済み',
  'None: tracks show where they start': 'なし：トラックの出発地点がそのまま見えます',
  'Site data': 'サイトのデータ',
  Built: 'ビルド済み',
  'Not built yet': '未ビルド',
  'Where the setup stands': 'セットアップの状況',
  'Where you are in the setup': 'セットアップの進み具合',
  Answer: '回答',
  'Your map is set up': 'マップは設定済みです',
  'Change one group of settings, or run a setup again. Every change is shown before it is written, and this page talks only to the setup command on this computer.':
    '設定を1グループずつ変更するか、セットアップをやり直せます。変更は書き込む前にすべて表示され、このページはこのパソコンで動いているセットアップコマンドとだけ通信します。',
  'Home to hide': '隠す自宅の位置',
  'Start quick setup': 'かんたんセットアップを始める',
  'A made-up history in a folder of its own, to see the site before connecting anything. Your own activities, settings and site stay as they are.':
    '何も接続せずにサイトを試せる、専用フォルダーに作る架空の履歴です。ご自身のアクティビティ・設定・サイトはそのまま残ります。',
  'Make the demo': 'デモを作る',
  'Start full setup': '詳細セットアップを始める',
  'Title, description, address': 'タイトル・説明・アドレス',
  'Base map, dark map, terrain': 'ベースマップ・ダークマップ・地形',
  'The saved views in the filter panel': 'フィルターパネルの保存済みビュー',
  'Names, links, time of day, pace': '名前・リンク・時刻・ペース',
  'Detail and size of the files': 'ファイルの細かさとサイズ',
  'Strava, a sheet, or both': 'Strava、シート、または両方',
  'Dates, activity types, sign-in': '期間・アクティビティの種類・サインイン',
  'The file and its time zone': 'ファイルとタイムゾーン',
  'Zones, and how their edges are blurred': 'ゾーンと、その境界のぼかし方',
  'Which reference lists to download': 'ダウンロードするリスト',
  'How close counts as reached': 'どこまで近づけば到達とするか',
  'When two tracks are one route': '2つのトラックを同じルートとみなす条件',
  'Names, merges and splits': '名前・統合・分割',
  'To publish the site, see docs/deploy.md, then run pnpm jam deploy.':
    'サイトを公開するには docs/deploy.md を読み、pnpm jam deploy を実行します。',
  'Lower-case letters, digits and hyphens only, at most 58 characters.':
    '小文字の英数字とハイフンのみ、58文字までです。',
  'Used for links and the share image. Leave it empty until the site has an address; on Cloudflare Pages, an address of your own keeps the pages.dev copies out of search engines.':
    'リンクと共有画像に使われます。サイトのアドレスが決まるまでは空のままにしてください。Cloudflare Pagesでは、独自のアドレスを設定するとpages.dev側のコピーは検索エンジンに載らなくなります。',
  'Where to publish the site': 'サイトの公開先',
  'All three are free for a site like this. Cloudflare Pages and Netlify take an upload and need an API token in config/secrets.jsonc. GitHub Pages is a branch of a repository, pushed with the git sign-in this computer already has; on a free account that repository is public.':
    'このようなサイトなら3つとも無料で使えます。Cloudflare PagesとNetlifyはアップロード方式で、config/secrets.jsonc にAPIトークンが必要です。GitHub Pagesはリポジトリのブランチで、このパソコンのgitのサインインでプッシュします。無料アカウントではそのリポジトリは公開になります。',
  'Cloudflare Pages': 'Cloudflare Pages',
  Netlify: 'Netlify',
  'GitHub Pages': 'GitHub Pages',
  'Project name': 'プロジェクト名',
  'The project `pnpm jam deploy` uploads to; the site is then at <name>.pages.dev (Cloudflare) or <name>.netlify.app (Netlify). Lower-case letters, digits and hyphens. Leave it empty to keep deploying off.':
    '`pnpm jam deploy` のアップロード先となるプロジェクトです。サイトは <name>.pages.dev（Cloudflare）または <name>.netlify.app（Netlify）で公開されます。小文字の英数字とハイフンが使えます。空のままにするとデプロイは無効です。',
  'GitHub repository': 'GitHubリポジトリ',
  "As owner/name. The site is pushed to its gh-pages branch, which holds the site and nothing else, and is served at <owner>.github.io/<name>. It can be this project's own repository. Leave it empty to keep deploying off.":
    'owner/name の形式で指定します。サイトはそのリポジトリのgh-pagesブランチ（サイト専用）にプッシュされ、<owner>.github.io/<name> で公開されます。このプロジェクト自身のリポジトリでもかまいません。空のままにするとデプロイは無効です。',
  'Give it as owner/name, for example mladimatija/japan-activity-map.':
    'owner/name の形式で指定してください（例：mladimatija/japan-activity-map）。',
  'Where the site is published': 'サイトの公開先について',
  'A token typed here is stored in config/secrets.jsonc on this computer and goes nowhere else; it can be left empty and added later. GitHub Pages needs none. docs/deploy.md says where to find each.':
    'ここで入力したトークンはこのパソコンの config/secrets.jsonc に保存され、ほかには送られません。空のままにして後から追加することもできます。GitHub Pagesでは不要です。取得方法は docs/deploy.md にあります。',
  'Cloudflare API token': 'CloudflareのAPIトークン',
  'Typed without being shown; stored in config/secrets.jsonc, readable only by you. Make one in the Cloudflare dashboard under My Profile > API Tokens, with the permission Account > Cloudflare Pages > Edit. Leave it empty to keep what is stored or to add it later; a single - removes it.':
    '入力内容は表示されません。config/secrets.jsonc に保存され、あなただけが読めます。Cloudflareのダッシュボードの My Profile > API Tokens で、Account > Cloudflare Pages > Edit の権限を付けて作成します。保存済みのものを使う場合や後から追加する場合は空のままにしてください。「-」だけを入力すると削除されます。',
  'Cloudflare account id': 'CloudflareのアカウントID',
  '32 characters (0-9, a-f), shown in the dashboard under Workers & Pages. Stored in config/secrets.jsonc. Leave it empty to keep what is stored or to add it later; a single - removes it.':
    '32文字（0-9、a-f）で、ダッシュボードの Workers & Pages に表示されます。config/secrets.jsonc に保存されます。保存済みのものを使う場合や後から追加する場合は空のままにしてください。「-」だけを入力すると削除されます。',
  'An account id is 32 characters, 0-9 and a-f.': 'アカウントIDは0-9とa-fの32文字です。',
  'Netlify access token': 'Netlifyのアクセストークン',
  'Typed without being shown; stored in config/secrets.jsonc, readable only by you. Make one in Netlify under User settings > Applications > Personal access tokens. Leave it empty to keep what is stored or to add it later; a single - removes it.':
    '入力内容は表示されません。config/secrets.jsonc に保存され、あなただけが読めます。Netlifyの User settings > Applications > Personal access tokens で作成します。保存済みのものを使う場合や後から追加する場合は空のままにしてください。「-」だけを入力すると削除されます。',
};
