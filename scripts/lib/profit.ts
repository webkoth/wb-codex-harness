/**
 * Прибыль по артикулу из детализации отчёта о реализации WB. Чистая функция — её покрывают тесты.
 *
 * Выплата WB («Итого к оплате») = к перечислению за продажи − за возвраты − логистика − хранение
 *   − приёмка − штрафы − удержания + доплаты − возмещение издержек по перевозке.
 * Прибыль до налогов по артикулу = его доля выплаты + удержание «ВБ.Продвижение» не считается
 *   (вместо него фактический расход рекламы по nmID из fullstats) − себестоимость проданных штук.
 * Эквайринг уже вычтен WB из «к перечислению», в отчёте он показан справочно.
 *
 * Строки без nmID (хранение, «Джем», удержания без товара) не размазываются по артикулам:
 * они идут в «не распределено». Хранение распределяется только при наличии отчёта
 * «Платное хранение» по nmID — пропорционально ему, итог остаётся равным сумме из реализации.
 */

export type Row = Record<string, unknown>;

const money = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v == null ? '' : String(v));

/** Удержание за рекламу WB: текст в bonusTypeName меняется, ловим по ключевым словам. */
export const isPromotionDeduction = (r: Row) =>
  /продвижени|реклам/i.test(str(r.bonusTypeName)) && money(r.deduction) !== 0;

export interface SkuProfit {
  vendorCode: string;
  nmId: number;
  title: string;
  subject: string;
  soldUnits: number;
  returnedUnits: number;
  netUnits: number;
  revenue: number;        // retailPriceWithDisc продажи − возвраты (цена продавца со скидкой, до СПП)
  forPay: number;         // к перечислению за товар, нетто
  logistics: number;
  storage: number;
  acceptance: number;
  penalty: number;
  deduction: number;      // удержания по артикулу, кроме рекламы
  additional: number;
  rebill: number;
  acquiring: number;      // справочно, уже внутри forPay
  payout: number;         // доля «Итого к оплате»
  ads: number;
  unitCost: number;
  cogs: number;
  profit: number;         // до налогов
  margin: number;         // прибыль / выручка
  profitPerUnit: number;  // на выкупленную штуку
  orders?: number;
  buyouts?: number;
  buyoutRate?: number;
  profitPerOrder?: number;
  cpoMax?: number;        // потолок цены заказа из рекламы: прибыль на выкуп до рекламы × доля выкупа
}

export interface ProfitInput {
  rows: Row[];
  costs: Map<string, number>;
  /** Фактический расход рекламы по nmID (fullstats). undefined — рекламу не получили. */
  adsByNm?: Map<number, number>;
  /** Платное хранение по nmID из отчёта paid_storage — только доли для распределения. */
  storageByNm?: Map<number, number>;
  /** Воронка: заказы и выкупы по nmID для прибыли на заказ. */
  funnelByNm?: Map<number, { orders: number; buyouts: number }>;
}

export interface Unallocated { label: string; amount: number }

export interface ProfitResult {
  skus: SkuProfit[];
  unallocated: Unallocated[];
  totals: {
    payout: number;           // «Итого к оплате» по формуле из всех строк
    payoutCheck: number;      // Σ по артикулам + не распределено — должно совпасть
    promotionInReport: number;
    adsFullstats: number;
    storageReport: number;
    cogs: number;
    profit: number;           // Σ прибыли по артикулам + не распределено (без рекламы из отчёта) − реклама
  };
  missingCost: { vendorCode: string; nmId: number; netUnits: number }[];
  warnings: string[];
}

export function computeProfit(input: ProfitInput): ProfitResult {
  const skus = new Map<string, SkuProfit>();
  const unalloc = new Map<string, number>();
  const warnings: string[] = [];
  let payout = 0;
  let promotionInReport = 0;
  let storageReport = 0;

  const addUnalloc = (label: string, amount: number) => {
    if (Math.abs(amount) < 0.005) return;
    unalloc.set(label, (unalloc.get(label) ?? 0) + amount);
  };

  const sku = (r: Row): SkuProfit | undefined => {
    const nmId = Number(r.nmId) || 0;
    const vendorCode = str(r.vendorCode).trim();
    if (!nmId || !vendorCode) return undefined;
    let s = skus.get(vendorCode);
    if (!s) {
      s = {
        vendorCode, nmId, title: str(r.title), subject: str(r.subjectName),
        soldUnits: 0, returnedUnits: 0, netUnits: 0, revenue: 0, forPay: 0, logistics: 0, storage: 0,
        acceptance: 0, penalty: 0, deduction: 0, additional: 0, rebill: 0, acquiring: 0, payout: 0,
        ads: 0, unitCost: 0, cogs: 0, profit: 0, margin: 0, profitPerUnit: 0,
      };
      skus.set(vendorCode, s);
    }
    if (!s.title && r.title) s.title = str(r.title);
    return s;
  };

  for (const r of input.rows) {
    const doc = str(r.docTypeName);
    const oper = str(r.sellerOperName);
    const sign = doc === 'Возврат' ? -1 : 1;
    const forPay = money(r.forPay) * sign;
    const retail = money(r.retailPriceWithDisc) * sign;
    const acquiring = money(r.acquiringFee) * sign;
    const logistics = money(r.deliveryService);
    const storage = money(r.paidStorage);
    const acceptance = money(r.paidAcceptance);
    const penalty = money(r.penalty);
    const deduction = money(r.deduction);
    const additional = money(r.additionalPayment);
    const rebill = money(r.rebillLogisticCost);
    const rowPayout = forPay - logistics - storage - acceptance - penalty - deduction + additional - rebill;
    payout += rowPayout;
    storageReport += storage;

    const promo = isPromotionDeduction(r);
    if (promo) promotionInReport += deduction;

    const s = sku(r);
    if (!s) {
      // строка без товара: раскладываем сумму по статьям, чтобы было видно, что в ней
      if (forPay) addUnalloc(`К перечислению без артикула (${oper || doc})`, forPay);
      if (logistics) addUnalloc('Логистика без артикула', -logistics);
      if (storage) addUnalloc('Хранение (без артикула в отчёте)', -storage);
      if (acceptance) addUnalloc('Приёмка без артикула', -acceptance);
      if (penalty) addUnalloc(`Штрафы без артикула${r.bonusTypeName ? `: ${str(r.bonusTypeName).slice(0, 60)}` : ''}`, -penalty);
      if (deduction) addUnalloc(promo ? 'Реклама «ВБ.Продвижение» (удержание)' : `Удержание: ${str(r.bonusTypeName).slice(0, 70) || oper}`, -deduction);
      if (additional) addUnalloc('Доплаты без артикула', additional);
      if (rebill) addUnalloc('Возмещение издержек по перевозке без артикула', -rebill);
      continue;
    }
    if (oper === 'Продажа' && doc === 'Продажа') s.soldUnits += Number(r.quantity) || 0;
    if (oper === 'Возврат' && doc === 'Возврат') s.returnedUnits += Number(r.quantity) || 0;
    s.forPay += forPay;
    s.revenue += retail;
    s.acquiring += acquiring;
    s.logistics += logistics;
    s.storage += storage;
    s.acceptance += acceptance;
    s.penalty += penalty;
    if (promo) addUnalloc('Реклама «ВБ.Продвижение» (удержание)', -deduction);
    else s.deduction += deduction;
    s.additional += additional;
    s.rebill += rebill;
  }

  // Хранение: сумма из отчёта о реализации, доли — из отчёта «Платное хранение» по nmID
  const storageUnalloc = -(unalloc.get('Хранение (без артикула в отчёте)') ?? 0);
  if (storageUnalloc > 0 && input.storageByNm && input.storageByNm.size > 0) {
    const byNm = new Map([...skus.values()].map((s) => [s.nmId, s]));
    const base = [...input.storageByNm].filter(([nm]) => byNm.has(nm));
    const total = base.reduce((a, [, v]) => a + v, 0);
    if (total > 0) {
      for (const [nm, v] of base) byNm.get(nm)!.storage += (storageUnalloc * v) / total;
      unalloc.delete('Хранение (без артикула в отчёте)');
      const outside = [...input.storageByNm].filter(([nm]) => !byNm.has(nm)).reduce((a, [, v]) => a + v, 0);
      if (outside > 0) warnings.push(`Хранение ${outside.toFixed(0)} ₽ по отчёту paid_storage приходится на артикулы без продаж в периоде — разложено на проданные пропорционально.`);
    }
  } else if (storageUnalloc > 0) {
    warnings.push('Хранение не распределено по артикулам: нет отчёта «Платное хранение» (paid_storage). Сумма в «не распределено».');
  }

  const missingCost: ProfitResult['missingCost'] = [];
  let cogsTotal = 0;
  let adsTotal = 0;
  for (const s of skus.values()) {
    s.netUnits = s.soldUnits - s.returnedUnits;
    s.payout = s.forPay - s.logistics - s.storage - s.acceptance - s.penalty - s.deduction + s.additional - s.rebill;
    const cost = input.costs.get(s.vendorCode);
    if (cost === undefined) {
      if (s.netUnits !== 0) missingCost.push({ vendorCode: s.vendorCode, nmId: s.nmId, netUnits: s.netUnits });
    } else s.unitCost = cost;
    s.cogs = s.unitCost * s.netUnits;
    s.ads = input.adsByNm?.get(s.nmId) ?? 0;
    s.profit = s.payout - s.ads - s.cogs;
    s.margin = s.revenue ? s.profit / s.revenue : 0;
    s.profitPerUnit = s.netUnits > 0 ? s.profit / s.netUnits : 0;
    const f = input.funnelByNm?.get(s.nmId);
    if (f && f.orders > 0) {
      s.orders = f.orders;
      s.buyouts = f.buyouts;
      s.buyoutRate = Math.min(1, f.buyouts / f.orders);
      s.profitPerOrder = s.profitPerUnit * s.buyoutRate;
      const perUnitBeforeAds = s.netUnits > 0 ? (s.profit + s.ads) / s.netUnits : 0;
      s.cpoMax = Math.max(0, perUnitBeforeAds * s.buyoutRate);
    }
    cogsTotal += s.cogs;
    adsTotal += s.ads;
  }

  // Реклама по артикулам без продаж в периоде — тоже расход магазина
  if (input.adsByNm) {
    const sold = new Set([...skus.values()].map((s) => s.nmId));
    const noSales = [...input.adsByNm].filter(([nm]) => !sold.has(nm)).reduce((a, [, v]) => a + v, 0);
    if (noSales > 0) {
      addUnalloc('Реклама по артикулам без продаж в периоде (fullstats)', -noSales);
      adsTotal += noSales;
    }
  } else {
    warnings.push('Реклама по артикулам не получена (fullstats). В расчёте только удержание «ВБ.Продвижение» из отчёта, в «не распределено».');
  }

  const unallocated = [...unalloc].map(([label, amount]) => ({ label, amount })).sort((a, b) => a.amount - b.amount);
  const skuList = [...skus.values()].sort((a, b) => a.profit - b.profit);
  const skuPayout = skuList.reduce((a, s) => a + s.payout, 0);
  const unallocPayoutPart = unallocated
    .filter((u) => !u.label.startsWith('Реклама по артикулам без продаж'))
    .reduce((a, u) => a + u.amount, 0);
  const payoutCheck = skuPayout + unallocPayoutPart;

  // Итог: выплата WB, но реклама — фактическая из fullstats вместо удержания из отчёта
  // Σ прибыли по артикулам + «не распределено» (кроме удержания рекламы, если есть fullstats) = этот итог
  const profit = input.adsByNm ? payout + promotionInReport - adsTotal - cogsTotal : payout - cogsTotal;
  if (input.adsByNm && promotionInReport > 0) {
    const diff = adsTotal - promotionInReport;
    if (Math.abs(diff) > Math.max(100, promotionInReport * 0.05)) {
      warnings.push(
        `Реклама: по fullstats ${adsTotal.toFixed(0)} ₽, удержано в отчёте ${promotionInReport.toFixed(0)} ₽ (разница ${diff.toFixed(0)} ₽). ` +
          'Причины: оплата рекламы картой/со счёта (в отчёт не попадает) или сдвиг дат списания.',
      );
    }
  }

  return {
    skus: skuList,
    unallocated,
    totals: { payout, payoutCheck, promotionInReport, adsFullstats: adsTotal, storageReport, cogs: cogsTotal, profit },
    missingCost,
    warnings,
  };
}
