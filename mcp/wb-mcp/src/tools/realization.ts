/**
 * Realization Report tools for Wildberries MCP
 * Отчёт о реализации с полной пагинацией
 * API хранит данные с 29 января 2024
 */

import { z } from 'zod';
import { logRead } from '../utils/logger.js';
import { fetchRealizationDetail } from './finance-report.js';

// ==================== Input Schemas ====================

export const GetRealizationReportInputSchema = z.object({
  dateFrom: z.string().describe('Дата начала (YYYY-MM-DD). Данные доступны с 2024-01-29.'),
  dateTo: z.string().optional().describe('Дата конца (YYYY-MM-DD). Если не указана, получаем до сегодня.'),
  limit: z.number().optional().default(100000).describe('Максимальное количество записей (по умолчанию 100000)'),
});

export type GetRealizationReportInput = z.infer<typeof GetRealizationReportInputSchema>;

// ==================== Interfaces ====================

// API возвращает поля в snake_case
export interface RealizationData {
  realizationreport_id: number;
  date_from: string;
  date_to: string;
  create_dt: string;
  suppliercontract_code: string | null;
  rrd_id: number;
  gi_id: number;
  subject_name: string;
  nm_id: number;
  brand_name: string;
  sa_name: string; // supplierArticle
  ts_name: string; // techSize
  barcode: string;
  doc_type_name: string;
  quantity: number;
  retail_price: number;
  retail_amount: number;
  sale_percent: number;
  commission_percent: number;
  office_name: string;
  supplier_oper_name: string;
  order_dt: string;
  sale_dt: string;
  rr_dt: string;
  shk_id: number;
  retail_price_withdisc_rub: number;
  delivery_amount: number;
  return_amount: number;
  delivery_rub: number;
  gi_box_type_name: string;
  product_discount_for_report: number;
  supplier_promo: number;
  rid: number;
  ppvz_spp_prc: number;
  ppvz_kvw_prc_base: number;
  ppvz_kvw_prc: number;
  ppvz_sales_commission: number;
  ppvz_for_pay: number;
  ppvz_reward: number;
  ppvz_vw: number;
  ppvz_vw_nds: number;
  ppvz_office_id: number;
  ppvz_office_name: string;
  ppvz_supplier_id: number;
  ppvz_supplier_name: string;
  ppvz_inn: string;
  declaration_number: string;
  sticker_id: string;
  bonus_type_name?: string;
  srid: string;
}

export interface ProductSummary {
  nmId: number;
  supplierArticle: string;
  subjectName: string;
  brandName: string;
  salesCount: number;
  returnsCount: number;
  totalRetailAmount: number;
  totalReturnAmount: number;
  netRetailAmount: number; // Чистая сумма (продажи - возвраты) для НПД
  totalForPay: number;
  totalCommission: number;
  totalDelivery: number;
  avgPrice: number;
  avgCommissionPercent: number;
}

export interface RealizationSummary {
  totalRecords: number;
  totalSales: number;
  totalReturns: number;
  totalRetailAmount: number;
  totalReturnAmount: number;
  netRetailAmount: number; // Чистая сумма (продажи - возвраты) для НПД
  totalForPay: number;
  totalCommission: number;
  totalDelivery: number;
  periodFrom: string;
  periodTo: string;
  uniqueProducts: number;
}

// ==================== Functions ====================

/**
 * Получить отчёт о реализации с полной пагинацией
 * API возвращает до 100000 строк за запрос
 * Пагинация через rrdid - ID последней записи
 */
export async function getRealizationReport(input: GetRealizationReportInput): Promise<{
  records: RealizationData[];
  products: ProductSummary[];
  summary: RealizationSummary;
}> {
  const { dateFrom, dateTo, limit } = input;
  const endDate = dateTo || new Date().toISOString().split('T')[0];

  // Детализация из нового finance-api (reportDetailByPeriod удалён WB); пагинация по rrdId
  // внутри, строки уже в прежней snake_case-форме. Страница — до 100 000 строк, поэтому
  // потолок в 5 запросов с запасом покрывает любой период магазина и бережёт суточную квоту.
  const { rows: records } = await fetchRealizationDetail({ dateFrom, dateTo: endDate, limit, maxPages: 5 });

  // Группируем по товарам (API возвращает snake_case)
  const productMap = new Map<number, {
    nmId: number;
    supplierArticle: string;
    subjectName: string;
    brandName: string;
    sales: RealizationData[];
    returns: RealizationData[];
  }>();

  for (const r of records) {
    const existing = productMap.get(r.nm_id) || {
      nmId: r.nm_id,
      supplierArticle: r.sa_name || '',
      subjectName: r.subject_name || '',
      brandName: r.brand_name || '',
      sales: [],
      returns: [],
    };

    // Определяем тип операции по doc_type_name или quantity
    if (r.doc_type_name === 'Возврат' || r.quantity < 0 || r.return_amount > 0) {
      existing.returns.push(r);
    } else {
      existing.sales.push(r);
    }

    productMap.set(r.nm_id, existing);
  }

  // Формируем summary по товарам (API возвращает snake_case)
  const products: ProductSummary[] = Array.from(productMap.values()).map(p => {
    const allItems = [...p.sales, ...p.returns];
    const salesOnly = p.sales;
    const returnsOnly = p.returns;

    // Сумма продаж
    const salesAmount = salesOnly.reduce((sum, r) => sum + (r.retail_amount || 0), 0);
    // Сумма возвратов (берём retail_amount или return_amount)
    const returnAmount = returnsOnly.reduce((sum, r) => {
      // Для возвратов API может использовать return_amount или retail_amount
      return sum + (r.return_amount || r.retail_amount || 0);
    }, 0);

    return {
      nmId: p.nmId,
      supplierArticle: p.supplierArticle,
      subjectName: p.subjectName,
      brandName: p.brandName,
      salesCount: salesOnly.length,
      returnsCount: returnsOnly.length,
      totalRetailAmount: salesAmount,
      totalReturnAmount: returnAmount,
      netRetailAmount: salesAmount - returnAmount, // Чистая сумма для НПД
      totalForPay: allItems.reduce((sum, r) => sum + (r.ppvz_for_pay || 0), 0),
      totalCommission: allItems.reduce((sum, r) => sum + (r.ppvz_sales_commission || 0), 0),
      totalDelivery: allItems.reduce((sum, r) => sum + (r.delivery_rub || 0), 0),
      avgPrice: salesOnly.length > 0
        ? Math.round(salesOnly.reduce((sum, r) => sum + (r.retail_price_withdisc_rub || 0), 0) / salesOnly.length)
        : 0,
      avgCommissionPercent: salesOnly.length > 0
        ? Math.round(salesOnly.reduce((sum, r) => sum + (r.commission_percent || 0), 0) / salesOnly.length * 100) / 100
        : 0,
    };
  }).sort((a, b) => b.totalForPay - a.totalForPay);

  // Общая сводка (API возвращает snake_case)
  const sales = records.filter(r => r.doc_type_name !== 'Возврат' && r.quantity >= 0 && !r.return_amount);
  const returns = records.filter(r => r.doc_type_name === 'Возврат' || r.quantity < 0 || r.return_amount > 0);

  // Сумма продаж
  const totalSalesAmount = sales.reduce((sum, r) => sum + (r.retail_amount || 0), 0);
  // Сумма возвратов (берём return_amount или retail_amount)
  const totalReturnAmount = returns.reduce((sum, r) => sum + (r.return_amount || r.retail_amount || 0), 0);

  const summary: RealizationSummary = {
    totalRecords: records.length,
    totalSales: sales.length,
    totalReturns: returns.length,
    totalRetailAmount: totalSalesAmount,
    totalReturnAmount: totalReturnAmount,
    netRetailAmount: totalSalesAmount - totalReturnAmount, // Чистая сумма для НПД
    totalForPay: records.reduce((sum, r) => sum + (r.ppvz_for_pay || 0), 0),
    totalCommission: records.reduce((sum, r) => sum + (r.ppvz_sales_commission || 0), 0),
    totalDelivery: records.reduce((sum, r) => sum + (r.delivery_rub || 0), 0),
    periodFrom: dateFrom,
    periodTo: endDate,
    uniqueProducts: productMap.size,
  };

  await logRead('wb_get_realization_report', 'realization', input, {
    count: records.length,
    uniqueProducts: summary.uniqueProducts,
    totalForPay: summary.totalForPay,
  });

  return {
    records,
    products,
    summary,
  };
}

// ==================== Formatters ====================

/**
 * Форматировать отчёт о реализации как Markdown
 */
export function formatRealizationReportAsMarkdown(
  products: ProductSummary[],
  summary: RealizationSummary
): string {
  const lines: string[] = [
    '## Отчёт о реализации Wildberries',
    '',
    `**Период:** ${summary.periodFrom} — ${summary.periodTo}`,
    '',
    '### Сводка',
    '',
    '| Показатель | Значение |',
    '|------------|----------|',
    `| Всего записей | ${summary.totalRecords.toLocaleString('ru-RU')} |`,
    `| Продажи (шт) | ${summary.totalSales.toLocaleString('ru-RU')} |`,
    `| Возвраты (шт) | ${summary.totalReturns.toLocaleString('ru-RU')} |`,
    `| Сумма продаж | ${summary.totalRetailAmount.toLocaleString('ru-RU')} ₽ |`,
    `| Сумма возвратов | ${summary.totalReturnAmount.toLocaleString('ru-RU')} ₽ |`,
    `| **Чистая сумма (для НПД)** | **${summary.netRetailAmount.toLocaleString('ru-RU')} ₽** |`,
    `| К перечислению | ${summary.totalForPay.toLocaleString('ru-RU')} ₽ |`,
    `| Комиссия WB | ${summary.totalCommission.toLocaleString('ru-RU')} ₽ |`,
    `| Логистика | ${summary.totalDelivery.toLocaleString('ru-RU')} ₽ |`,
    `| Уникальных товаров | ${summary.uniqueProducts} |`,
    '',
  ];

  if (products.length > 0) {
    lines.push('### Товары по выручке');
    lines.push('');
    lines.push('| nmId | Артикул | Категория | Продаж | Возвратов | К выплате | Ср. цена | Комиссия % |');
    lines.push('|------|---------|-----------|--------|-----------|-----------|----------|------------|');

    for (const p of products.slice(0, 100)) {
      const articleStr = p.supplierArticle || '';
      const article = articleStr.length > 15
        ? articleStr.substring(0, 12) + '...'
        : articleStr;
      const catStr = p.subjectName || '';
      const cat = catStr.length > 20
        ? catStr.substring(0, 17) + '...'
        : catStr;

      lines.push(
        `| ${p.nmId} | ${article} | ${cat} | ${p.salesCount} | ${p.returnsCount} | ${p.totalForPay.toLocaleString('ru-RU')} ₽ | ${p.avgPrice.toLocaleString('ru-RU')} ₽ | ${p.avgCommissionPercent}% |`
      );
    }

    if (products.length > 100) {
      lines.push(`\n... и ещё ${products.length - 100} товаров`);
    }

    // Группируем по категориям
    const categoryStats = new Map<string, {
      category: string;
      sales: number;
      forPay: number;
      products: number;
    }>();

    for (const p of products) {
      const existing = categoryStats.get(p.subjectName) || {
        category: p.subjectName,
        sales: 0,
        forPay: 0,
        products: 0,
      };
      existing.sales += p.salesCount;
      existing.forPay += p.totalForPay;
      existing.products += 1;
      categoryStats.set(p.subjectName, existing);
    }

    const sortedCategories = Array.from(categoryStats.values())
      .sort((a, b) => b.forPay - a.forPay);

    lines.push('');
    lines.push('### По категориям');
    lines.push('');
    lines.push('| Категория | Товаров | Продаж | К выплате |');
    lines.push('|-----------|---------|--------|-----------|');

    for (const c of sortedCategories) {
      const catStr = c.category || '';
      const cat = catStr.length > 30
        ? catStr.substring(0, 27) + '...'
        : catStr;
      lines.push(
        `| ${cat} | ${c.products} | ${c.sales} | ${c.forPay.toLocaleString('ru-RU')} ₽ |`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Форматировать таблицу для заполнения себестоимости
 */
export function formatCostPriceTableAsMarkdown(products: ProductSummary[]): string {
  const lines: string[] = [
    '## Таблица для заполнения себестоимости',
    '',
    '> Заполните колонку "Себестоимость" для расчёта маржинальности',
    '',
    '| nmId | Артикул | Название | Ср. цена продажи | Продаж | К выплате | **Себестоимость** |',
    '|------|---------|----------|------------------|--------|-----------|-------------------|',
  ];

  for (const p of products) {
    const articleStr = p.supplierArticle || '';
    const article = articleStr.length > 20
      ? articleStr.substring(0, 17) + '...'
      : articleStr;
    const nameStr = p.subjectName || '';
    const name = nameStr.length > 25
      ? nameStr.substring(0, 22) + '...'
      : nameStr;

    lines.push(
      `| ${p.nmId} | ${article} | ${name} | ${p.avgPrice.toLocaleString('ru-RU')} ₽ | ${p.salesCount} | ${p.totalForPay.toLocaleString('ru-RU')} ₽ | ___ ₽ |`
    );
  }

  return lines.join('\n');
}
