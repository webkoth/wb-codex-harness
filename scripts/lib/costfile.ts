import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './env.js';
import { readSheets, parseNumber } from './table.js';
import type { StoredCost } from './cost.js';

/** Нормализованный data/cost.csv → артикул продавца → себестоимость единицы. */
export function loadCosts(file = join(DATA, 'cost.csv')): Map<string, number> {
  if (!existsSync(file)) {
    throw new Error(`Нет ${file}. Сначала импортируйте таблицу себестоимости: npx tsx scripts/cost-import.ts <файл> (скилл $cost-import).`);
  }
  const [sheet] = readSheets(file);
  const [head, ...rows] = sheet.rows;
  const vi = head.findIndex((h) => String(h) === 'vendorCode');
  const ci = head.findIndex((h) => String(h) === 'cost');
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[vi] ?? '').trim();
    const c = parseNumber(r[ci]);
    if (k && Number.isFinite(c)) map.set(k, c);
  }
  return map;
}

export const COST_COLUMNS = ['vendorCode', 'nmId', 'cost', 'sourceRow', 'sourceFile', 'supplier'];

/** Все строки data/cost.csv как есть. Файла нет — пустой список. Старый файл без колонок источника читается с пустыми. */
export function loadCostRows(file = join(DATA, 'cost.csv')): StoredCost[] {
  if (!existsSync(file)) return [];
  const [sheet] = readSheets(file);
  const [head, ...rows] = sheet.rows;
  const col = (name: string) => head.findIndex((h) => String(h) === name);
  const [vi, ni, ci, ri, fi, si] = COST_COLUMNS.map(col);
  const cell = (r: unknown[], i: number) => (i < 0 ? '' : String(r[i] ?? '').trim());
  const out: StoredCost[] = [];
  for (const r of rows) {
    const vendorCode = cell(r, vi);
    const cost = parseNumber(r[ci]);
    if (!vendorCode || !Number.isFinite(cost)) continue;
    out.push({ vendorCode, nmId: cell(r, ni), cost, sourceRow: cell(r, ri), sourceFile: cell(r, fi), supplier: cell(r, si) });
  }
  return out;
}
