import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import * as XLSX from 'xlsx';

/** A sheet as text cells: the header row, then data rows with their 1-based line numbers. */
export interface RawSheet {
  headers: string[];
  rows: { line: number; cells: string[] }[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, line breaks inside quotes, CRLF or LF, a BOM. */
export const parseCsv = (text: string): string[][] => {
  const input = text.replace(/^﻿/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Text for one .xlsx cell. Date cells become ISO dates (or date-times) without a zone. */
const cellText = (cell: XLSX.CellObject | undefined): string => {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const date = XLSX.SSF.parse_date_code(cell.v as number);
    const day = `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}`;
    return date.H || date.M || date.S
      ? `${day}T${pad(date.H)}:${pad(date.M)}:${pad(Math.floor(date.S))}`
      : day;
  }
  if (cell.t === 'b') return cell.v ? 'yes' : 'no';
  if (cell.t === 'n') return String(cell.v);
  return String(cell.v);
};

const readXlsx = (path: string): string[][] => {
  const workbook = XLSX.read(readFileSync(path), {
    type: 'buffer',
    cellDates: false,
    cellNF: true,
  });
  const first = workbook.SheetNames[0];
  const sheet = first ? workbook.Sheets[first] : undefined;
  if (!sheet || !sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++)
      row.push(cellText(sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined));
    rows.push(row);
  }
  return rows;
};

/** Reads a CSV or .xlsx (first sheet) file. Empty rows are dropped; line numbers stay true to the file. */
export const readSheet = (path: string): RawSheet => {
  const extension = extname(path).toLowerCase();
  let records: string[][];
  if (extension === '.csv') records = parseCsv(readFileSync(path, 'utf8'));
  else if (extension === '.xlsx' || extension === '.xlsm') records = readXlsx(path);
  else throw new Error(`Unsupported sheet type "${extension}". Use .csv or .xlsx.`);

  const [header, ...body] = records;
  if (!header) return { headers: [], rows: [] };
  return {
    headers: header.map((cell) => cell.trim()),
    rows: body
      .map((cells, i) => ({ line: i + 2, cells: cells.map((cell) => cell.trim()) }))
      .filter((row) => row.cells.some((cell) => cell !== '')),
  };
};
