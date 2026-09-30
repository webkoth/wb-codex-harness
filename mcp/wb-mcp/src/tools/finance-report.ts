/**
 * Детализация отчёта о реализации WB из нового финансового API.
 *
 * `statistics-api /api/v5/supplier/reportDetailByPeriod` помечен deprecated и
 * по журналу изменений WB удаляется с 15 июля 2026 (docs/api-reference/openapi/
 * wildberries/13-finances.yaml). Замена — `finance-api
 * POST /api/finance/v1/sales-reports/detailed`: тело вместо query, поля в
 * camelCase, деньги — строками ("1234.56").
 *
 * Инструменты wb_get_payments и wb_get_realization_report исторически работают
 * со строками старого формата (snake_case, деньги числами). Чтобы не
 * переписывать их сводки и форматтеры, строки нового API переводятся в старую
 * форму здесь, в одном месте.
 *
 * Лимит на аккаунт продавца: персональный/сервисный токен — 1 запрос в минуту,
 * базовый — 2 запроса в сутки. Квота общая для всех программ на этом аккаунте
 * (в том числе finstock), поэтому на 429 не повторяем, а сразу отдаём ошибку
 * со сроком из X-Ratelimit-Retry.
 */

import { createWBHeaders } from '../utils/auth.js';

const FINANCE_API = 'https://finance-api.wildberries.ru';

/** Максимум строк на страницу по спецификации. */
export const FINANCE_DETAIL_PAGE_LIMIT = 100_000;

/** Строка детализации нового API (перечислены поля, которые переводятся в старую форму). */
export interface FinanceDetailRow {
  reportId: number;
  dateFrom: string;
  dateTo: string;
  createDate: string;
  rrdId: number | null;
  giId: number;
  subjectName: string;
  nmId: number;
  brandName: string;
  vendorCode: string;
  techSize: string;
  sku: string;
  docTypeName: string;
  quantity: number;
  retailPrice: string;
  retailAmount: string;
  salePercent: number;
  commissionPercent: number;
  officeName: string;
  sellerOperName: string;
  orderDt: string;
  saleDt: string;
  rrDate: string;
  shkId: number;
  retailPriceWithDisc: string;
  deliveryAmount: number;
  returnAmount: number;
  deliveryService: string;
  giBoxTypeName: string;
  productDiscountForReport: number;
  sellerPromo: string;
  spp: number;
  kvwBase: number;
  kvw: number;
  ppvzSalesCommission: string;
  forPay: string;
  ppvzReward: string;
  vw: string;
  vwNds: string;
  ppvzOfficeId: number;
  ppvzOfficeName: string;
  ppvzSupplierName: string;
  ppvzSupplierInn: string;
  declarationNumber: string;
  bonusTypeName?: string;
  stickerId: string;
  orderId: number;
  srid: string;
}

/** Строка в форме старого reportDetailByPeriod — её ждут сводки и форматтеры. */
export interface LegacyDetailRow {
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
  bonus_type_name?: string;
  sticker_id: string;
  srid: string;
}

/** Деньги нового API приходят строкой; пустое и нечисловое — ноль, как у старого API. */
function money(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toLegacyRow(r: FinanceDetailRow): LegacyDetailRow {
  return {
    realizationreport_id: r.reportId,
    date_from: r.dateFrom,
    date_to: r.dateTo,
    create_dt: r.createDate,
    suppliercontract_code: null, // в новом API поля нет
    rrd_id: r.rrdId ?? 0,
    gi_id: r.giId,
    subject_name: r.subjectName,
    nm_id: r.nmId,
    brand_name: r.brandName,
    sa_name: r.vendorCode,
    ts_name: r.techSize,
    barcode: r.sku,
    doc_type_name: r.docTypeName,
    quantity: r.quantity,
    retail_price: money(r.retailPrice),
    retail_amount: money(r.retailAmount),
    sale_percent: r.salePercent,
    commission_percent: r.commissionPercent,
    office_name: r.officeName,
    supplier_oper_name: r.sellerOperName,
    order_dt: r.orderDt,
    sale_dt: r.saleDt,
    rr_dt: r.rrDate,
    shk_id: r.shkId,
    retail_price_withdisc_rub: money(r.retailPriceWithDisc),
    delivery_amount: r.deliveryAmount,
    return_amount: r.returnAmount,
    delivery_rub: money(r.deliveryService),
    gi_box_type_name: r.giBoxTypeName,
    product_discount_for_report: r.productDiscountForReport,
    supplier_promo: money(r.sellerPromo),
    rid: r.orderId ?? 0, // старый rid (ID заказа) — ближайшее поле orderId
    ppvz_spp_prc: r.spp,
    ppvz_kvw_prc_base: r.kvwBase,
    ppvz_kvw_prc: r.kvw,
    ppvz_sales_commission: money(r.ppvzSalesCommission),
    ppvz_for_pay: money(r.forPay),
    ppvz_reward: money(r.ppvzReward),
    ppvz_vw: money(r.vw),
    ppvz_vw_nds: money(r.vwNds),
    ppvz_office_id: r.ppvzOfficeId,
    ppvz_office_name: r.ppvzOfficeName,
    ppvz_supplier_id: 0, // в новом API поля нет
    ppvz_supplier_name: r.ppvzSupplierName,
    ppvz_inn: r.ppvzSupplierInn,
    declaration_number: r.declarationNumber,
    bonus_type_name: r.bonusTypeName,
    sticker_id: r.stickerId,
    srid: r.srid,
  };
}

async function postDetailedPage(body: Record<string, unknown>): Promise<FinanceDetailRow[]> {
  const response = await fetch(`${FINANCE_API}/api/finance/v1/sales-reports/detailed`, {
    method: 'POST',
    headers: { ...createWBHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status === 204) return [];

  if (response.status === 429) {
    const retry = response.headers.get('X-Ratelimit-Retry');
    const wait = retry ? ` Повторить через ${retry} с.` : '';
    throw new Error(
      `WB finance-api 429: лимит детализации исчерпан (базовый токен — 2 запроса в сутки на аккаунт, квота общая с другими программами).${wait}`,
    );
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`WB finance-api ${response.status}: ${text.slice(0, 300)}`);
  if (!text.trim()) return [];

  const json = JSON.parse(text);
  if (!Array.isArray(json)) throw new Error(`WB finance-api вернул не массив: ${text.slice(0, 200)}`);
  return json as FinanceDetailRow[];
}

/**
 * Детализация за период в старой форме строк.
 *
 * Пагинация — по rrdId: следующая страница просит rrdId последней строки, у
 * которой он есть (сервисные строки могут идти без него). Курсор обязан строго
 * расти — иначе стоп, чтобы не жечь суточную квоту на повторы одной страницы.
 * `maxPages` ограничивает число запросов сверху.
 */
export async function fetchRealizationDetail(opts: {
  dateFrom: string;
  dateTo: string;
  limit?: number;
  maxPages?: number;
}): Promise<{ rows: LegacyDetailRow[]; requests: number }> {
  const want = opts.limit ?? FINANCE_DETAIL_PAGE_LIMIT;
  const pageLimit = Math.min(FINANCE_DETAIL_PAGE_LIMIT, Math.max(1, want));
  const maxPages = opts.maxPages ?? 20;
  const rows: LegacyDetailRow[] = [];
  let rrdId = 0;
  let requests = 0;

  while (rows.length < want && requests < maxPages) {
    requests++;
    const page = await postDetailedPage({
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      period: 'weekly',
      limit: pageLimit,
      rrdId,
    });
    if (page.length === 0) break;
    rows.push(...page.map(toLegacyRow));
    if (page.length < pageLimit) break;

    let next: number | null = null;
    for (let i = page.length - 1; i >= 0; i--) {
      const id = page[i]?.rrdId;
      if (id != null) { next = id; break; }
    }
    if (next == null || next <= rrdId) break;
    rrdId = next;
  }

  return { rows: rows.slice(0, want), requests };
}
