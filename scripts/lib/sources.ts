/**
 * Загрузка данных WB для расчётов. Схемы сверены со swagger dev.wildberries.ru на 30.09.2026.
 * Всё кешируется в data/cache: закрытые периоды WB не меняются.
 */
import { WB, cached, sleep, wbFetch, WbError } from './wb.js';

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const log = (s: string) => process.stderr.write(s + '\n');

/** Детализация отчёта о реализации. Лимит 1 запрос в минуту, пагинация по rrdId до 204. */
export async function fetchRealization(from: string, to: string, fresh = false): Promise<Record<string, unknown>[]> {
  return cached(['realization', from, to], fresh, async () => {
    const rows: Record<string, unknown>[] = [];
    let rrdId = 0;
    for (let page = 0; page < 50; page++) {
      log(`  детализация: страница ${page + 1}${page ? ' (лимит WB — 1 запрос в минуту, жду)' : ''}`);
      if (page > 0) await sleep(61_000);
      const res = await wbFetch<Record<string, unknown>[]>(`${WB.finance}/api/finance/v1/sales-reports/detailed`, {
        body: { dateFrom: from, dateTo: to, limit: 100_000, rrdId, period: 'weekly' },
        maxWaitSec: 65,
      });
      if (!res || res.length === 0) break;
      rows.push(...res);
      let next = 0;
      for (let i = res.length - 1; i >= 0; i--) if (res[i].rrdId) { next = Number(res[i].rrdId); break; }
      if (res.length < 100_000 || !next || next <= rrdId) break;
      rrdId = next;
    }
    return rows;
  });
}

interface FullstatsCampaign {
  advertId: number;
  days?: Array<{ apps?: Array<{ nms?: Array<{ nmId: number; sum: number; views?: number; clicks?: number; orders?: number; atbs?: number }> }> }>;
}

export interface AdsNm { sum: number; views: number; clicks: number; orders: number; carts: number }

/** Расход рекламы по nmID за период: /adv/v1/promotion/count → /adv/v3/fullstats (до 50 кампаний, до 31 дня, 3 в минуту). */
export async function fetchAdsByNm(from: string, to: string, fresh = false): Promise<Map<number, AdsNm>> {
  const obj = await cached(['ads-v2', from, to], fresh, async () => {
    const count = await wbFetch<{ adverts?: Array<{ status: number; advert_list?: Array<{ advertId: number; changeTime?: string }> }> }>(
      `${WB.advert}/adv/v1/promotion/count`,
    );
    // статусы с данными статистики: 7 — завершена, 9 — активна, 11 — пауза
    // changeTime — дата изменения кампании, а не граница расходов: период задаёт fullstats.
    const ids = [...new Set((count?.adverts ?? [])
      .filter((g) => [7, 9, 11].includes(g.status))
      .flatMap((g) => g.advert_list ?? [])
      .map((a) => a.advertId))];
    const out: Record<number, AdsNm> = {};
    const windows: [string, string][] = [];
    for (let s = from; s <= to; s = addDays(s, 31)) windows.push([s, addDays(s, 30) < to ? addDays(s, 30) : to]);
    let calls = 0;
    for (const [b, e] of windows) {
      for (let i = 0; i < ids.length; i += 50) {
        if (calls++ > 0) await sleep(21_000);
        log(`  реклама: кампании ${i + 1}–${Math.min(i + 50, ids.length)} из ${ids.length}, ${b}…${e}`);
        const res = await wbFetch<FullstatsCampaign[]>(
          `${WB.advert}/adv/v3/fullstats?ids=${ids.slice(i, i + 50).join(',')}&beginDate=${b}&endDate=${e}`,
          { maxWaitSec: 65 },
        );
        for (const c of res ?? []) for (const d of c.days ?? []) for (const a of d.apps ?? []) for (const n of a.nms ?? []) {
          const x = (out[n.nmId] ??= { sum: 0, views: 0, clicks: 0, orders: 0, carts: 0 });
          x.sum += n.sum || 0; x.views += n.views || 0; x.clicks += n.clicks || 0; x.orders += n.orders || 0; x.carts += n.atbs || 0;
        }
      }
    }
    return out;
  });
  return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
}

/** Платное хранение по nmID: задание на ≤8 дней → статус раз в 5 с → скачать (1 в минуту). */
export async function fetchStorageByNm(from: string, to: string, fresh = false): Promise<Map<number, number>> {
  const obj = await cached(['storage', from, to], fresh, async () => {
    const out: Record<number, number> = {};
    let first = true;
    for (let s = from; s <= to; s = addDays(s, 8)) {
      const e = addDays(s, 7) < to ? addDays(s, 7) : to;
      if (!first) await sleep(61_000);
      first = false;
      log(`  хранение: ${s}…${e} (задание WB, жду готовности)`);
      const task = await wbFetch<{ data?: { taskId?: string } }>(`${WB.analytics}/api/v1/paid_storage?dateFrom=${s}&dateTo=${e}`, { maxWaitSec: 65 });
      const id = task?.data?.taskId;
      if (!id) throw new Error('paid_storage не вернул taskId');
      for (let i = 0; i < 60; i++) {
        await sleep(5_000);
        const st = await wbFetch<{ data?: { status?: string } }>(`${WB.analytics}/api/v1/paid_storage/tasks/${id}/status`);
        const status = st?.data?.status;
        if (status === 'done') break;
        if (status === 'canceled' || status === 'purged') throw new Error(`paid_storage: задание ${status}`);
      }
      const rows = await wbFetch<Array<{ nmId: number; warehousePrice: number }>>(
        `${WB.analytics}/api/v1/paid_storage/tasks/${id}/download`, { maxWaitSec: 65 },
      );
      for (const r of rows ?? []) out[r.nmId] = (out[r.nmId] ?? 0) + (r.warehousePrice || 0);
    }
    return out;
  });
  return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
}

export interface FunnelNm {
  nmId: number; vendorCode: string; title: string; subjectName: string;
  open: number; cart: number; orders: number; orderSum: number; buyouts: number; buyoutSum: number; cancels: number;
  addToCartPct: number; cartToOrderPct: number; buyoutPct: number;
  rating: number; feedbackRating: number; stockWb: number; stockMp: number;
  past?: { open: number; cart: number; orders: number; addToCartPct: number; cartToOrderPct: number };
}

/** Воронка по карточкам: POST /api/analytics/v3/sales-funnel/products (до 365 дней, 3 в минуту, Джем не нужен). */
export async function fetchFunnel(from: string, to: string, fresh = false, withPast = false): Promise<FunnelNm[]> {
  return cached(['funnel', from, to, withPast], fresh, async () => {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000);
    const out: FunnelNm[] = [];
    for (let offset = 0; offset < 20_000; offset += 1000) {
      if (offset) await sleep(21_000);
      const body: Record<string, unknown> = {
        selectedPeriod: { start: from, end: to },
        nmIds: [], brandNames: [], subjectIds: [], tagIds: [],
        skipDeletedNm: true,
        orderBy: { field: 'openCard', mode: 'desc' },
        limit: 1000, offset,
      };
      if (withPast) body.pastPeriod = { start: addDays(from, -(days + 1)), end: addDays(from, -1) };
      const res = await wbFetch<{ data?: { products?: any[] } }>(`${WB.analytics}/api/analytics/v3/sales-funnel/products`, { body, maxWaitSec: 65 });
      const products = res?.data?.products ?? [];
      for (const p of products) {
        const s = p.statistic?.selected ?? {};
        const past = p.statistic?.past;
        out.push({
          nmId: p.product?.nmId, vendorCode: p.product?.vendorCode ?? '', title: p.product?.title ?? '', subjectName: p.product?.subjectName ?? '',
          open: s.openCount ?? 0, cart: s.cartCount ?? 0, orders: s.orderCount ?? 0, orderSum: s.orderSum ?? 0,
          buyouts: s.buyoutCount ?? 0, buyoutSum: s.buyoutSum ?? 0, cancels: s.cancelCount ?? 0,
          addToCartPct: s.conversions?.addToCartPercent ?? 0, cartToOrderPct: s.conversions?.cartToOrderPercent ?? 0, buyoutPct: s.conversions?.buyoutPercent ?? 0,
          rating: p.product?.productRating ?? 0, feedbackRating: p.product?.feedbackRating ?? 0,
          stockWb: p.product?.stocks?.wb ?? 0, stockMp: p.product?.stocks?.mp ?? 0,
          past: past ? { open: past.openCount ?? 0, cart: past.cartCount ?? 0, orders: past.orderCount ?? 0, addToCartPct: past.conversions?.addToCartPercent ?? 0, cartToOrderPct: past.conversions?.cartToOrderPercent ?? 0 } : undefined,
        });
      }
      if (products.length < 1000) break;
    }
    return out;
  });
}

export interface SearchText {
  text: string; frequency: number; weekFrequency: number; avgPosition: number; medianPosition: number;
  openCard: number; openCardPercentile: number; addToCart: number; orders: number; openToCart: number; cartToOrder: number; visibility: number;
}

/** Поисковые запросы по карточке: POST /api/v2/search-report/product/search-texts (до 50 nmID, лимит 30 запросов на товар без Джема «Продвинутый»). */
export async function fetchSearchTexts(nmIds: number[], from: string, to: string, fresh = false): Promise<Map<number, SearchText[]> | { error: string }> {
  try {
    const obj = await cached(['search-texts', nmIds, from, to], fresh, async () => {
      const out: Record<number, SearchText[]> = {};
      for (let i = 0; i < nmIds.length; i += 50) {
        if (i) await sleep(21_000);
        const res = await wbFetch<{ data?: { items?: any[] } }>(`${WB.analytics}/api/v2/search-report/product/search-texts`, {
          body: {
            currentPeriod: { start: from, end: to },
            nmIds: nmIds.slice(i, i + 50),
            topOrderBy: 'openCard',
            includeSubstitutedSKUs: true, includeSearchTexts: true,
            orderBy: { field: 'openCard', mode: 'desc' },
            limit: 30,
          },
          maxWaitSec: 65,
        });
        for (const it of res?.data?.items ?? []) {
          (out[it.nmId] ??= []).push({
            text: it.text, frequency: it.frequency?.current ?? 0, weekFrequency: it.weekFrequency ?? 0,
            avgPosition: it.avgPosition?.current ?? 0, medianPosition: it.medianPosition?.current ?? 0,
            openCard: it.openCard?.current ?? 0, openCardPercentile: it.openCard?.percentile ?? 0,
            addToCart: it.addToCart?.current ?? 0, orders: it.orders?.current ?? 0,
            openToCart: it.openToCart?.current ?? 0, cartToOrder: it.cartToOrder?.current ?? 0, visibility: it.visibility?.current ?? 0,
          });
        }
      }
      return out;
    });
    return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
  } catch (e) {
    const status = e instanceof WbError ? e.status : 0;
    return { error: status === 403 ? 'поисковые запросы недоступны на этом тарифе/токене (403) — вероятно, нужен «Джем»' : (e as Error).message };
  }
}

export { addDays };
