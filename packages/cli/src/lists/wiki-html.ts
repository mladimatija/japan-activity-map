// Reading lists out of a rendered Wikipedia article: its tables and numbered lists.

const NOT_ARTICLE =
  /^(ファイル|File|画像|Image|Category|カテゴリ|Template|テンプレート|Help|Wikipedia):/i;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
export const decodeHtml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) =>
    code.startsWith('#x') || code.startsWith('#X')
      ? String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      : code.startsWith('#')
        ? String.fromCodePoint(Number(code.slice(1)))
        : (ENTITIES[code.toLowerCase()] ?? whole),
  );
/** A fragment's visible text, without the hidden sort keys some tables put in cells. */
export const textOf = (html: string) =>
  decodeHtml(
    html
      .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>]+>/g, ''),
  ).trim();

export interface Cell {
  /** Visible text, sort keys left in (the number cell may be padded with a hidden 0). */
  raw: string;
  links: { title: string; text: string }[];
}

/** The article links in a fragment (not files, categories or links that leave the wiki). */
const linksOf = (body: string): Cell['links'] =>
  [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap((link) => {
    const attrs = link[1] ?? '';
    const href = decodeHtml(/\bhref="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const titled = decodeHtml(/\btitle="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const fromHref = /^\/wiki\/([^?#]+)/.exec(href)?.[1];
    const title = (fromHref ? decodeURIComponent(fromHref).replace(/_/g, ' ') : titled).replace(
      /\s*\((存在しないページ|page does not exist)\)$/,
      '',
    );
    if (!title || NOT_ARTICLE.test(title) || !/^\/wiki\/|[?&]title=/.test(href)) return [];
    return [{ title, text: textOf(link[2] ?? '') || title }];
  });

/** Every table row of a rendered page, as cells with their article links. */
export const htmlRows = (html: string): Cell[][] => {
  const rows: Cell[][] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(row[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (cell): Cell => {
        const body = cell[1] ?? '';
        const links = linksOf(body);
        return { raw: decodeHtml(body.replace(/<[^>]+>/g, '')).trim(), links };
      },
    );
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
};

// --- Lists of places: numbered or not, in tables or in lists ------------------------------------

/** One member of a list as the article gives it: its number, its name, and its article if linked. */
export interface ListEntry {
  order: number;
  text: string;
  /** The linked article; absent when the name is plain text (then it has no coordinates). */
  title?: string;
}

interface GridCell extends Cell {
  header: boolean;
  /** Visible text without hidden sort keys and footnote marks. */
  text: string;
  /** False for the copies a rowspan or colspan leaves in the cells it covers. */
  own: boolean;
}

/**
 * Every table of a rendered page as a grid: each row has a cell for every column, with merged
 * cells (rowspan, colspan) repeated into the places they cover, so a column means the same thing
 * in every row. A table inside a cell is a table of its own, and not part of that cell's text.
 */
export const htmlTables = (html: string): GridCell[][][] => {
  interface Open {
    rows: { attrs: string; body: string; header: boolean }[][];
    cell?: { attrs: string; from: number; header: boolean; cut: [number, number][] };
    start: number;
  }
  const stack: Open[] = [];
  const done: Open['rows'][] = [];
  for (const tag of html.matchAll(/<(\/?)(table|tr|td|th)\b([^>]*)>/gi)) {
    const closing = tag[1] === '/';
    const name = (tag[2] ?? '').toLowerCase();
    const at = tag.index;
    const after = at + tag[0].length;
    const table = stack.at(-1);
    if (name === 'table') {
      if (!closing) stack.push({ rows: [], start: at });
      else if (table) {
        stack.pop();
        done.push(table.rows);
        // The cell this table sat in does not count its text.
        stack.at(-1)?.cell?.cut.push([table.start, after]);
      }
      continue;
    }
    if (!table) continue;
    const close = () => {
      const { cell } = table;
      if (!cell) return;
      let body = '';
      let from = cell.from;
      for (const [cutFrom, cutTo] of cell.cut) {
        body += html.slice(from, cutFrom);
        from = cutTo;
      }
      body += html.slice(from, at);
      (table.rows.at(-1) ?? table.rows[table.rows.push([]) - 1])?.push({
        attrs: cell.attrs,
        body,
        header: cell.header,
      });
      table.cell = undefined;
    };
    if (name === 'tr') {
      close();
      if (!closing) table.rows.push([]);
    } else if (closing) close();
    else {
      close();
      if (table.rows.length === 0) table.rows.push([]);
      table.cell = { attrs: tag[3] ?? '', from: after, header: name === 'th', cut: [] };
    }
  }
  const span = (attrs: string, which: string) =>
    Math.max(
      1,
      Math.min(300, Number(new RegExp(`\\b${which}="?(\\d+)`, 'i').exec(attrs)?.[1] ?? 1)),
    );
  return done
    .map((rows) => {
      const grid: GridCell[][] = [];
      rows.forEach((row, r) => {
        const line = (grid[r] ??= []);
        let c = 0;
        for (const { attrs, body, header } of row) {
          while (line[c]) c++;
          const cell: GridCell = {
            raw: decodeHtml(body.replace(/<[^>]+>/g, '')).trim(),
            text: textOf(body)
              .replace(/\[[^\]]{1,8}\]/g, '')
              .replace(/\s+/g, ' ')
              .trim(),
            links: linksOf(body),
            header,
            own: true,
          };
          const [down, across] = [span(attrs, 'rowspan'), span(attrs, 'colspan')];
          for (let dr = 0; dr < down && r + dr < rows.length; dr++)
            for (let dc = 0; dc < across; dc++)
              (grid[r + dr] ??= [])[c + dc] = dr + dc === 0 ? cell : { ...cell, own: false };
          c += across;
        }
      });
      return grid.filter((row) => row.length > 0);
    })
    .filter((grid) => grid.length > 0);
};

const HAS_NAME = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** A cell that is only a list number: "12", "012", "第12番", "12." */
const numberOf = (cell: GridCell): number | undefined => {
  const match = /^第?0*(\d{1,3})[.．番]?$/.exec(cell.text.replace(/\s/g, ''));
  return match ? Number(match[1]) : undefined;
};

/** The name in a cell: its first article link, else its text when that reads as a name. */
const nameIn = (cell: GridCell | undefined): { text: string; title?: string } | undefined => {
  if (!cell) return undefined;
  const link = cell.links.find((candidate) => HAS_NAME.test(candidate.text));
  if (link) return { text: link.text, title: link.title };
  return HAS_NAME.test(cell.text) && !/画像/.test(cell.text) ? { text: cell.text } : undefined;
};

export interface ListReading {
  entries: ListEntry[];
  /** How the article lays the list out, for the record. */
  layout: 'numbered table' | 'numbered list' | 'table in page order';
  /** Numbers from `first` to `first + count - 1` with no entry. */
  missing: number[];
  /** Rows left out because another row already had their number. */
  clashes: string[];
}

/**
 * The members of a list in a rendered article, however it is laid out. Tried in this order, the
 * first that finds at least three fifths of the list wins:
 *
 * 1. tables with a number in each row (several numbered blocks side by side are fine): the name
 *    is in the column headed like `nameHeader`, or else the first cell after the number that
 *    holds a name;
 * 2. numbered lists (`<ol>`, or items starting "12. …"): each item's first link or its text;
 * 3. tables with a column headed like `nameHeader` and no numbers: numbered in page order.
 */
export const listEntries = (
  html: string,
  { first = 1, count, nameHeader }: { first?: number; count: number; nameHeader: RegExp },
): ListReading => {
  const last = first + count - 1;
  const enough = Math.ceil(count * 0.6);
  const tables = htmlTables(html);
  const nameColumns = (grid: GridCell[][]) => {
    const head = grid.find((row) => row.some((cell) => cell.header && nameHeader.test(cell.text)));
    return head
      ? head.flatMap((cell, c) => (cell.header && nameHeader.test(cell.text) ? [c] : []))
      : [];
  };
  const collect = (
    found: Map<number, ListEntry>,
    clashes: string[],
    order: number,
    name: { text: string; title?: string } | undefined,
  ) => {
    if (!name || order < first || order > last) return;
    const seen = found.get(order);
    if (!seen) found.set(order, { order, ...name });
    else if (seen.text !== name.text) clashes.push(`#${order} ${name.text} (kept ${seen.text})`);
  };
  const result = (
    found: Map<number, ListEntry>,
    clashes: string[],
    layout: ListReading['layout'],
  ): ListReading => ({
    entries: [...found.values()].sort((a, b) => a.order - b.order),
    layout,
    missing: Array.from({ length: count }, (_, i) => first + i).filter((n) => !found.has(n)),
    clashes,
  });

  // 1. Numbered tables.
  let found = new Map<number, ListEntry>();
  let clashes: string[] = [];
  for (const grid of tables) {
    const named = nameColumns(grid);
    // The columns that number the list: mostly numbers, no number twice, and nearly all of them
    // within the list's range (which a column of heights or years is not).
    const width = Math.max(...grid.map((row) => row.length));
    const numbering = Array.from({ length: width }, (_, c) => c).filter((c) => {
      const values = grid.flatMap((row) => {
        const cell = row[c];
        const value = cell?.own && !cell.header ? numberOf(cell) : undefined;
        return value === undefined ? [] : [value];
      });
      const inRange = values.filter((value) => value >= first && value <= last).length;
      return (
        values.length > 0 &&
        new Set(values).size >= values.length * 0.9 - 1 &&
        inRange >= values.length * 0.8
      );
    });
    for (const row of grid) {
      const numbers = numbering.filter((c) => {
        const cell = row[c];
        return cell?.own && !cell.header && numberOf(cell) !== undefined;
      });
      numbers.forEach((c, i) => {
        const until = numbers[i + 1] ?? row.length;
        const headed = named.find((column) => column > c && column < until);
        const name =
          headed !== undefined
            ? nameIn(row[headed])
            : row
                .slice(c + 1, until)
                .map((cell) => nameIn(cell))
                .find(Boolean);
        collect(found, clashes, numberOf(row[c] as GridCell) as number, name);
      });
    }
  }
  if (found.size >= enough) return result(found, clashes, 'numbered table');

  // 2. Numbered lists.
  found = new Map();
  clashes = [];
  const item = (body: string) => {
    const own = body.replace(/<(ol|ul)\b[\s\S]*$/i, '');
    const link = linksOf(own).find((candidate) => HAS_NAME.test(candidate.text));
    const text = textOf(own).replace(/\s+/g, ' ').trim();
    return { link, text };
  };
  for (const list of html.matchAll(/<ol\b([^>]*)>([\s\S]*?)<\/ol>/gi)) {
    let order = Number(/\bstart="?(\d+)/i.exec(list[1] ?? '')?.[1] ?? 1);
    for (const li of (list[2] ?? '').matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
      const value = /\bvalue="?(\d+)/i.exec(li[1] ?? '')?.[1];
      if (value) order = Number(value);
      const { link, text } = item(li[2] ?? '');
      collect(
        found,
        clashes,
        order,
        link ? { text: link.text, title: link.title } : HAS_NAME.test(text) ? { text } : undefined,
      );
      order++;
    }
  }
  if (found.size < enough)
    for (const li of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const { link, text } = item(li[1] ?? '');
      const match = /^第?0*(\d{1,3})[.．番、:：]?\s*(\S.*)$/.exec(text);
      if (!match) continue;
      collect(
        found,
        clashes,
        Number(match[1]),
        link ? { text: link.text, title: link.title } : { text: match[2] ?? '' },
      );
    }
  if (found.size >= enough) return result(found, clashes, 'numbered list');

  // 3. Tables with a name column, in page order.
  found = new Map();
  let order = first;
  for (const grid of tables) {
    const named = nameColumns(grid);
    if (named.length === 0) continue;
    for (const row of grid) {
      if (row.every((cell) => cell.header)) continue;
      for (const column of named) {
        const cell = row[column];
        const name = cell?.own && !cell.header ? nameIn(cell) : undefined;
        if (name && order <= last) found.set(order, { order: order++, ...name });
      }
    }
  }
  return result(found, [], 'table in page order');
};
