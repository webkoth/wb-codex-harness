/**
 * Finance tools for Wildberries MCP
 * Работа с балансом и выплатами
 */

import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';
import { fetchRealizationDetail } from './finance-report.js';

// ==================== Input Schemas ====================

export const GetBalanceInputSchema = z.object({}).strict();

export const GetPaymentsInputSchema = z.object({
  dateFrom: z.string().describe('Дата начала (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Дата конца (YYYY-MM-DD), по умолчанию сегодня'),
  limit: z.number().optional().default(100).describe('Максимальное количество записей'),
});

export type GetBalanceInput = z.infer<typeof GetBalanceInputSchema>;
export type GetPaymentsInput = z.infer<typeof GetPaymentsInputSchema>;

// ==================== Interfaces ====================

export interface BalanceData {
  balance: number;
  forWithdraw: number;
  currency: string;
  updatedAt: string;
}

// API возвращает поля в snake_case
export interface PaymentData {
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
  sa_name: string;
  ts_name: string;
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
  bonus_type_name?: string;
  sticker_id: string;
  srid: string;
}

export interface PaymentsSummary {
  totalRecords: number;
  totalForPay: number;
  totalRetailAmount: number;
  totalCommission: number;
  totalDelivery: number;
  totalReturns: number;
  periodFrom: string;
  periodTo: string;
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
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// ==================== Functions ====================

/**
 * Получить текущий баланс продавца
 */
export async function getBalance(_input: GetBalanceInput): Promise<{
  balance: BalanceData;
}> {
  // Баланс счёта продавца — Finance API
  // GET https://finance-api.wildberries.ru/api/v1/account/balance → { currency, current, for_withdraw }
  const url = `${WB_API_URLS.finance}/api/v1/account/balance`;

  const data = await fetchWB<{
    currency?: string;
    current?: number;
    for_withdraw?: number;
  }>(url);

  const result = {
    balance: {
      balance: data.current ?? 0,
      forWithdraw: data.for_withdraw ?? 0,
      currency: data.currency || 'RUB',
      updatedAt: new Date().toISOString(),
    },
  };

  await logRead('wb_get_balance', 'finance', {}, result.balance);

  return result;
}

/**
 * Получить отчёт о выплатах (Report Detail)
 */
export async function getPayments(input: GetPaymentsInput): Promise<{
  payments: PaymentData[];
  summary: PaymentsSummary;
}> {
  const { dateFrom, dateTo, limit } = input;

  // Детализация отчёта о реализации — новый finance-api (reportDetailByPeriod удалён WB),
  // одна страница размером limit, строки в прежней форме
  const { rows } = await fetchRealizationDetail({
    dateFrom,
    dateTo: dateTo || new Date().toISOString().split('T')[0],
    limit,
    maxPages: 1,
  });

  const payments: PaymentData[] = rows;

  // Рассчитываем сводку (API возвращает поля в snake_case)
  const summary: PaymentsSummary = {
    totalRecords: payments.length,
    totalForPay: payments.reduce((sum, p) => sum + (p.ppvz_for_pay || 0), 0),
    totalRetailAmount: payments.reduce((sum, p) => sum + (p.retail_amount || 0), 0),
    totalCommission: payments.reduce((sum, p) => sum + (p.ppvz_sales_commission || 0), 0),
    totalDelivery: payments.reduce((sum, p) => sum + (p.delivery_rub || 0), 0),
    totalReturns: payments.reduce((sum, p) => sum + (p.return_amount || 0), 0),
    periodFrom: dateFrom,
    periodTo: dateTo || new Date().toISOString().split('T')[0],
  };

  await logRead('wb_get_payments', 'finance', input, {
    count: payments.length,
    totalForPay: summary.totalForPay,
  });

  return {
    payments,
    summary,
  };
}

// ==================== Formatters ====================

/**
 * Форматировать баланс как Markdown
 */
export function formatBalanceAsMarkdown(balance: BalanceData): string {
  const lines: string[] = [
    '## Баланс Wildberries',
    '',
    `| Показатель | Значение |`,
    `|------------|----------|`,
    `| Баланс | ${balance.balance.toLocaleString('ru-RU')} ${balance.currency} |`,
    `| Обновлено | ${new Date(balance.updatedAt).toLocaleString('ru-RU')} |`,
    '',
    '> Для детальной информации о выплатах используйте `wb_get_payments`',
  ];

  return lines.join('\n');
}

/**
 * Форматировать выплаты как Markdown
 */
export function formatPaymentsAsMarkdown(
  payments: PaymentData[],
  summary: PaymentsSummary
): string {
  const lines: string[] = [
    '## Отчёт о выплатах Wildberries',
    '',
    `**Период:** ${summary.periodFrom} — ${summary.periodTo}`,
    '',
    '### Сводка',
    '',
    `| Показатель | Значение |`,
    `|------------|----------|`,
    `| Записей | ${summary.totalRecords} |`,
    `| К перечислению | ${summary.totalForPay.toLocaleString('ru-RU')} ₽ |`,
    `| Розничная сумма | ${summary.totalRetailAmount.toLocaleString('ru-RU')} ₽ |`,
    `| Комиссия WB | ${summary.totalCommission.toLocaleString('ru-RU')} ₽ |`,
    `| Логистика | ${summary.totalDelivery.toLocaleString('ru-RU')} ₽ |`,
    `| Возвраты | ${summary.totalReturns.toLocaleString('ru-RU')} ₽ |`,
    '',
  ];

  if (payments.length > 0) {
    // Группируем по отчётам (API возвращает поля в snake_case)
    const reportGroups = new Map<number, PaymentData[]>();
    for (const p of payments) {
      const existing = reportGroups.get(p.realizationreport_id) || [];
      existing.push(p);
      reportGroups.set(p.realizationreport_id, existing);
    }

    lines.push('### Отчёты о реализации');
    lines.push('');
    lines.push('| ID отчёта | Период | Записей | К перечислению |');
    lines.push('|-----------|--------|---------|----------------|');

    for (const [reportId, items] of reportGroups) {
      const first = items[0];
      const forPay = items.reduce((sum, p) => sum + (p.ppvz_for_pay || 0), 0);
      const period = `${first.date_from?.split('T')[0] || '-'} — ${first.date_to?.split('T')[0] || '-'}`;
      lines.push(`| ${reportId} | ${period} | ${items.length} | ${forPay.toLocaleString('ru-RU')} ₽ |`);
    }

    lines.push('');

    // Топ товаров по выручке
    const productSums = new Map<number, { name: string; article: string; amount: number; forPay: number }>();
    for (const p of payments) {
      const existing = productSums.get(p.nm_id) || { name: p.subject_name || '', article: p.sa_name || '', amount: 0, forPay: 0 };
      existing.amount += p.retail_amount || 0;
      existing.forPay += p.ppvz_for_pay || 0;
      productSums.set(p.nm_id, existing);
    }

    const topProducts = Array.from(productSums.entries())
      .sort((a, b) => b[1].forPay - a[1].forPay)
      .slice(0, 10);

    if (topProducts.length > 0) {
      lines.push('### Топ-10 товаров по выплатам');
      lines.push('');
      lines.push('| nmId | Артикул | Название | Розница | К перечислению |');
      lines.push('|------|---------|----------|---------|----------------|');

      for (const [nmId, data] of topProducts) {
        const articleStr = data.article || '';
        const article = articleStr.length > 20 ? articleStr.substring(0, 17) + '...' : articleStr;
        const nameStr = data.name || '';
        const name = nameStr.length > 25 ? nameStr.substring(0, 22) + '...' : nameStr;
        lines.push(`| ${nmId} | ${article} | ${name} | ${data.amount.toLocaleString('ru-RU')} ₽ | ${data.forPay.toLocaleString('ru-RU')} ₽ |`);
      }
    }
  }

  return lines.join('\n');
}
