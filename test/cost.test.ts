import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseNumber, readSheets } from '../scripts/lib/table.js';
import { detectColumns, extractCosts, mergeCosts, type StoredCost } from '../scripts/lib/cost.js';

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

const stored = (vendorCode: string, cost: number, supplier = '', sourceFile = 'a.xlsx'): StoredCost =>
  ({ vendorCode, nmId: '', cost, sourceRow: 2, sourceFile, supplier });

test('второй прайс не стирает первый', () => {
  const m = mergeCosts([stored('A1', 100), stored('A2', 200)], [stored('B1', 50, '', 'b.xlsx')]);
  assert.deepEqual(m.rows.map((r) => r.vendorCode).sort(), ['A1', 'A2', 'B1']);
  assert.equal(m.added.length, 1);
  assert.equal(m.kept, 2);
});

test('обновление прайса: новая цифра заменяет старую и видна в списке изменений', () => {
  const m = mergeCosts([stored('A1', 100), stored('A2', 200)], [stored('A1', 120, '', 'октябрь.xlsx'), stored('A2', 200, '', 'октябрь.xlsx')]);
  assert.deepEqual(m.changed, [{ vendorCode: 'A1', was: 100, now: 120, wasFile: 'a.xlsx' }]);
  assert.equal(m.unchanged, 1);
  assert.equal(m.rows.find((r) => r.vendorCode === 'A1')?.cost, 120);
});

test('один артикул у двух названных поставщиков с разной ценой — не выбираем сами', () => {
  const m = mergeCosts([stored('A1', 100, 'Альфа')], [stored('A1', 90, 'Бета', 'b.xlsx')]);
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.rows[0].cost, 100);
  const forced = mergeCosts([stored('A1', 100, 'Альфа')], [stored('A1', 90, 'Бета', 'b.xlsx')], { preferNew: true });
  assert.equal(forced.conflicts.length, 0);
  assert.equal(forced.rows[0].cost, 90);
  assert.equal(forced.rows[0].supplier, 'Бета');
});

test('поставщик не назван — метка прежней загрузки сохраняется', () => {
  const m = mergeCosts([stored('A1', 100, 'Альфа')], [stored('A1', 110, '', 'b.xlsx')]);
  assert.equal(m.conflicts.length, 0);
  assert.equal(m.rows[0].supplier, 'Альфа');
});
