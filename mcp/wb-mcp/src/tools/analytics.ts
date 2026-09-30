import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';
import {
  funnelChart,
  conversionStatus,
  formatNumber,
  formatRub,
  formatPercent,
  FunnelStage,
} from '../utils/visualize.js';

// Input schema for wb_get_sales_funnel
export const GetSalesFunnelInputSchema = z.object({
  nmIds: z.array(z.number()).optional().describe('Filter by specific nmIds (max 1000)'),
  dateFrom: z.string().describe('Start date in YYYY-MM-DD format'),
  dateTo: z.string().describe('End date in YYYY-MM-DD format'),
});

export type GetSalesFunnelInput = z.infer<typeof GetSalesFunnelInputSchema>;

// Input schema for wb_get_seller_info
export const GetSellerInfoInputSchema = z.object({});

export type GetSellerInfoInput = z.infer<typeof GetSellerInfoInputSchema>;

// Sales funnel data interface
interface SalesFunnelData {
  nmId: number;
  vendorCode?: string;
  brandName?: string;
  objectName?: string;
  openCardCount: number;      // Переходы в карточку
  addToCartCount: number;     // Добавления в корзину
  ordersCount: number;        // Заказы
  ordersSumRub: number;       // Сумма заказов
  buyoutsCount: number;       // Выкупы
  buyoutsSumRub: number;      // Сумма выкупов
  cancelCount: number;        // Отмены
  cancelSumRub: number;       // Сумма отмен
  // Рассчитанные метрики
  conversions: {
    cardToCart: number;       // % переходов в корзину
    cartToOrder: number;      // % заказов из корзины
    orderToBuyout: number;    // % выкупов
  };
}

// Seller info interface
interface SellerInfo {
  name: string;
  sid: string;
  tradeMark?: string;
}

// Fetch helper with error handling
async function fetchWB<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...createWBHeaders(),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    // Проверяем на ошибку подписки Джем
    if (response.status === 403 && text.includes('Jam')) {
      throw new Error(
        'Для доступа к аналитике требуется подписка "Джем". ' +
        'Подключите подписку в личном кабинете WB: https://seller.wildberries.ru/monetization/jam'
      );
    }
    throw new Error(`WB API Error ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Get seller info from Common API
 * Endpoint: GET https://common-api.wildberries.ru/api/v1/seller-info
 */
export async function getSellerInfo(_input: GetSellerInfoInput): Promise<SellerInfo> {
  const url = `${WB_API_URLS.common}/api/v1/seller-info`;

  const result = await fetchWB<{
    name: string;
    sid: string;
    tradeMark?: string;
  }>(url);

  await logRead('wb_get_seller_info', 'seller', {}, { success: true });

  return result;
}

/**
 * Строка воронки v3 в «плоском» виде — для скриптов (scripts/funnel.ts).
 * Поля — как в ответе WB, без пересчётов. Показов и CTR в методе нет.
 */
export interface FunnelRow {
  nmId: number;
  vendorCode: string;
  title: string;
  brandName: string;
  subjectName: string;
  productRating: number;
  feedbackRating: number;
  stockWb: number;
  stockMp: number;
  openCount: number;
  cartCount: number;
  orderCount: number;
  orderSum: number;
  buyoutCount: number;
  buyoutSum: number;
  cancelCount: number;
  cancelSum: number;
  avgPrice: number;
  addToWishlist: number;
  addToCartPercent: number;
  cartToOrderPercent: number;
  buyoutPercent: number;
}

const FUNNEL_PAGE_LIMIT = 1000;

/**
 * Воронка по карточкам за период.
 * Endpoint: POST https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products
 * Джем не требуется; период — не глубже 365 дней; лимит 3 запроса в минуту.
 * Старый /api/v2/nm-report/detail удалён из API WB.
 */
export async function fetchSalesFunnel(
  dateFrom: string,
  dateTo: string,
  nmIds?: number[]
): Promise<FunnelRow[]> {
  const url = `${WB_API_URLS.analytics}/api/analytics/v3/sales-funnel/products`;
  const rows: FunnelRow[] = [];
  let offset = 0;

  type Stat = Record<string, unknown> & { conversions?: Record<string, number> };
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

  // Защита от бесконечного цикла: не больше 20 страниц по 1000 карточек
  for (let page = 0; page < 20; page++) {
    const body = {
      selectedPeriod: { start: dateFrom, end: dateTo },
      nmIds: nmIds && nmIds.length > 0 ? nmIds.slice(0, 1000) : [],
      brandNames: [],
      subjectIds: [],
      tagIds: [],
      skipDeletedNm: true,
      orderBy: { field: 'openCard', mode: 'desc' },
      limit: FUNNEL_PAGE_LIMIT,
      offset,
    };

    let result: {
      data?: {
        products?: Array<{
          product?: Record<string, unknown> & { stocks?: Record<string, number> };
          statistic?: { selected?: Stat };
        }>;
      };
    };
    try {
      result = await fetchWB<typeof result>(url, { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(
        'Воронка продаж недоступна (WB Analytics v3 sales-funnel). Проверьте, что у токена есть категория «Аналитика». ' +
        `Исходная ошибка: ${(err as Error).message}`
      );
    }

    // Пустой ответ бывает и как [], и как {data:{products:[]}}
    const items = Array.isArray(result) ? [] : result.data?.products || [];
    for (const item of items) {
      const p = item.product || {};
      const st = item.statistic?.selected || {};
      const conv = st.conversions || {};
      rows.push({
        nmId: num(p.nmId),
        vendorCode: String(p.vendorCode ?? ''),
        title: String(p.title ?? ''),
        brandName: String(p.brandName ?? ''),
        subjectName: String(p.subjectName ?? ''),
        productRating: num(p.productRating),
        feedbackRating: num(p.feedbackRating),
        stockWb: num(p.stocks?.wb),
        stockMp: num(p.stocks?.mp),
        openCount: num(st.openCount),
        cartCount: num(st.cartCount),
        orderCount: num(st.orderCount),
        orderSum: num(st.orderSum),
        buyoutCount: num(st.buyoutCount),
        buyoutSum: num(st.buyoutSum),
        cancelCount: num(st.cancelCount),
        cancelSum: num(st.cancelSum),
        avgPrice: num(st.avgPrice),
        addToWishlist: num(st.addToWishlist),
        addToCartPercent: num(conv.addToCartPercent),
        cartToOrderPercent: num(conv.cartToOrderPercent),
        buyoutPercent: num(conv.buyoutPercent),
      });
    }

    if (items.length < FUNNEL_PAGE_LIMIT) break;
    offset += FUNNEL_PAGE_LIMIT;
  }

  return rows;
}

/**
 * Get sales funnel data from Analytics API (v3)
 */
export async function getSalesFunnel(input: GetSalesFunnelInput): Promise<{
  products: SalesFunnelData[];
  total: number;
  summary: {
    totalViews: number;
    totalCarts: number;
    totalOrders: number;
    totalOrdersSum: number;
    totalBuyouts: number;
    totalBuyoutsSum: number;
    avgConversion: number;
    avgBuyoutRate: number;
  };
}> {
  const { nmIds, dateFrom, dateTo } = input;
  const rows = await fetchSalesFunnel(dateFrom, dateTo, nmIds);

  const products: SalesFunnelData[] = rows.map((r) => ({
    nmId: r.nmId,
    vendorCode: r.vendorCode,
    brandName: r.brandName,
    objectName: r.subjectName,
    openCardCount: r.openCount,
    addToCartCount: r.cartCount,
    ordersCount: r.orderCount,
    ordersSumRub: r.orderSum,
    buyoutsCount: r.buyoutCount,
    buyoutsSumRub: r.buyoutSum,
    cancelCount: r.cancelCount,
    cancelSumRub: r.cancelSum,
    conversions: {
      cardToCart: r.openCount > 0 ? (r.cartCount / r.openCount) * 100 : 0,
      cartToOrder: r.cartCount > 0 ? (r.orderCount / r.cartCount) * 100 : 0,
      orderToBuyout: r.orderCount > 0 ? (r.buyoutCount / r.orderCount) * 100 : 0,
    },
  }));

  // Calculate summary
  const totalViews = products.reduce((sum, p) => sum + p.openCardCount, 0);
  const totalCarts = products.reduce((sum, p) => sum + p.addToCartCount, 0);
  const totalOrders = products.reduce((sum, p) => sum + p.ordersCount, 0);
  const totalOrdersSum = products.reduce((sum, p) => sum + p.ordersSumRub, 0);
  const totalBuyouts = products.reduce((sum, p) => sum + p.buyoutsCount, 0);
  const totalBuyoutsSum = products.reduce((sum, p) => sum + p.buyoutsSumRub, 0);

  const avgConversion = totalViews > 0 ? (totalOrders / totalViews) * 100 : 0;
  const avgBuyoutRate = totalOrders > 0 ? (totalBuyouts / totalOrders) * 100 : 0;

  await logRead('wb_get_sales_funnel', 'analytics', input, {
    count: products.length,
    totalViews,
    totalOrders,
    totalBuyouts,
  });

  return {
    products,
    total: products.length,
    summary: {
      totalViews,
      totalCarts,
      totalOrders,
      totalOrdersSum,
      totalBuyouts,
      totalBuyoutsSum,
      avgConversion: Math.round(avgConversion * 100) / 100,
      avgBuyoutRate: Math.round(avgBuyoutRate * 100) / 100,
    },
  };
}

/**
 * Format seller info as markdown
 */
export function formatSellerInfoAsMarkdown(info: SellerInfo): string {
  return [
    '## Информация о продавце',
    '',
    `**Название:** ${info.name}`,
    `**ID продавца:** ${info.sid}`,
    info.tradeMark ? `**Торговая марка:** ${info.tradeMark}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Format sales funnel as markdown with visual charts
 */
export function formatSalesFunnelAsMarkdown(
  products: SalesFunnelData[],
  summary: {
    totalViews: number;
    totalCarts: number;
    totalOrders: number;
    totalOrdersSum: number;
    totalBuyouts: number;
    totalBuyoutsSum: number;
    avgConversion: number;
    avgBuyoutRate: number;
  }
): string {
  const lines: string[] = [];

  // Funnel visualization
  lines.push('## Воронка продаж\n');

  const stages: FunnelStage[] = [
    { name: 'Просмотры', value: summary.totalViews },
    { name: 'Корзина', value: summary.totalCarts },
    { name: 'Заказы', value: summary.totalOrders },
    { name: 'Выкупы', value: summary.totalBuyouts },
  ];

  lines.push('```');
  lines.push(funnelChart(stages, 25));
  lines.push('```');
  lines.push('');

  // Conversion analysis
  lines.push('## Конверсии\n');

  const viewToCart = summary.totalViews > 0 ? (summary.totalCarts / summary.totalViews) * 100 : 0;
  const cartToOrder = summary.totalCarts > 0 ? (summary.totalOrders / summary.totalCarts) * 100 : 0;
  const orderToBuyout = summary.totalOrders > 0 ? (summary.totalBuyouts / summary.totalOrders) * 100 : 0;

  lines.push(`- Просмотр → Корзина: ${conversionStatus(viewToCart, 3, 7)}`);
  lines.push(`- Корзина → Заказ: ${conversionStatus(cartToOrder, 50, 70)}`);
  lines.push(`- Заказ → Выкуп: ${conversionStatus(orderToBuyout, 70, 85)}`);
  lines.push('');

  // Financial summary
  lines.push('## Финансы\n');
  lines.push(`- **Сумма заказов:** ${formatRub(summary.totalOrdersSum)}`);
  lines.push(`- **Сумма выкупов:** ${formatRub(summary.totalBuyoutsSum)}`);
  if (summary.totalOrdersSum > 0) {
    const lostRevenue = summary.totalOrdersSum - summary.totalBuyoutsSum;
    const lostPercent = (lostRevenue / summary.totalOrdersSum) * 100;
    lines.push(`- **Потери (отмены/возвраты):** ${formatRub(lostRevenue)} (${formatPercent(lostPercent)})`);
  }
  lines.push('');

  // Product table
  lines.push('## По товарам\n');
  lines.push('| nmId | Просмотры | Корзина | Заказы | Выкупы | CR | Выкуп |');
  lines.push('|------|-----------|---------|--------|--------|-----|-------|');

  for (const p of products.slice(0, 30)) {
    const cr = formatPercent(p.conversions.cardToCart);
    const buyoutRate = formatPercent(p.conversions.orderToBuyout);
    lines.push(
      `| ${p.nmId} | ${formatNumber(p.openCardCount)} | ${formatNumber(p.addToCartCount)} | ${formatNumber(p.ordersCount)} | ${formatNumber(p.buyoutsCount)} | ${cr} | ${buyoutRate} |`
    );
  }

  if (products.length > 30) {
    lines.push(`\n*... и ещё ${products.length - 30} товаров*`);
  }

  lines.push(`\n**Всего товаров:** ${products.length}`);

  return lines.join('\n');
}
