/**
 * Checks the reading of Wikipedia list articles (`jam lists fetch wikipedia`), the building of
 * place lists from them, and the naming of 五街道 stage boundaries, on small made-up pages and
 * positions: no network, and lists/ is not written.
 *
 *   node packages/cli/dev/check-lists.ts      (or: pnpm check:lists)
 */
import { emptyReview } from '../src/lists/review.ts';
import { loadOverrides } from '../src/lists/overrides.ts';
import { PrefectureIndex } from '../src/lists/prefecture-index.ts';
import { buildWikipediaSet, type PointContext } from '../src/lists/points.ts';
import { LIST_DEFINITIONS } from '../src/lists/definitions.ts';
import { placeListDocument, WIKIPEDIA_PLACE_LISTS } from '../src/lists/fetch.ts';
import { Registry } from '../src/lists/registry.ts';
import {
  type NamedPlace,
  articleAboutTown,
  englishFromPlaces,
  mergeRepeats,
  namesPostTown,
} from '../src/lists/routes.ts';
import { toGsiPlaces } from '../src/lists/gsi.ts';
import { loadGsiList, loadPrefectureShapes } from '../src/lists/sources.ts';
import { htmlTables, listEntries } from '../src/lists/wiki-html.ts';

let failed = false;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed = true;
};

const link = (title: string, text = title) =>
  `<a href="/wiki/${encodeURIComponent(title)}" title="${title}">${text}</a>`;
const names = (reading: { entries: { order: number; text: string }[] }) =>
  reading.entries.map((entry) => `${entry.order} ${entry.text}`).join(', ');

// 1. Numbered blocks side by side (関東百名山): No | 山名 | 標高 | 所在地, twice in a row.
const sideBySide = `<table class="wikitable"><tbody>
<tr><th>No</th><th>山名</th><th>標高 (m)</th><th>所在地</th><th>No</th><th>山名</th><th>標高 (m)</th><th>所在地</th></tr>
<tr><td>1</td><td>${link('那須岳')}</td><td>1,917</td><td>${link('栃木県')}</td><td>3</td><td>${link('筑波山')}</td><td>877</td><td>${link('茨城県')}</td></tr>
<tr><td>2</td><td>${link('男体山 (栃木県)', '男体山')}</td><td>2,486</td><td>${link('栃木県')}</td><td>4</td><td>幕山</td><td>626</td><td>${link('神奈川県')}</td></tr>
</tbody></table>`;
let reading = listEntries(sideBySide, { count: 4, nameHeader: /山名/ });
check(
  'numbered blocks side by side: each number with the name beside it, not the prefecture',
  reading.layout === 'numbered table' &&
    names(reading) === '1 那須岳, 2 男体山, 3 筑波山, 4 幕山' &&
    reading.entries[1]?.title === '男体山 (栃木県)' &&
    reading.entries[3]?.title === undefined &&
    reading.missing.length === 0,
  names(reading),
);

// 2. A prefecture cell spanning rows, sort keys hidden in the number, a picture column first,
//    footnote marks, a nested table, and a number used twice.
const spanned = `<table><tr><th>番号</th><th>画像</th><th>名称</th><th>所在地</th></tr>
<tr><td><span style="display:none">001</span>1</td><td><a href="/wiki/File:A.jpg">画像</a></td><td>${link('羽衣の滝')}<sup>[1]</sup></td><td rowspan="2">${link('北海道')}</td></tr>
<tr><td>2</td><td>画像募集中</td><td>${link('インクラの滝')}</td></tr>
<tr><td>3</td><td></td><td>${link('華厳滝')}<table><tr><td>9</td><td>${link('中禅寺湖')}</td></tr></table></td><td>${link('栃木県')}</td></tr>
<tr><td>3</td><td></td><td>${link('袋田の滝')}</td><td>${link('茨城県')}</td></tr>
</table>`;
reading = listEntries(spanned, { count: 5, nameHeader: /名称/ });
check(
  'a spanning prefecture cell, hidden sort keys and a picture column do not shift the names',
  names(reading) === '1 羽衣の滝, 2 インクラの滝, 3 華厳滝',
  names(reading),
);
check(
  'a number used twice keeps the first row and reports the other; missing numbers are listed',
  reading.clashes.length === 1 &&
    reading.clashes[0]?.includes('袋田の滝') === true &&
    reading.missing.join() === '4,5',
  `${reading.clashes.join(' | ')} / ${reading.missing.join()}`,
);
check(
  'a table inside a cell is a table of its own',
  htmlTables(spanned).length === 2 &&
    !htmlTables(spanned).some((grid) =>
      grid.some((row) =>
        row.some((cell) => cell.text.includes('華厳滝') && cell.text.includes('9')),
      ),
    ),
);

// 3. No header to go by: the first cell after the number that holds a name.
const bare = `<table><tr><td>第1番</td><td>599</td><td>${link('高尾山')}</td></tr><tr><td>2.</td><td>${link('大楠山')}</td><td>241</td></tr></table>`;
reading = listEntries(bare, { count: 2, nameHeader: /山名/ });
check(
  'without a header, the first name after the number',
  names(reading) === '1 高尾山, 2 大楠山',
  names(reading),
);

// 4. A numbered list, and items that carry their own number.
const ordered = `<ol start="8"><li>${link('秋保大滝')}（${link('宮城県')}）</li><li>三階の滝<ul><li>${link('蔵王町')}</li></ul></li></ol>`;
reading = listEntries(ordered, { first: 8, count: 2, nameHeader: /滝/ });
check(
  'a numbered list starts where it says, and takes the item, not its sub-list',
  reading.layout === 'numbered list' &&
    names(reading) === '8 秋保大滝, 9 三階の滝' &&
    reading.entries[1]?.title === undefined,
  names(reading),
);
reading = listEntries(
  `<ul><li>1. ${link('羽衣の滝')}</li><li>2. ${link('インクラの滝')}</li></ul>`,
  {
    count: 2,
    nameHeader: /滝/,
  },
);
check(
  'items that carry their own number',
  names(reading) === '1 羽衣の滝, 2 インクラの滝',
  names(reading),
);

// 5. No numbers at all (花の百名山): the column headed 山名, in page order.
const unnumbered = `<table><tr><th>山名</th><th>読み</th><th>都道府県</th><th>花</th></tr>
<tr><td>${link('高尾山')}</td><td>たかおさん</td><td>${link('東京都')}</td><td>${link('フクジュソウ')}</td></tr>
<tr><td>${link('大楠山')}</td><td>おおぐすやま</td><td>${link('神奈川県')}</td><td>${link('ハマダイコン')}</td></tr></table>`;
reading = listEntries(unnumbered, { count: 2, nameHeader: /山名/ });
check(
  'an unnumbered table is numbered in page order, from the column headed for names',
  reading.layout === 'table in page order' && names(reading) === '1 高尾山, 2 大楠山',
  names(reading),
);

// 6. The document the fetch saves: facts joined on, and what could not be read written down.
const list = WIKIPEDIA_PLACE_LISTS.find((entry) => entry.key === 'kanto-hyakumeizan');
if (!list) throw new Error('kanto-hyakumeizan is not among the place lists');
// Made-up facts: positions near enough for the check, not data.
const facts: Record<string, { qid: string; en?: string; lat: number; lon: number }> = {
  那須岳: { qid: 'Q1', en: 'Mount Nasu', lat: 37.1247, lon: 139.9631 },
  '男体山 (栃木県)': { qid: 'Q2', en: 'Mount Nantai', lat: 36.765, lon: 139.4908 },
  筑波山: { qid: 'Q3', lat: 36.2261, lon: 140.1 },
};
const document = placeListDocument(
  { ...list, count: 5 },
  { revid: 1, text: sideBySide },
  (title) => {
    const fact = facts[title];
    return fact
      ? {
          article: title,
          qid: fact.qid,
          ...(fact.en ? { en: fact.en } : {}),
          wikidata: { lat: fact.lat, lon: fact.lon },
        }
      : { article: title };
  },
  '2026-11-26',
);
check(
  'the saved document has every entry, and says what is missing and what has no article',
  document.items.length === 4 &&
    document.items[3]?.article === undefined &&
    (document.problems ?? []).some((problem) => problem.includes('#5')) &&
    (document.problems ?? []).some((problem) => problem.includes('#4 幕山')),
  JSON.stringify(document.problems),
);

// 7. Building: a mountain GSI lists becomes its GSI summit (shared with the other lists it is on),
//    one GSI does not list keeps the article's position, one without an article is left unplaced.
const review = emptyReview();
const context: PointContext = {
  gsi: toGsiPlaces(loadGsiList()),
  index: new PrefectureIndex(loadPrefectureShapes('s0010')),
  registry: new Registry(),
  review,
  overrides: loadOverrides(),
  usedNoteIds: new Set(),
  usedCoordinateIds: new Set(),
};
const definition = LIST_DEFINITIONS.find((entry) => entry.id === 'kanto-hyakumeizan');
if (!definition) throw new Error('kanto-hyakumeizan is not defined');
const items = buildWikipediaSet(context, definition, 'kanto-hyakumeizan', 'peak', {
  ...document,
  items: [
    ...document.items,
    // A hill GSI's list does not have, with no English label: made-up position on land.
    {
      order: 5,
      ja: '弘法山',
      article: '弘法山',
      qid: 'Q5',
      wikipedia: { lat: 35.371, lon: 139.245 },
    },
  ],
});
const item = (order: number) => items.find((entry) => entry.properties.order === order)?.properties;
const tsukuba = context.gsi.find((place) => place.fullName === '筑波山');
check(
  'a mountain GSI lists is placed on its GSI summit, 600 m from the article position here',
  item(3)?.coordinateSource === 'gsi' &&
    tsukuba !== undefined &&
    item(3)?.placeId === context.registry.forGsi(tsukuba).id,
  JSON.stringify(item(3)),
);
check(
  'its English name is the Wikidata label where there is one',
  item(1)?.name.en === 'Mount Nasu' && item(2)?.name.ja === '男体山',
  JSON.stringify([item(1)?.name, item(2)?.name]),
);
check(
  'a hill GSI does not list keeps the article position, in its prefecture',
  item(5)?.coordinateSource === 'wikipedia' && item(5)?.prefectures.join() === '14',
  JSON.stringify(item(5)),
);
check(
  'no English label and no reading: the Japanese is kept and the review says so',
  item(5)?.name.en === '弘法山' && review.noEnglish.some((line) => line.includes('#5 弘法山')),
  review.noEnglish.join(' | '),
);
check(
  'an entry with no article is in the list without a place, and the review says so',
  item(4)?.placeId === null &&
    review.coordinates.some((line) => line.includes('#4 幕山') && line.includes('no article')),
  JSON.stringify(item(4)),
);
check(
  "the fetch's problems reach the review",
  review.numbering.some((line) => line.includes('kanto-hyakumeizan') && line.includes('#5')),
  review.numbering.join(' | '),
);
const fall = buildWikipediaSet(
  context,
  LIST_DEFINITIONS.find((entry) => entry.id === 'taki-100') ?? definition,
  'taki-100',
  'waterfall',
  {
    ...document,
    problems: [],
    items: [
      {
        order: 1,
        ja: '華厳滝',
        article: '華厳滝',
        qid: 'Q9',
        en: 'Kegon Falls',
        wikipedia: { lat: 36.7381, lon: 139.5019 },
      },
    ],
  },
)[0]?.properties;
check(
  'a waterfall is a place of its own kind',
  fall?.placeId === 'waterfall-q9' &&
    context.registry.places.get('waterfall-q9')?.kind === 'waterfall' &&
    fall.name.en === 'Kegon Falls',
  JSON.stringify(fall),
);

// 8. 五街道 post towns: a town an article lists twice in a row is one stage boundary, and a town
//    with no English label is named from an OpenStreetMap place of its name near it.
const towns = mergeRepeats([
  { seq: 51, number: 52, ja: '草津宿', en: 'Kusatsu-juku' },
  { seq: 52, number: 53, ja: '大津宿', article: '大津宿', en: 'Ōtsu-juku' },
  // The 京街道 table starts again from 大津宿, without a link.
  { seq: 53, number: 53, ja: '大津宿' },
  { seq: 54, number: 54, ja: '伏見宿' },
]);
check(
  'a post town listed again at the head of the next table is one town, with the first row’s facts',
  towns.map((town) => town.ja).join() === '草津宿,大津宿,伏見宿' &&
    towns[1]?.en === 'Ōtsu-juku' &&
    towns[1]?.seq === 52,
  JSON.stringify(towns),
);
check(
  'the same name under another number is another town (奥州街道 has two 中田宿)',
  mergeRepeats([
    { number: 8, ja: '中田宿' },
    { number: 68, ja: '中田宿' },
  ]).length === 2,
);
const kokuryo: [number, number] = [139.5586, 35.6503];
const osmPlaces = new Map<string, NamedPlace[]>([
  [
    '国領',
    [
      // A station 25 km away, and one by the town.
      { point: [139.3, 35.7], tags: { name: '国領', 'name:en': 'Somewhere' } },
      {
        point: [139.5587, 35.6502],
        tags: { name: '国領', 'name:en': 'Kokuryo', 'name:ja_rm': 'Kokuryō' },
      },
    ],
  ],
  [
    '白沢宿',
    [{ point: [139.5586, 35.6503], tags: { name: '白沢宿', 'name:en': 'Shirasawashuku' } }],
  ],
  ['白沢', [{ point: [139.5586, 35.6503], tags: { name: '白沢', 'name:en': 'Shirasawa' } }]],
  ['野木', [{ point: [139.5586, 35.6503], tags: { name: '野木', 'name:ja-Hira': 'のぎ' } }]],
  ['新田', [{ point: [139.0, 36.0], tags: { name: '新田', 'name:en': 'Shinden' } }]],
]);
check(
  'a town with no English label takes the romanised name of the nearest place of its name',
  englishFromPlaces('国領宿', kokuryo, osmPlaces) === 'Kokuryō',
  englishFromPlaces('国領宿', kokuryo, osmPlaces),
);
check(
  'a place named like the town itself comes first, its 宿 hyphenated',
  englishFromPlaces('白沢宿', kokuryo, osmPlaces) === 'Shirasawa-shuku',
  englishFromPlaces('白沢宿', kokuryo, osmPlaces),
);
check(
  'a kana reading alone is romanised',
  englishFromPlaces('野木宿', kokuryo, osmPlaces) === 'Nogi',
  englishFromPlaces('野木宿', kokuryo, osmPlaces),
);
check(
  'a place of the same name far away is another place: no name',
  englishFromPlaces('新田宿', kokuryo, osmPlaces) === undefined,
  englishFromPlaces('新田宿', kokuryo, osmPlaces),
);

// 9. A post town's article is about the town only when it is on a post town or on the place the
//    town is named after; 甲州街道 links many towns to the village they were in, whose name,
//    point and English label are the village's.
check(
  'towns sharing an article on a post town take its name (下・上高井戸宿 are 高井戸宿)',
  namesPostTown('高井戸宿') &&
    namesPostTown('府中宿 (甲州街道)') &&
    !namesPostTown('富浜村') &&
    !namesPostTown('大月町 (山梨県)'),
);
const about = (ja: string, article?: string) => articleAboutTown({ ja, article });
check(
  'an article on the town, or on the place it is named after, is about the town',
  about('下高井戸宿', '高井戸宿') &&
    about('吉野宿', '吉野町 (神奈川県)') &&
    about('大月宿', '大月町 (山梨県)') &&
    about('興津宿', '興津'),
);
check(
  'an article on the village a town was in, or on another place, is not about the town',
  !about('駒橋宿', '大月町 (山梨県)') &&
    !about('下鳥沢宿', '富浜村') &&
    !about('石和宿', '石和温泉') &&
    !about('甲府柳町宿'),
);

console.log(failed ? 'Some checks failed.' : 'All checks passed.');
process.exit(failed ? 1 : 0);
