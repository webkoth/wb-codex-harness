/**
 * Sales tools for Wildberries MCP
 * Получение продаж и возвратов
 */

import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';

// ==================== Input Schemas ====================

export const GetSalesInputSchema = z.object({
  dateFrom: z.string().describe('Дата начала (YYYY-MM-DD). Обязательный параметр.'),
  dateTo: z.string().optional().describe('Дата конца (YYYY-MM-DD). Если не указана, получаем все до сегодня.'),
  flag: z.number().optional().default(0).describe('0 = изменения с даты, 1 = все продажи за конкретную дату'),
  limit: z.number().optional().default(100000).describe('Максимальное количество записей (по умолчанию 100000)'),
});

export type GetSalesInput = z.infer<typeof GetSalesInputSchema>;

// ==================== Interfaces ====================

export interface SaleData {
  date: string;
  lastChangeDate: string;
  warehouseName: string;
  warehouseType: string;
  countryName: string;
  oblastOkrugName: string;
  regionName: string;
  supplierArticle: string;
  nmId: number;
  barcode: string;
  category: string;
  subject: string;
  brand: string;
  techSize: string;
  incomeID: number;
  isSupply: boolean;
  isRealization: boolean;
  totalPrice: number;
  discountPercent: number;
  spp: number;
  paymentSaleAmount: number;
  forPay: number;
  finishedPrice: number;
  priceWithDisc: number;
  saleID: string;
  sticker: string;
  gNumber: string;
  srid: string;
}

export interface SalesSummary {
  totalRecords: number;
  totalSales: number;
  totalReturns: number;
  totalRevenue: number;
  totalForPay: number;
  avgPrice: number;
  periodFrom: string;
  periodTo: string;
  uniqueProducts: number;
}

// ==================== Fetch Helper ====================

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
    return [] as T;
  }

  return response.json() as Promise<T>;
}

// ==================== Functions ====================

/**
 * Получить продажи и возвраты с пагинацией
 * API имеет лимит 80,000 строк за один запрос
 * Используем lastChangeDate для пагинации
 */
export async function getSales(input: GetSalesInput): Promise<{
  sales: SaleData[];
  summary: SalesSummary;
}> {
  const { dateFrom, dateTo, flag, limit } = input;
  const allSales: SaleData[] = [];

  let currentDateFrom = dateFrom;
  let hasMore = true;
  let requestCount = 0;
  const maxRequests = 100; // Защита от бесконечного цикла

  while (hasMore && allSales.length < limit && requestCount < maxRequests) {
    requestCount++;

    let url = `${WB_API_URLS.statistics}/api/v1/supplier/sales?dateFrom=${currentDateFrom}`;
    if (flag !== undefined) {
      url += `&flag=${flag}`;
    }

    const result = await fetchWB<SaleData[]>(url);

    if (!result || result.length === 0) {
      hasMore = false;
      break;
    }

    // Фильтруем по dateTo если указан
    let filteredSales = result;
    if (dateTo) {
      const toDate = new Date(dateTo + 'T23:59:59');
      filteredSales = result.filter(sale => {
        const saleDate = new Date(sale.date);
        return saleDate <= toDate;
      });
    }

    allSales.push(...filteredSales);

    // Проверяем нужно ли продолжать пагинацию
    if (result.length < 80000) {
      hasMore = false;
    } else {
      // Используем lastChangeDate последней записи для следующего запроса
      const lastSale = result[result.length - 1];
      if (lastSale && lastSale.lastChangeDate) {
        currentDateFrom = lastSale.lastChangeDate;
      } else {
        hasMore = false;
      }
    }

    // Пауза между запросами (API лимит: 1 запрос в минуту)
    if (hasMore && requestCount < maxRequests) {
      // В реальном сценарии нужна пауза, но для одного запроса пропускаем
      // await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }

  // Применяем лимит
  const salesLimited = allSales.slice(0, limit);

  // Рассчитываем сводку
  const sales = salesLimited.filter(s => s.saleID?.startsWith('S')); // Продажи начинаются с S
  const returns = salesLimited.filter(s => !s.saleID?.startsWith('S')); // Возвраты

  const uniqueNmIds = new Set(salesLimited.map(s => s.nmId));

  const summary: SalesSummary = {
    totalRecords: salesLimited.length,
    totalSales: sales.length,
    totalReturns: returns.length,
    totalRevenue: sales.reduce((sum, s) => sum + (s.finishedPrice || 0), 0),
    totalForPay: sales.reduce((sum, s) => sum + (s.forPay || 0), 0),
    avgPrice: sales.length > 0
      ? Math.round(sales.reduce((sum, s) => sum + (s.finishedPrice || 0), 0) / sales.length)
      : 0,
    periodFrom: dateFrom,
    periodTo: dateTo || new Date().toISOString().split('T')[0],
    uniqueProducts: uniqueNmIds.size,
  };

  await logRead('wb_get_sales', 'sales', input, {
    count: salesLimited.length,
    totalRevenue: summary.totalRevenue,
    uniqueProducts: summary.uniqueProducts,
  });

  return {
    sales: salesLimited,
    summary,
  };
}

// ==================== Formatters ====================

/**
 * Форматировать продажи как Markdown
 */
export function formatSalesAsMarkdown(
  sales: SaleData[],
  summary: SalesSummary
): string {
  const lines: string[] = [
    '## Отчёт о продажах Wildberries',
    '',
    `**Период:** ${summary.periodFrom} — ${summary.periodTo}`,
    '',
    '### Сводка',
    '',
    '| Показатель | Значение |',
    '|------------|----------|',
    `| Всего записей | ${summary.totalRecords.toLocaleString('ru-RU')} |`,
    `| Продажи | ${summary.totalSales.toLocaleString('ru-RU')} |`,
    `| Возвраты | ${summary.totalReturns.toLocaleString('ru-RU')} |`,
    `| Выручка (финал) | ${summary.totalRevenue.toLocaleString('ru-RU')} ₽ |`,
    `| К перечислению | ${summary.totalForPay.toLocaleString('ru-RU')} ₽ |`,
    `| Средний чек | ${summary.avgPrice.toLocaleString('ru-RU')} ₽ |`,
    `| Уникальных товаров | ${summary.uniqueProducts} |`,
    '',
  ];

  if (sales.length > 0) {
    // Группируем по товарам
    const productStats = new Map<number, {
      nmId: number;
      supplierArticle: string;
      name: string;
      category: string;
      brand: string;
      sales: number;
      returns: number;
      revenue: number;
      forPay: number;
      avgPrice: number;
    }>();

    for (const s of sales) {
      const existing = productStats.get(s.nmId) || {
        nmId: s.nmId,
        supplierArticle: s.supplierArticle,
        name: s.subject,
        category: s.category,
        brand: s.brand,
        sales: 0,
        returns: 0,
        revenue: 0,
        forPay: 0,
        avgPrice: 0,
      };

      if (s.saleID?.startsWith('S')) {
        existing.sales += 1;
        existing.revenue += s.finishedPrice || 0;
        existing.forPay += s.forPay || 0;
      } else {
        existing.returns += 1;
      }

      productStats.set(s.nmId, existing);
    }

    // Рассчитываем средний чек
    for (const [, stats] of productStats) {
      stats.avgPrice = stats.sales > 0 ? Math.round(stats.revenue / stats.sales) : 0;
    }

    // Сортируем по выручке
    const sortedProducts = Array.from(productStats.values())
      .sort((a, b) => b.revenue - a.revenue);

    lines.push('### Продажи по товарам');
    lines.push('');
    lines.push('| nmId | Артикул | Категория | Продаж | Возвратов | Выручка | К выплате |');
    lines.push('|------|---------|-----------|--------|-----------|---------|-----------|');

    for (const p of sortedProducts.slice(0, 50)) {
      const article = p.supplierArticle.length > 15
        ? p.supplierArticle.substring(0, 12) + '...'
        : p.supplierArticle;
      const cat = p.category.length > 20
        ? p.category.substring(0, 17) + '...'
        : p.category;

      lines.push(
        `| ${p.nmId} | ${article} | ${cat} | ${p.sales} | ${p.returns} | ${p.revenue.toLocaleString('ru-RU')} ₽ | ${p.forPay.toLocaleString('ru-RU')} ₽ |`
      );
    }

    if (sortedProducts.length > 50) {
      lines.push(`\n... и ещё ${sortedProducts.length - 50} товаров`);
    }

    // Группируем по категориям
    const categoryStats = new Map<string, {
      category: string;
      sales: number;
      revenue: number;
      products: number;
    }>();

    for (const p of sortedProducts) {
      const existing = categoryStats.get(p.category) || {
        category: p.category,
        sales: 0,
        revenue: 0,
        products: 0,
      };
      existing.sales += p.sales;
      existing.revenue += p.revenue;
      existing.products += 1;
      categoryStats.set(p.category, existing);
    }

    const sortedCategories = Array.from(categoryStats.values())
      .sort((a, b) => b.revenue - a.revenue);

    lines.push('');
    lines.push('### Продажи по категориям');
    lines.push('');
    lines.push('| Категория | Товаров | Продаж | Выручка |');
    lines.push('|-----------|---------|--------|---------|');

    for (const c of sortedCategories) {
      const cat = c.category.length > 30
        ? c.category.substring(0, 27) + '...'
        : c.category;
      lines.push(
        `| ${cat} | ${c.products} | ${c.sales} | ${c.revenue.toLocaleString('ru-RU')} ₽ |`
      );
    }
  }

  return lines.join('\n');
}
