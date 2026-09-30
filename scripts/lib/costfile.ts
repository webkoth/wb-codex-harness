import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './env.js';
import { readSheets, parseNumber } from './table.js';

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
