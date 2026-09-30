import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseNumber, readSheets } from '../scripts/lib/table.js';
import { detectColumns, extractCosts } from '../scripts/lib/cost.js';

const fx = (f: string) => join(import.meta.dirname, 'fixtures', f);

test('числа в русском формате', () => {
  assert.equal(parseNumber('1 250,50 ₽'), 1250.5);
  assert.equal(parseNumber('1.250,50'), 1250.5);
  assert.equal(parseNumber('1,250.50'), 1250.5);
  assert.equal(parseNumber('2300 руб.'), 2300);
  assert.equal(parseNumber(99), 99);
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('нет')));
});

test('шапка не в первой строке, две колонки-кандидата — не угадываем', () => {
  const [s] = readSheets(fx('cost-messy.csv'));
  const d = detectColumns(s.rows);
  assert.equal(d.headerRow, 2);
  assert.equal(d.keyKind, 'vendorCode');
  // «Закупка» похожа на себестоимость, «Упаковка» нет — одна колонка, без проблем
  assert.deepEqual(d.costCols.map((c) => d.headers[c]), ['Закупка']);
});

test('сумма частей через --cost-col', () => {
  const [s] = readSheets(fx('cost-messy.csv'));
  const d = detectColumns(s.rows, { costCol: 'Закупка+Упаковка' });
  const { items, conflicts } = extractCosts(s.rows, d);
  assert.equal(conflicts.length, 0);
  assert.equal(items[0].key, 'ART-001');
  assert.equal(items[0].cost, 1075.5);
});

test('ключ nmID распознаётся как nmId', () => {
  const [s] = readSheets(fx('cost-by-nmid.csv'));
  const d = detectColumns(s.rows);
  assert.equal(d.keyKind, 'nmId');
  const { items } = extractCosts(s.rows, d);
  assert.equal(items[0].key, '100001');
});

test('две колонки себестоимости — просим указать', () => {
  const rows = [['Артикул', 'Себестоимость', 'Закупочная цена'], ['A1', '100', '90']];
  const d = detectColumns(rows);
  assert.ok(d.problems.some((p) => p.includes('Несколько колонок похожи на себестоимость')));
});

test('один артикул — разная себестоимость → конфликт', () => {
  const rows = [['Артикул продавца', 'Себестоимость'], ['A1', '100'], ['A1', '120']];
  const d = detectColumns(rows);
  assert.equal(extractCosts(rows, d).conflicts.length, 1);
});
