/** Чтение CSV/XLSX, числа в русском формате, запись CSV и XLSX. */
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';

/** «1 250,50 ₽» → 1250.5; пустое и мусор → NaN. */
export function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).replace(/[\s  ]/g, '').replace(/(руб\.?|р\.|₽|rub)/gi, '');
  if (!s) return NaN;
  // «1.250,50» → «1250.50»; «1,250.50» → «1250.50»
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Все листы файла как массивы строк (сырые ячейки, без угадывания шапки). */
export function readSheets(file: string): { name: string; rows: unknown[][] }[] {
  const buf = readFileSync(file);
  const isCsv = /\.(csv|tsv|txt)$/i.test(file);
  const wb = isCsv
    ? XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true, FS: sniffDelimiter(buf.toString('utf8')) })
    : XLSX.read(buf, { type: 'buffer' });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' }),
  }));
}

function sniffDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [';', '\t', ','].map((d) => [d, head.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n') + '\n';
}

export function writeCsv(file: string, rows: Record<string, unknown>[], columns?: string[]): void {
  writeFileSync(file, toCsv(rows, columns));
}

export function writeXlsx(file: string, sheets: { name: string; rows: Record<string, unknown>[] }[]): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const rounded = s.rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rounded), s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, file);
}
