/**
 * Прибыль до налогов по каждому артикулу за период.
 *
 *   npx tsx scripts/profit.ts [--from 2026-09-22 --to 2026-09-28] [--fresh] [--no-ads] [--no-storage] [--no-funnel]
 *   npx tsx scripts/profit.ts --rows test/fixtures/realization.json --no-ads --no-storage --no-funnel   # без сети
 *
 * По умолчанию — прошлая полная неделя. Первый прогон идёт минутами: лимиты WB
 * (детализация — 1 запрос в минуту, хранение — задание раз в минуту). Повтор за тот же период — из кеша.
 * Пишет reports/profit-<from>_<to>.xlsx, .csv и .md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lastFullWeek, parseArgs } from './lib/args.js';
import { REPORTS, ensureDir } from './lib/env.js';
import { loadCosts } from './lib/costfile.js';
import { computeProfit, type SkuProfit } from './lib/profit.js';
import { addDays, fetchAdsByNm, fetchFunnel, fetchRealization, fetchStorageByNm } from './lib/sources.js';
import { writeCsv, writeXlsx } from './lib/table.js';

const { str, flag } = parseArgs();
const week = lastFullWeek();
const from = str('from') ?? week.from;
const to = str('to') ?? week.to;
const fresh = flag('fresh');
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const costs = loadCosts();
console.log(`Период ${from} … ${to}. Себестоимость: ${costs.size} артикулов.`);

const rows = str('rows')
  ? (JSON.parse(readFileSync(str('rows')!, 'utf8')).rows ?? JSON.parse(readFileSync(str('rows')!, 'utf8')))
  : await fetchRealization(from, to, fresh);
console.log(`Строк детализации: ${rows.length}`);
if (rows.length === 0) {
  console.log('WB не вернул строк за период. Отчёт о реализации формируется по понедельникам за прошлую неделю — проверьте даты.');
  process.exit(0);
}

const warnings: string[] = [];
const soft = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
  try { return await fn(); } catch (e) { warnings.push(`${label}: ${(e as Error).message.slice(0, 200)}`); return undefined; }
};

const ads = flag('no-ads') ? undefined : await soft('Реклама (fullstats)', () => fetchAdsByNm(from, to, fresh));
const storage = flag('no-storage') ? undefined : await soft('Платное хранение', () => fetchStorageByNm(from, to, fresh));
// доля выкупа: по воронке за 30 дней до конца периода (выкупы привязаны к дате заказа)
const funnel = flag('no-funnel') ? undefined : await soft('Воронка (выкуп)', () => fetchFunnel(addDays(to, -29), to, fresh));

const result = computeProfit({
  rows,
  costs,
  adsByNm: ads ? new Map([...ads].map(([k, v]) => [k, v.sum])) : undefined,
  storageByNm: storage,
  funnelByNm: funnel ? new Map(funnel.map((f) => [f.nmId, { orders: f.orders, buyouts: Math.round((f.orders * f.buyoutPct) / 100) || f.buyouts }])) : undefined,
});
warnings.push(...result.warnings);

if (result.missingCost.length > 0) {
  console.error(`\n⛔ Нет себестоимости у ${result.missingCost.length} проданных артикулов. Прибыль не считаю — с нулевой себестоимостью цифра врёт:`);
  for (const m of result.missingCost) console.error(`  ${m.vendorCode} (nmID ${m.nmId}), продано нетто ${m.netUnits} шт`);
  console.error('Добавьте их в таблицу и повторите $cost-import.');
  process.exit(3);
}

const t = result.totals;
if (Math.abs(t.payout - t.payoutCheck) > 1) {
  console.error(`\n⛔ Сверка не сошлась: выплата по строкам ${rub(t.payout)}, по артикулам + не распределено ${rub(t.payoutCheck)}. Отчёт не выдаю — это ошибка классификации строк, пришлите вывод разработчику.`);
  process.exit(5);
}

const preliminary = to >= addDays(new Date().toISOString().slice(0, 10), -14);
const cols: [keyof SkuProfit, string][] = [
  ['vendorCode', 'Артикул продавца'], ['nmId', 'nmID'], ['title', 'Название'], ['netUnits', 'Продано нетто, шт'],
  ['revenue', 'Выручка (цена продавца), ₽'], ['forPay', 'К перечислению, ₽'], ['logistics', 'Логистика, ₽'],
  ['storage', 'Хранение, ₽'], ['acceptance', 'Приёмка, ₽'], ['penalty', 'Штрафы, ₽'], ['deduction', 'Удержания, ₽'],
  ['rebill', 'Возмещение перевозки, ₽'], ['additional', 'Доплаты, ₽'], ['acquiring', 'в т.ч. эквайринг (справочно), ₽'],
  ['payout', 'Выплата WB, ₽'], ['ads', 'Реклама (fullstats), ₽'], ['unitCost', 'Себестоимость ед., ₽'], ['cogs', 'Себестоимость итого, ₽'],
  ['profit', 'Прибыль до налогов, ₽'], ['margin', 'Маржа от выручки'], ['profitPerUnit', 'Прибыль на выкуп, ₽'],
  ['buyoutRate', 'Доля выкупа'], ['profitPerOrder', 'Прибыль на заказ, ₽'], ['cpoMax', 'Потолок цены заказа из рекламы (CPO max), ₽'],
];
const skuRows = result.skus.map((s) => Object.fromEntries(cols.map(([k, label]) => [label, s[k] ?? ''])));
const summary = [
  { Показатель: 'Период', Значение: `${from} … ${to}${preliminary ? ' (ПРЕДВАРИТЕЛЬНО: возвраты и корректировки ещё придут)' : ''}` },
  { Показатель: 'Налоги', Значение: 'НЕ учтены — прибыль до налогов' },
  { Показатель: 'Итого к оплате WB (по детализации)', Значение: Math.round(t.payout) },
  { Показатель: 'Удержано за рекламу в отчёте', Значение: Math.round(t.promotionInReport) },
  { Показатель: 'Реклама фактическая (fullstats)', Значение: ads ? Math.round(t.adsFullstats) : 'не получена' },
  { Показатель: 'Себестоимость проданного', Значение: Math.round(t.cogs) },
  { Показатель: 'Прибыль до налогов', Значение: Math.round(t.profit) },
];
const unallocRows = result.unallocated.map((u) => ({ Статья: u.label, 'Сумма, ₽': u.amount }));

const base = join(ensureDir(REPORTS), `profit-${from}_${to}`);
writeXlsx(`${base}.xlsx`, [
  { name: 'Итог', rows: summary },
  { name: 'Артикулы', rows: skuRows },
  { name: 'Не распределено', rows: unallocRows },
]);
writeCsv(`${base}.csv`, skuRows);

const sold = result.skus.filter((s) => s.netUnits > 0);
const loss = sold.filter((s) => s.profit < 0);
const md = [
  `# Прибыль до налогов · ${from} … ${to}${preliminary ? ' · предварительно' : ''}`,
  '',
  `- Итого к оплате WB: **${rub(t.payout)}** — сверьте с «Итого к оплате» в еженедельных отчётах кабинета за эти недели`,
  `- Реклама: ${ads ? `fullstats ${rub(t.adsFullstats)}, удержано в отчёте ${rub(t.promotionInReport)}` : 'не получена'}`,
  `- Себестоимость проданного: ${rub(t.cogs)}`,
  `- **Прибыль до налогов: ${rub(t.profit)}**`,
  `- Проданных артикулов в минусе: ${loss.length} из ${sold.length}${loss.length ? ` (${loss.slice(0, 5).map((s) => s.vendorCode).join(', ')}${loss.length > 5 ? ' …' : ''})` : ''}`,
  `- Без продаж, но с расходами (логистика возвратов, отмены): ${result.skus.length - sold.length}`,
  '',
  '| Артикул | Продано | Выручка | Выплата WB | Реклама | Себестоимость | Прибыль | Маржа | На выкуп | CPO max |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...result.skus.map((s) => `| ${s.vendorCode} | ${s.netUnits} | ${rub(s.revenue)} | ${rub(s.payout)} | ${rub(s.ads)} | ${rub(s.cogs)} | **${rub(s.profit)}** | ${pct(s.margin)} | ${rub(s.profitPerUnit)} | ${s.cpoMax !== undefined ? rub(s.cpoMax) : '—'} |`),
  '',
  '## Не распределено по артикулам',
  '',
  ...(result.unallocated.length ? result.unallocated.map((u) => `- ${u.label}: ${rub(u.amount)}`) : ['- нет']),
  ...(warnings.length ? ['', '## Предупреждения', '', ...warnings.map((w) => `- ${w}`)] : []),
  '',
].join('\n');
writeFileSync(`${base}.md`, md);
console.log('\n' + md);
console.log(`Файлы: ${base}.xlsx, .csv, .md`);
