/**
 * Импорт себестоимости из таблицы клиента любого формата → data/cost.csv.
 *
 *   npx tsx scripts/cost-import.ts <файл.csv|xlsx> [--sheet Лист1] [--sku-col "Артикул"] \
 *       [--cost-col "Себестоимость" | "Закупка+Упаковка"] [--key vendorCode|nmId|barcode] [--no-wb]
 *
 * Ключ на выходе — артикул продавца. Если в таблице nmID или баркод, переводим через карточки WB.
 * Ничего не угадываем молча: при двусмысленности печатаем шапку и выходим с кодом 2.
 */
import { join } from 'node:path';
import { parseArgs } from './lib/args.js';
import { DATA, ensureDir } from './lib/env.js';
import { readSheets, writeCsv } from './lib/table.js';
import { detectColumns, extractCosts, type KeyKind } from './lib/cost.js';
import { fetchAllCards, type CardRef } from './lib/cards.js';

const { positional, str, flag } = parseArgs();
const file = positional[0];
if (!file) {
  console.error('Укажите файл: npx tsx scripts/cost-import.ts <таблица.csv|xlsx>');
  process.exit(1);
}

const sheets = readSheets(file);
const wanted = str('sheet');
const candidates = wanted ? sheets.filter((s) => s.name === wanted) : sheets;
if (candidates.length === 0) {
  console.error(`Лист «${wanted}» не найден. Листы: ${sheets.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

let picked: { name: string; rows: unknown[][]; det: ReturnType<typeof detectColumns> } | undefined;
for (const s of candidates) {
  const det = detectColumns(s.rows, { skuCol: str('sku-col'), costCol: str('cost-col'), keyKind: str('key') as KeyKind | undefined });
  if (det.headerRow >= 0) { picked = { ...s, det }; break; }
}

if (!picked || picked.det.problems.length > 0) {
  const s = picked ?? { name: candidates[0].name, rows: candidates[0].rows, det: detectColumns(candidates[0].rows) };
  console.error(`\nЛист «${s.name}». Не могу однозначно выбрать колонки:`);
  for (const p of s.det.problems) console.error(`  — ${p}`);
  console.error('\nПервые строки таблицы:');
  s.rows.slice(0, 6).forEach((r, i) => console.error(`  ${i + 1}: ${r.map((c, j) => `[${String.fromCharCode(65 + j)}] ${String(c).slice(0, 30)}`).join(' | ')}`));
  console.error('\nПовторите с --sku-col и --cost-col (название колонки или буква).');
  process.exit(2);
}

const { det, rows, name } = picked;
const { items, skipped, conflicts } = extractCosts(rows, det);
console.log(`Лист «${name}», шапка в строке ${det.headerRow + 1}`);
console.log(`  ключ: «${det.headers[det.keyCol!]}» (${det.keyKind})`);
console.log(`  себестоимость: ${det.costCols.map((c) => `«${det.headers[c]}»`).join(' + ')}`);
console.log(`  строк с себестоимостью: ${items.length}, пропущено: ${skipped.length}`);
for (const s of skipped.slice(0, 10)) console.log(`    строка ${s.row}: ${s.reason}`);
if (skipped.length > 10) console.log(`    … ещё ${skipped.length - 10}`);

if (conflicts.length > 0) {
  console.error(`\nОдин артикул — разная себестоимость (${conflicts.length}). Исправьте таблицу:`);
  conflicts.slice(0, 20).forEach((c) => console.error(`  ${c}`));
  process.exit(3);
}

let cards: CardRef[] = [];
if (!flag('no-wb')) {
  try {
    cards = await fetchAllCards(flag('fresh'));
    console.log(`Карточек на WB: ${cards.length}`);
  } catch (e) {
    console.error(`Не удалось получить карточки WB: ${(e as Error).message}`);
    if (det.keyKind !== 'vendorCode') process.exit(4);
    console.error('Продолжаю без сверки с WB (--no-wb).');
  }
}

const byVendor = new Map(cards.map((c) => [c.vendorCode, c]));
const byNm = new Map(cards.map((c) => [String(c.nmId), c]));
const byBarcode = new Map(cards.flatMap((c) => c.barcodes.map((b) => [b, c] as const)));

const out: Record<string, unknown>[] = [];
const notOnWb: string[] = [];
for (const it of items) {
  let card: CardRef | undefined;
  if (det.keyKind === 'vendorCode') card = byVendor.get(it.key);
  else if (det.keyKind === 'nmId') card = byNm.get(it.key);
  else card = byBarcode.get(it.key);
  if (!card && cards.length > 0) notOnWb.push(it.key);
  if (!card && det.keyKind !== 'vendorCode') continue; // без карточки nmID/баркод не перевести в артикул
  out.push({ vendorCode: card?.vendorCode ?? it.key, nmId: card?.nmId ?? '', cost: it.cost, sourceRow: it.row });
}

// Если по баркодам у одного артикула разная себестоимость (размеры) — это не ошибка, но ключ у нас артикул
const perVendor = new Map<string, number[]>();
for (const r of out) perVendor.set(String(r.vendorCode), [...(perVendor.get(String(r.vendorCode)) ?? []), Number(r.cost)]);
const multi = [...perVendor].filter(([, v]) => new Set(v).size > 1);
if (multi.length > 0) {
  console.error(`\nУ ${multi.length} артикулов разная себестоимость по размерам/баркодам: ${multi.slice(0, 5).map(([k, v]) => `${k} (${v.join('/')})`).join(', ')}`);
  console.error('Ключ расчёта — артикул продавца. Сведите себестоимость к одной цифре на артикул или обсудите учёт по размерам.');
  process.exit(3);
}
const unique = [...new Map(out.map((r) => [String(r.vendorCode), r])).values()];

const target = join(ensureDir(DATA), 'cost.csv');
writeCsv(target, unique, ['vendorCode', 'nmId', 'cost', 'sourceRow']);
console.log(`\nЗаписано: ${target} (${unique.length} артикулов)`);

if (cards.length > 0) {
  const have = new Set(unique.map((r) => String(r.vendorCode)));
  const missing = cards.filter((c) => !have.has(c.vendorCode));
  if (notOnWb.length) console.log(`\n⚠ В таблице, но нет на WB (${notOnWb.length}): ${notOnWb.slice(0, 15).join(', ')}${notOnWb.length > 15 ? ' …' : ''}`);
  if (missing.length) {
    console.log(`⚠ На WB без себестоимости (${missing.length}): ${missing.slice(0, 15).map((c) => c.vendorCode).join(', ')}${missing.length > 15 ? ' …' : ''}`);
    console.log('  Если они продавались в периоде расчёта, profit остановится и назовёт их.');
  }
}
