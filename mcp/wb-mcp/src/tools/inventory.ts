import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';
import { horizontalBars, formatNumber, formatRub, BarItem } from '../utils/visualize.js';

// Input schema for wb_get_inventory
export const GetInventoryInputSchema = z.object({
  minQuantity: z
    .number()
    .int('minQuantity должно быть целым числом')
    .min(0, 'minQuantity не может быть отрицательным')
    .optional()
    .default(1)
    .describe('Minimum stock quantity to include'),
  mode: z.enum(['all', 'fbo', 'fbs']).optional().default('all').describe('Mode: all (cards+prices), fbo (WB warehouses), fbs (seller warehouses)'),
  warehouseId: z.string().optional().describe('Warehouse ID for FBS mode'),
});

export type GetInventoryInput = z.infer<typeof GetInventoryInputSchema>;

// Product interface
interface WBProduct {
  nmId: number;
  vendorCode: string;
  barcodes?: string[];
  subjectName?: string;
  brand?: string;
  title?: string;
  price?: number;
  discount?: number;
  finalPrice?: number;
  promoCode?: number;
  stockFbo?: number;
  stockFbs?: number;
  warehouses?: Array<{ name: string; quantity: number }>;
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
 * Get all product cards using Content API
 */
async function getCards(limit = 100): Promise<WBProduct[]> {
  const url = `${WB_API_URLS.content}/content/v2/get/cards/list`;
  const allCards: WBProduct[] = [];

  let cursor: Record<string, unknown> = { limit };

  while (true) {
    const result = await fetchWB<{
      cards?: Array<{
        nmID: number;
        vendorCode: string;
        subjectName?: string;
        brand?: string;
        title?: string;
        sizes?: Array<{ skus?: string[] }>;
      }>;
      cursor?: {
        total: number;
        updatedAt?: string;
        nmID?: number;
      };
    }>(url, {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          cursor,
          filter: { withPhoto: -1 },
        },
      }),
    });

    const cards = result.cards || [];
    if (cards.length === 0) break;

    for (const card of cards) {
      const barcodes: string[] = [];
      for (const s of card.sizes || []) {
        for (const sku of s.skus || []) barcodes.push(sku);
      }
      allCards.push({
        nmId: card.nmID,
        vendorCode: card.vendorCode,
        barcodes,
        subjectName: card.subjectName,
        brand: card.brand,
        title: card.title,
      });
    }

    const total = result.cursor?.total || 0;
    if (total < limit) break;

    cursor = {
      limit,
      updatedAt: result.cursor?.updatedAt,
      nmID: result.cursor?.nmID,
    };
  }

  return allCards;
}

/**
 * Get prices for products
 */
async function getPrices(): Promise<Map<number, { price: number; discount: number; discountedPrice: number; promoCode: number }>> {
  const prices = new Map<number, { price: number; discount: number; discountedPrice: number; promoCode: number }>();
  let offset = 0;
  const limit = 1000;

  while (true) {
    let url = `${WB_API_URLS.prices}/api/v2/list/goods/filter?limit=${limit}&offset=${offset}`;

    const result = await fetchWB<{
      data?: {
        listGoods?: Array<{
          nmID: number;
          sizes: Array<{
            price: number;
            discountedPrice: number;
            techSizeName?: string;
          }>;
          discount?: number;
          promoCode?: number;
        }>;
      };
    }>(url);

    const goods = result.data?.listGoods || [];
    if (goods.length === 0) break;

    for (const item of goods) {
      const size = item.sizes?.[0];
      if (size) {
        const discount = item.discount || 0;
        prices.set(item.nmID, {
          price: size.price,
          discount,
          // WB отдаёт готовую цену со скидкой (discountedPrice); пересчёт — только fallback
          discountedPrice: size.discountedPrice ?? Math.round(size.price * (1 - discount / 100)),
          promoCode: item.promoCode || 0,
        });
      }
    }

    if (goods.length < limit) break;
    offset += limit;
  }

  return prices;
}

/**
 * Get stocks from WB warehouses (FBO)
 */
async function getStocksFBO(): Promise<Map<number, { total: number; warehouses: Array<{ name: string; quantity: number }> }>> {
  const stocks = new Map<number, { total: number; warehouses: Array<{ name: string; quantity: number }> }>();
  const dateFrom = '2019-01-01';
  let url = `${WB_API_URLS.statistics}/api/v1/supplier/stocks?dateFrom=${dateFrom}`;

  while (true) {
    const result = await fetchWB<Array<{
      nmId: number;
      warehouseName: string;
      quantity: number;
      lastChangeDate?: string;
    }>>(url);

    if (!result || result.length === 0) break;

    for (const item of result) {
      const existing = stocks.get(item.nmId) || { total: 0, warehouses: [] };
      existing.total += item.quantity;
      existing.warehouses.push({
        name: item.warehouseName,
        quantity: item.quantity,
      });
      stocks.set(item.nmId, existing);
    }

    // Pagination for large datasets
    if (result.length >= 60000) {
      const lastDate = result[result.length - 1].lastChangeDate;
      if (lastDate) {
        url = `${WB_API_URLS.statistics}/api/v1/supplier/stocks?dateFrom=${lastDate}`;
        continue;
      }
    }
    break;
  }

  return stocks;
}

/**
 * Записать остатки FBS на склад продавца. PUT /api/v3/stocks/{warehouseId}.
 * items: [{ sku: barcode, amount }]. Если warehouseId не задан — берётся первый склад продавца.
 * Возвращает id использованного склада и число обновлённых SKU. 204 = успех.
 */
export async function updateStocksFBS(
  items: Array<{ sku: string; amount: number }>,
  warehouseId?: number
): Promise<{ warehouseId: number; updated: number }> {
  let whId = warehouseId;
  if (!whId) {
    const whs = await getSellerWarehouses();
    if (whs.length === 0) throw new Error('Нет складов продавца (FBS) для записи остатков');
    whId = whs[0].id;
  }
  const url = `${WB_API_URLS.marketplace}/api/v3/stocks/${whId}`;
  let updated = 0;
  for (let i = 0; i < items.length; i += 1000) {
    const batch = items.slice(i, i + 1000);
    await fetchWB(url, { method: 'PUT', body: JSON.stringify({ stocks: batch }) });
    updated += batch.length;
  }
  return { warehouseId: whId, updated };
}

/**
 * Get seller warehouses (for FBS)
 */
export async function getSellerWarehouses(): Promise<Array<{ id: number; name: string }>> {
  const url = `${WB_API_URLS.marketplace}/api/v3/warehouses`;

  const result = await fetchWB<Array<{
    id?: number;
    ID?: number;
    name: string;
  }>>(url);

  return (result || []).map((w) => ({
    id: w.id || w.ID || 0,
    name: w.name,
  }));
}

/**
 * Get stocks from seller warehouses (FBS).
 * Uses POST /api/v3/stocks/{warehouseId} which expects barcodes (sizes[].skus[]), not vendorCode.
 */
async function getStocksFBS(barcodes: string[]): Promise<Map<string, number>> {
  const stocks = new Map<string, number>();

  if (barcodes.length === 0) return stocks;
  const skus = barcodes;

  // Get seller warehouses
  const warehouses = await getSellerWarehouses();
  if (warehouses.length === 0) {
    console.log('No seller warehouses found');
    return stocks;
  }

  // Get stocks from each warehouse
  for (const warehouse of warehouses) {
    if (!warehouse.id) continue;

    const url = `${WB_API_URLS.marketplace}/api/v3/stocks/${warehouse.id}`;

    // Split SKUs into batches of 1000
    for (let i = 0; i < skus.length; i += 1000) {
      const batch = skus.slice(i, i + 1000);

      try {
        const result = await fetchWB<{
          stocks?: Array<{
            sku: string;
            amount: number;
          }>;
        }>(url, {
          method: 'POST',
          body: JSON.stringify({ skus: batch }),
        });

        for (const item of result.stocks || []) {
          const existing = stocks.get(item.sku) || 0;
          stocks.set(item.sku, existing + item.amount);
        }
      } catch (error) {
        console.error(`Error fetching FBS stocks for warehouse ${warehouse.id}:`, error);
      }
    }
  }

  return stocks;
}

/**
 * Main inventory tool handler
 */
export async function getInventory(input: GetInventoryInput): Promise<{
  products: WBProduct[];
  total: number;
  source: 'api';
  syncedAt: string;
}> {
  const { minQuantity, mode } = input;

  // Fetch from API
  const cards = await getCards();
  const prices = await getPrices();

  // Get stocks based on mode
  let stocksFbo = new Map<number, { total: number; warehouses: Array<{ name: string; quantity: number }> }>();
  let stocksFbs = new Map<string, number>();

  // Build barcode -> nmId map (FBS API requires barcodes from sizes[].skus[], not vendorCode)
  const barcodeToNmId = new Map<string, number>();
  const nmIdToBarcodes = new Map<number, string[]>();
  for (const card of cards) {
    const barcodes = card.barcodes || [];
    nmIdToBarcodes.set(card.nmId, barcodes);
    for (const bc of barcodes) {
      barcodeToNmId.set(bc, card.nmId);
    }
  }

  if (mode === 'fbo' || mode === 'all') {
    stocksFbo = await getStocksFBO();
  }
  if (mode === 'fbs' || mode === 'all') {
    stocksFbs = await getStocksFBS([...barcodeToNmId.keys()]);
  }

  // Combine data
  const products: WBProduct[] = [];

  for (const card of cards) {
    const priceData = prices.get(card.nmId);
    const stockFboData = stocksFbo.get(card.nmId);
    // Sum FBS stock across all barcodes of this card
    let stockFbsData = 0;
    for (const bc of (nmIdToBarcodes.get(card.nmId) || [])) {
      stockFbsData += stocksFbs.get(bc) || 0;
    }

    const product: WBProduct = {
      ...card,
      price: priceData?.price,
      discount: priceData?.discount,
      finalPrice: priceData?.discountedPrice,
      promoCode: priceData?.promoCode,
      stockFbo: stockFboData?.total || 0,
      stockFbs: stockFbsData,
      warehouses: stockFboData?.warehouses,
    };

    // Filter by minimum quantity based on mode
    let totalStock = 0;
    if (mode === 'fbo') {
      totalStock = product.stockFbo || 0;
    } else if (mode === 'fbs') {
      totalStock = product.stockFbs || 0;
    } else {
      totalStock = (product.stockFbo || 0) + (product.stockFbs || 0);
    }

    if (totalStock >= minQuantity) {
      products.push(product);
    }
  }

  await logRead('wb_get_inventory', 'inventory', input, { count: products.length, source: 'api' });

  return {
    products,
    total: products.length,
    source: 'api',
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Format inventory as markdown with visual charts
 */
export function formatInventoryAsMarkdown(products: WBProduct[]): string {
  if (products.length === 0) {
    return 'Товары не найдены';
  }

  const lines: string[] = [];

  // Aggregate by warehouse
  const warehouseMap = new Map<string, number>();
  let totalFbo = 0;
  let totalFbs = 0;

  for (const p of products) {
    totalFbo += p.stockFbo || 0;
    totalFbs += p.stockFbs || 0;

    if (p.warehouses) {
      for (const w of p.warehouses) {
        const current = warehouseMap.get(w.name) || 0;
        warehouseMap.set(w.name, current + w.quantity);
      }
    }
  }

  // Warehouse distribution chart
  if (warehouseMap.size > 0) {
    lines.push('## Остатки по складам\n');

    const warehouseItems: BarItem[] = Array.from(warehouseMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ label: name, value }));

    lines.push('```');
    lines.push(horizontalBars(warehouseItems, 25));
    lines.push('```');
    lines.push('');
  }

  // Summary
  lines.push('## Сводка\n');
  lines.push(`- **FBO (склады WB):** ${formatNumber(totalFbo)} шт`);
  lines.push(`- **FBS (ваши склады):** ${formatNumber(totalFbs)} шт`);
  lines.push(`- **Всего товаров:** ${formatNumber(products.length)}`);
  lines.push('');

  // Product table
  lines.push('## Детализация\n');
  lines.push('| nmId | Артикул | Название | Цена | Скидка | Цена со скидкой | FBO | FBS |');
  lines.push('|------|---------|----------|------|--------|-----------------|-----|-----|');

  for (const p of products.slice(0, 50)) {
    const name = (p.title || p.subjectName || '').substring(0, 25);
    const price = p.price ? formatRub(p.price) : '-';
    const discount = p.discount ? `${p.discount}%` : '-';
    const finalPrice = p.finalPrice ? formatRub(p.finalPrice) : '-';
    const fbo = p.stockFbo || 0;
    const fbs = p.stockFbs || 0;
    lines.push(`| ${p.nmId} | ${p.vendorCode} | ${name} | ${price} | ${discount} | ${finalPrice} | ${fbo} | ${fbs} |`);
  }

  if (products.length > 50) {
    lines.push(`\n*... и ещё ${products.length - 50} товаров*`);
  }

  return lines.join('\n');
}
