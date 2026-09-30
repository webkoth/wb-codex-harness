/**
 * Воронка карточек: где и сколько денег теряется, очередь на правки, контекст для черновиков.
 *
 *   npx tsx scripts/funnel.ts [--from 2026-09-01 --to 2026-09-28] [--top 5] [--min-open 50] [--fresh]
 *
 * По умолчанию — 28 дней до вчера. Прибыль на выкуп берётся из последнего reports/profit-*.csv
 * (сначала $profit); без него потери считаются в выручке, это подписано.
 * Органических показов и CTR в API WB нет: верх воронки — видимость и позиция из поисковых запросов,
 * CTR — только рекламный (fullstats).
 * Пишет reports/funnel-<from>_<to>.xlsx/.md и drafts/<nmID>/context.json для топ-N карточек.
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './lib/args.js';
import { DRAFTS, REPORTS, ensureDir } from './lib/env.js';
import { addDays, fetchAdsByNm, fetchFunnel, fetchSearchTexts } from './lib/sources.js';
import { fetchAllCards } from './lib/cards.js';
import { diagnose, type FunnelCard } from './lib/funnel.js';
import { readSheets, parseNumber, writeXlsx } from './lib/table.js';

const { str, flag } = parseArgs();
const yesterday = addDays(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10), -1);
const to = str('to') ?? yesterday;
const from = str('from') ?? addDays(to, -27);
const top = Number(str('top') ?? 5);
const minOpen = Number(str('min-open') ?? 50);
const fresh = flag('fresh');
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

// прибыль на выкуп из последнего отчёта profit
const profitPerBuyout = new Map<string, number>();
let profitSource = '';
if (existsSync(REPORTS)) {
  const last = readdirSync(REPORTS).filter((f) => /^profit-.*\.csv$/.test(f)).sort().pop();
  if (last) {
    profitSource = last;
    const [s] = readSheets(join(REPORTS, last));
    const [head, ...rows] = s.rows.map((r) => r.map(String));
    const vi = head.indexOf('Артикул продавца');
    const pi = head.indexOf('Прибыль на выкуп, ₽');
    const ui = head.indexOf('Продано нетто, шт');
    for (const r of rows) if (parseNumber(r[ui]) > 0) profitPerBuyout.set(r[vi], parseNumber(r[pi]));
  }
}

console.log(`Воронка ${from} … ${to}${profitSource ? `, прибыль на выкуп из ${profitSource}` : ', прибыли нет — потери в выручке'}`);
const funnel = await fetchFunnel(from, to, fresh, true);
const cards: FunnelCard[] = funnel.map((f) => ({
  nmId: f.nmId, vendorCode: f.vendorCode, title: f.title,
  open: f.open, cart: f.cart, orders: f.orders, buyouts: f.buyouts, orderSum: f.orderSum,
  cartPct: f.addToCartPct, orderPct: f.cartToOrderPct, buyoutPct: f.buyoutPct,
  profitPerBuyout: profitPerBuyout.get(f.vendorCode),
}));
const { rows, med } = diagnose(cards, minOpen);
console.log(`Карточек: ${cards.length}, в базе медианы (≥${minOpen} переходов): ${med.n}. Медиана: в корзину ${med.cartPct}%, в заказ ${med.orderPct}%, выкуп ${med.buyoutPct}%`);

let ads: Awaited<ReturnType<typeof fetchAdsByNm>> | undefined;
try { ads = await fetchAdsByNm(from, to, fresh); } catch (e) { console.log(`Реклама не получена: ${(e as Error).message.slice(0, 150)}`); }

const queue = rows.filter((r) => r.loss > 0 && !r.note?.startsWith('прибыль')).slice(0, top);
const search = queue.length ? await fetchSearchTexts(queue.map((q) => q.nmId), from, to, fresh) : new Map();
const searchError = search instanceof Map ? undefined : search.error;

const byNm = new Map(funnel.map((f) => [f.nmId, f]));
const table = rows.map((r) => {
  const f = byNm.get(r.nmId)!;
  const a = ads?.get(r.nmId);
  return {
    'Артикул продавца': r.vendorCode, nmID: r.nmId, Название: r.title,
    Переходы: r.open, 'Переходы, прошлый период': f.past?.open ?? '', 'В корзину, %': r.cartPct, 'В заказ, %': r.orderPct, 'Выкуп, %': r.buyoutPct,
    Заказы: r.orders, 'Рейтинг': f.rating, 'Остаток WB': f.stockWb, 'Остаток FBS': f.stockMp,
    'Реклама: показы': a?.views ?? '', 'Реклама: CTR, %': a && a.views ? Math.round((a.clicks / a.views) * 1000) / 10 : '', 'Реклама: расход, ₽': a?.sum ?? '',
    'Слабый этап': r.weakest ?? '', [`Потеря в месяц (${r.valueBasis}), ₽`]: Math.round(r.loss), Примечание: r.note ?? '',
  };
});
const base = join(ensureDir(REPORTS), `funnel-${from}_${to}`);
writeXlsx(`${base}.xlsx`, [{ name: 'Воронка', rows: table }]);

// контекст для черновиков: всё, что нужно Codex, чтобы написать правки без лишних запросов
const allCards = await fetchAllCards(fresh).catch(() => []);
const rawByNm = new Map(allCards.map((c) => [c.nmId, c.raw]));
for (const q of queue) {
  const dir = ensureDir(join(DRAFTS, String(q.nmId)));
  const raw = rawByNm.get(q.nmId) as Record<string, any> | undefined;
  writeFileSync(join(dir, 'context.json'), JSON.stringify({
    period: { from, to },
    card: raw ? {
      nmId: q.nmId, vendorCode: q.vendorCode, subjectName: raw.subjectName, title: raw.title,
      titleLength: String(raw.title ?? '').length, description: raw.description,
      descriptionLength: String(raw.description ?? '').length, characteristics: raw.characteristics,
      photos: (raw.photos ?? []).map((p: any) => p.big ?? p.c516x688 ?? p), video: raw.video ?? null,
      dimensions: raw.dimensions,
    } : { nmId: q.nmId, vendorCode: q.vendorCode, error: 'карточка не найдена в content API' },
    funnel: { ...byNm.get(q.nmId), medianShop: med },
    diagnosis: { weakest: q.weakest, lossPerPeriod: Math.round(q.loss), basis: q.valueBasis, lossCart: Math.round(q.lossCart), lossOrder: Math.round(q.lossOrder), lossBuyout: Math.round(q.lossBuyout) },
    ads: ads?.get(q.nmId) ?? null,
    searchTexts: search instanceof Map ? search.get(q.nmId) ?? [] : { error: searchError },
  }, null, 2));
}

const md = [
  `# Воронка карточек · ${from} … ${to}`,
  '',
  `Медиана магазина (${med.n} карточек с ≥${minOpen} переходами): в корзину **${med.cartPct}%**, в заказ **${med.orderPct}%**, выкуп **${med.buyoutPct}%**.`,
  `Потери посчитаны в ${profitSource ? 'прибыли (из ' + profitSource + ')' : 'выручке — прибыли нет, запустите $profit'}.`,
  'Органического CTR в API WB нет; рекламный CTR — в xlsx.',
  searchError ? `\n⚠ Поисковые запросы: ${searchError}` : '',
  '',
  `## Очередь правок (топ-${queue.length})`,
  '',
  '| # | Артикул | nmID | Переходы | В корзину | В заказ | Выкуп | Слабый этап | Потеря |',
  '|---|---|---|---:|---:|---:|---:|---|---:|',
  ...queue.map((q, i) => `| ${i + 1} | ${q.vendorCode} | ${q.nmId} | ${q.open} | ${q.cartPct}% | ${q.orderPct}% | ${q.buyoutPct}% | ${q.weakest} | ${rub(q.loss)} |`),
  '',
  queue.length ? `Контекст для черновиков: ${queue.map((q) => `drafts/${q.nmId}/context.json`).join(', ')}` : 'Потерь относительно медианы нет.',
  '',
  ...(rows.some((r) => r.note?.startsWith('прибыль')) ? ['## Не разгонять — сначала экономика', '', ...rows.filter((r) => r.note?.startsWith('прибыль')).map((r) => `- ${r.vendorCode} (${r.nmId}): прибыль на выкуп ≤ 0`), ''] : []),
].join('\n');
writeFileSync(`${base}.md`, md);
mkdirSync(DRAFTS, { recursive: true });
console.log('\n' + md);
console.log(`Файлы: ${base}.xlsx, .md`);
