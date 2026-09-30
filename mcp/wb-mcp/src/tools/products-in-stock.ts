import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';

// Input schema for wb_get_products_in_stock
export const GetProductsInStockInputSchema = z.object({
  minQuantity: z
    .number()
    .int('minQuantity должно быть целым числом')
    .min(0, 'minQuantity не может быть отрицательным')
    .optional()
    .default(1)
    .describe('Минимальное количество на складе'),
});

export type GetProductsInStockInput = z.infer<typeof GetProductsInStockInputSchema>;

// Full product card interface
interface WBCardFull {
  nmID: number;
  vendorCode: string;
  subjectName: string;
  brand: string;
  title: string;
  description?: string;
  photos: Array<{
    big: string;
    c246x328: string;
    c516x688: string;
    square: string;
    tm: string;
  }>;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    weightBrutto?: number;
  };
  characteristics: Array<{
    id: number;
    name: string;
    value: string[];
  }>;
  sizes: Array<{
    chrtID: number;
    techSize: string;
    wbSize: string;
    skus: string[];
  }>;
}

// Product in stock interface (returned by this tool)
export interface ProductInStock {
  nmId: number;
  barcode: string;
  vendorCode: string;
  title: string;
  description?: string;
  photos: string[];
  price: number;
  discount: number;
  finalPrice: number;
  stock: number;
  brand: string;
  category: string;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    weight?: number;
  };
  characteristics: Array<{
    name: string;
    value: string[];
  }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch helper с retry на транзиентные сбои WB (5xx / 429 / сетевые обрывы).
// 4xx не ретраим — это не пройдёт при повторе (авторизация, валидация).
async function fetchWB<T>(url: string, options?: RequestInit): Promise<T> {
  const MAX_ATTEMPTS = 4;
  const BASE_DELAY_MS = 1500;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...createWBHeaders(),
          ...options?.headers,
        },
      });

      if (response.status === 204) {
        return {} as T;
      }

      if (!response.ok) {
        const text = await response.text();
        // 429 у WB — не «попробуй через секунду», а штрафное окно (X-Ratelimit-Retry, сек), которое
        // РАСТЁТ с каждым новым 429 (замерено 03.09.2026: 681 с у discounts-prices, 5226→6690 с у statistics).
        // Повторяем только если окно короткое (≤15 с); иначе отдаём ошибку сразу и не усугубляем.
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('x-ratelimit-retry') ?? response.headers.get('retry-after') ?? NaN);
          if (Number.isFinite(retryAfter) && retryAfter <= 15 && attempt < MAX_ATTEMPTS) {
            console.error(`[wb_fetch_retry] 429 на ${url}, окно ${retryAfter}с — жду и повторяю (попытка ${attempt}/${MAX_ATTEMPTS})`);
            await sleep(retryAfter * 1000 + 500);
            lastErr = new Error(`WB API Error 429: ${text}`);
            continue;
          }
          throw new Error(`WB API Error 429 (retry after ${Number.isFinite(retryAfter) ? retryAfter + 'с' : '?'}): ${text}`);
        }
        const retriable = response.status >= 500;
        if (retriable && attempt < MAX_ATTEMPTS) {
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
          console.error(
            `[wb_fetch_retry] ${response.status} на ${url} (попытка ${attempt}/${MAX_ATTEMPTS}), повтор через ${delay}мс`,
          );
          await sleep(delay);
          lastErr = new Error(`WB API Error ${response.status}: ${text}`);
          continue;
        }
        throw new Error(`WB API Error ${response.status}: ${text}`);
      }

      return response.json() as Promise<T>;
    } catch (err) {
      // Сетевой сбой (fetch failed / ECONNRESET / таймаут) — тоже ретраим.
      const isHttpError = err instanceof Error && /WB API Error/.test(err.message);
      if (!isHttpError && attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        console.error(
          `[wb_fetch_retry] сетевой сбой на ${url} (попытка ${attempt}/${MAX_ATTEMPTS}): ${String(err)}, повтор через ${delay}мс`,
        );
        await sleep(delay);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Get all product cards with photos using Content API
 */
async function getAllCards(): Promise<WBCardFull[]> {
  const url = `${WB_API_URLS.content}/content/v2/get/cards/list`;
  const allCards: WBCardFull[] = [];
  let cursor: Record<string, unknown> = { limit: 100 };

  while (true) {
    const result = await fetchWB<{
      cards?: WBCardFull[];
      cursor?: { total: number; updatedAt?: string; nmID?: number };
    }>(url, {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          cursor,
          filter: { withPhoto: 1 },
        },
      }),
    });

    const cards = result.cards || [];
    if (cards.length === 0) break;

    allCards.push(...cards);

    const total = result.cursor?.total || 0;
    if (total < 100) break;

    cursor = {
      limit: 100,
      updatedAt: result.cursor?.updatedAt,
      nmID: result.cursor?.nmID,
    };
  }

  return allCards;
}

/**
 * Get prices for products
 */
async function getPricesMap(): Promise<Map<number, { price: number; discount: number; discountedPrice: number }>> {
  const prices = new Map<number, { price: number; discount: number; discountedPrice: number }>();
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${WB_API_URLS.prices}/api/v2/list/goods/filter?limit=${limit}&offset=${offset}`;

    const result = await fetchWB<{
      data?: {
        listGoods?: Array<{
          nmID: number;
          sizes: Array<{
            price: number;
            discountedPrice: number;
          }>;
          discount?: number;
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
        });
      }
    }

    if (goods.length < limit) break;
    offset += limit;
  }

  return prices;
}

/**
 * Get seller warehouses
 */
async function getSellerWarehouses(): Promise<Array<{ id: number; name: string }>> {
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
 * Get FBS stocks by barcodes
 */
async function getFBSStocks(barcodes: string[]): Promise<Map<string, number>> {
  const stocks = new Map<string, number>();

  if (barcodes.length === 0) return stocks;

  // Get seller warehouses
  const warehouses = await getSellerWarehouses();
  if (warehouses.length === 0) {
    console.error('No seller warehouses found');
    return stocks;
  }

  // Get stocks from each warehouse
  for (const warehouse of warehouses) {
    if (!warehouse.id) continue;

    const url = `${WB_API_URLS.marketplace}/api/v3/stocks/${warehouse.id}`;

    // Split barcodes into batches of 1000
    for (let i = 0; i < barcodes.length; i += 1000) {
      const batch = barcodes.slice(i, i + 1000);

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
 * Main handler: Get all products in stock (FBS)
 */
export interface GetProductsInStockOptions {
  /**
   * Цены необязательны: при сбое discounts-prices (у токена лимит 1 запрос в ~11 мин) вернуть товары
   * с price/finalPrice = 0 и summary.pricesUnavailable вместо исключения. Для синка остатков цены не нужны;
   * для создания карточек и выравнивания цен — нужны (оставлять false).
   */
  pricesOptional?: boolean;
  /** Вообще не ходить за ценами (для синка остатков): не расходует окно discounts-prices (1 запрос в ~11–12 мин). */
  skipPrices?: boolean;
}

export async function getProductsInStock(input: GetProductsInStockInput, opts: GetProductsInStockOptions = {}): Promise<{
  products: ProductInStock[];
  total: number;
  summary: {
    totalCards: number;
    totalBarcodes: number;
    productsWithStock: number;
    pricesUnavailable?: string;
  };
}> {
  const { minQuantity } = input;

  // Step 1: Get all cards with photos
  const cards = await getAllCards();

  // Step 2: Get prices (опционально)
  let prices = new Map<number, { price: number; discount: number; discountedPrice: number }>();
  let pricesUnavailable: string | undefined;
  try {
    if (opts.skipPrices) pricesUnavailable = 'skipped by caller';
    else prices = await getPricesMap();
  } catch (err) {
    if (!opts.pricesOptional) throw err;
    pricesUnavailable = err instanceof Error ? err.message.slice(0, 160) : String(err);
    console.error(`[wb_products_in_stock] цены недоступны, продолжаю без них: ${pricesUnavailable}`);
  }

  // Step 3: Extract all barcodes from sizes[].skus[]
  const barcodeToCard = new Map<string, { card: WBCardFull; sizeIndex: number }>();
  for (const card of cards) {
    for (let i = 0; i < (card.sizes || []).length; i++) {
      const size = card.sizes[i];
      for (const barcode of size.skus || []) {
        barcodeToCard.set(barcode, { card, sizeIndex: i });
      }
    }
  }

  // Step 4: Get FBS stocks by barcodes
  const stocks = await getFBSStocks([...barcodeToCard.keys()]);

  // Step 5: Filter products with stock >= minQuantity
  const productsInStock: ProductInStock[] = [];

  for (const [barcode, amount] of stocks) {
    if (amount >= minQuantity) {
      const cardData = barcodeToCard.get(barcode);
      if (cardData) {
        const { card } = cardData;
        const priceData = prices.get(card.nmID);
        const price = priceData?.price || 0;
        const discount = priceData?.discount || 0;
        // WB отдаёт готовую цену со скидкой (discountedPrice); пересчёт — только fallback
        const finalPrice = priceData?.discountedPrice ?? Math.round(price * (1 - discount / 100));

        productsInStock.push({
          nmId: card.nmID,
          barcode,
          vendorCode: card.vendorCode,
          title: card.title,
          description: card.description,
          photos: (card.photos || []).map(p => p.big || p.c516x688 || p.square),
          price,
          discount,
          finalPrice,
          stock: amount,
          brand: card.brand,
          category: card.subjectName,
          dimensions: card.dimensions ? {
            length: card.dimensions.length,
            width: card.dimensions.width,
            height: card.dimensions.height,
            weight: card.dimensions.weightBrutto,
          } : undefined,
          characteristics: (card.characteristics || []).map(c => ({
            name: c.name,
            value: c.value,
          })),
        });
      }
    }
  }

  await logRead('wb_get_products_in_stock', 'products', input, {
    totalCards: cards.length,
    totalBarcodes: barcodeToCard.size,
    productsWithStock: productsInStock.length,
  });

  return {
    products: productsInStock,
    total: productsInStock.length,
    summary: {
      totalCards: cards.length,
      totalBarcodes: barcodeToCard.size,
      productsWithStock: productsInStock.length,
      ...(pricesUnavailable ? { pricesUnavailable } : {}),
    },
  };
}

/**
 * Format products in stock as markdown
 */
export function formatProductsInStockAsMarkdown(products: ProductInStock[]): string {
  if (products.length === 0) {
    return '❌ Товары в наличии не найдены';
  }

  const lines = [
    `## 📦 Товары в наличии: ${products.length}`,
    '',
    '| nmId | Артикул | Название | Цена | Скидка | Цена со скидкой | Остаток |',
    '|------|---------|----------|------|--------|-----------------|---------|',
  ];

  for (const p of products.slice(0, 50)) {
    const name = (p.title || p.category || '').substring(0, 35);
    lines.push(`| ${p.nmId} | ${p.vendorCode} | ${name} | ${p.price}₽ | ${p.discount}% | ${p.finalPrice}₽ | ${p.stock} шт |`);
  }

  if (products.length > 50) {
    lines.push(`\n... и ещё ${products.length - 50} товаров`);
  }

  // Summary
  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
  const totalValue = products.reduce((sum, p) => sum + p.finalPrice * p.stock, 0);

  lines.push('');
  lines.push('### 📊 Сводка');
  lines.push(`- **Товаров:** ${products.length}`);
  lines.push(`- **Общий остаток:** ${totalStock} шт`);
  lines.push(`- **Стоимость остатков:** ${totalValue.toLocaleString('ru-RU')}₽`);

  return lines.join('\n');
}
