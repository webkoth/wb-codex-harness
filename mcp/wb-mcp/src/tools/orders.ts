import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';

// Input schema for wb_get_orders
export const GetOrdersInputSchema = z.object({
  dateFrom: z.string().optional().describe('Start date in YYYY-MM-DD format'),
  dateTo: z.string().optional().describe('End date in YYYY-MM-DD format'),
  status: z
    .enum(['waiting', 'sorted', 'sold', 'canceled', 'canceled_by_client', 'defect', 'ready_for_pickup'])
    .optional()
    .describe('Filter by order status'),
  limit: z.number().optional().default(100).describe('Maximum number of orders to return'),
});

export type GetOrdersInput = z.infer<typeof GetOrdersInputSchema>;

// Order data interface
interface OrderData {
  orderId: string;
  srid: string;
  nmId: number;
  vendorCode?: string;
  brand?: string;
  category?: string;
  techSize: string;
  barcode: string;
  quantity: number;
  totalPrice: number;
  discountPercent: number;
  priceWithDisc?: number; // цена со скидкой продавца — база для комиссии/выплаты
  finishedPrice?: number; // цена с СПП (для покупателя; поле «плавает» с текущим СПП)
  spp?: number; // СПП %, финансирует WB
  warehouseName: string;
  regionName: string;
  status: string;
  orderDate: string;
  cancelDate?: string;
  isCancel: boolean;
}

// Fetch helper
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
    throw new Error(`WB API Error ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Get orders from WB Statistics API
 */
export async function getOrders(input: GetOrdersInput): Promise<{
  orders: OrderData[];
  total: number;
  summary: {
    totalOrders: number;
    canceledOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
  };
}> {
  const { dateFrom, dateTo, status, limit } = input;

  // Default to last 7 days if no date specified
  const from = dateFrom || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let url = `${WB_API_URLS.statistics}/api/v1/supplier/orders?dateFrom=${from}`;

  if (dateTo) {
    url += `&dateTo=${dateTo}`;
  }

  const result = await fetchWB<
    Array<{
      orderId: string;
      srid: string;
      nmId: number;
      supplierArticle?: string;
      brand?: string;
      category?: string;
      techSize: string;
      barcode: string;
      quantity?: number;
      totalPrice: number;
      discountPercent: number;
      priceWithDisc?: number;
      finishedPrice?: number;
      spp?: number;
      warehouseName: string;
      regionName: string;
      orderType?: string;
      date: string;
      cancelDate?: string;
      isCancel: boolean;
    }>
  >(url);

  let orders: OrderData[] = (result || []).map((o) => ({
    orderId: o.orderId,
    srid: o.srid,
    nmId: o.nmId,
    vendorCode: o.supplierArticle,
    brand: o.brand,
    category: o.category,
    techSize: o.techSize,
    barcode: o.barcode,
    quantity: o.quantity || 1,
    totalPrice: o.totalPrice,
    discountPercent: o.discountPercent,
    priceWithDisc: o.priceWithDisc,
    finishedPrice: o.finishedPrice,
    spp: o.spp,
    warehouseName: o.warehouseName,
    regionName: o.regionName,
    status: o.isCancel ? 'canceled' : o.orderType || 'new',
    orderDate: o.date,
    cancelDate: o.cancelDate,
    isCancel: o.isCancel,
  }));

  // Filter by status if specified
  if (status) {
    orders = orders.filter((o) => {
      if (status === 'canceled') return o.isCancel;
      if (status === 'sold') return !o.isCancel;
      return o.status === status;
    });
  }

  // Apply limit
  orders = orders.slice(0, limit);

  // Calculate summary
  const totalOrders = orders.length;
  const canceledOrders = orders.filter((o) => o.isCancel).length;
  const totalRevenue = orders.filter((o) => !o.isCancel).reduce((sum, o) => sum + o.totalPrice, 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / (totalOrders - canceledOrders) : 0;

  await logRead('wb_get_orders', 'orders', input, {
    count: orders.length,
    totalRevenue,
    canceledOrders,
  });

  return {
    orders,
    total: orders.length,
    summary: {
      totalOrders,
      canceledOrders,
      totalRevenue,
      avgOrderValue: Math.round(avgOrderValue),
    },
  };
}

/**
 * Format orders as markdown
 */
export function formatOrdersAsMarkdown(
  orders: OrderData[],
  summary: { totalOrders: number; canceledOrders: number; totalRevenue: number; avgOrderValue: number }
): string {
  const lines: string[] = [
    '## Сводка по заказам',
    '',
    `| Показатель | Значение |`,
    `|------------|----------|`,
    `| Всего заказов | ${summary.totalOrders} |`,
    `| Отменённых | ${summary.canceledOrders} (${((summary.canceledOrders / summary.totalOrders) * 100).toFixed(1)}%) |`,
    `| Выручка | ${summary.totalRevenue.toLocaleString('ru-RU')}₽ |`,
    `| Средний чек | ${summary.avgOrderValue.toLocaleString('ru-RU')}₽ |`,
    '',
    '## Список заказов',
    '',
    '| Дата | nmId | Артикул | Сумма | Регион | Статус |',
    '|------|------|---------|-------|--------|--------|',
  ];

  for (const o of orders.slice(0, 50)) {
    const date = new Date(o.orderDate).toLocaleDateString('ru-RU');
    const status = o.isCancel ? '❌ Отмена' : '✅';
    const price = `${o.totalPrice.toLocaleString('ru-RU')}₽`;
    const region = o.regionName.substring(0, 15);

    lines.push(`| ${date} | ${o.nmId} | ${o.vendorCode || '-'} | ${price} | ${region} | ${status} |`);
  }

  if (orders.length > 50) {
    lines.push(`\n... и ещё ${orders.length - 50} заказов`);
  }

  return lines.join('\n');
}
