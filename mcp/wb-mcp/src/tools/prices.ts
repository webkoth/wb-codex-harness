import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead, logWriteWithPreview, logError, journalWrite } from '../utils/logger.js';
import {
  createPriceChangePreview,
  formatPreviewForDisplay,
  needsConfirmation,
  confirmed,
  type WriteOperationResult,
} from '../utils/confirmation.js';

// Input schema for wb_get_prices
export const GetPricesInputSchema = z.object({
  nmIds: z.array(z.number()).optional().describe('Filter by specific nmIds'),
  limit: z.number().int().positive('limit должен быть больше 0').optional().default(100).describe('Maximum number of products to return'),
  offset: z.number().int().min(0, 'offset не может быть отрицательным').optional().default(0).describe('Offset for pagination'),
});

export type GetPricesInput = z.infer<typeof GetPricesInputSchema>;

// Input schema for wb_update_price
export const UpdatePriceInputSchema = z
  .object({
    nmId: z.number().int('nmId должен быть целым числом').positive('nmId должен быть положительным').describe('Product nmId'),
    price: z.number().positive('price должна быть больше 0').optional().describe('New price (before discount)'),
    discount: z
      .number()
      .int('discount должен быть целым числом')
      .min(0, 'discount не может быть меньше 0')
      .max(100, 'discount не может быть больше 100')
      .optional()
      .describe('New discount percentage (0-100)'),
    confirm: z.boolean().optional().default(false).describe('Set to true to confirm and apply changes'),
  })
  .refine((d) => d.price !== undefined || d.discount !== undefined, {
    message: 'Нужно указать хотя бы одно из полей: price или discount',
  });

export type UpdatePriceInput = z.infer<typeof UpdatePriceInputSchema>;

// Price data interface
interface PriceData {
  nmId: number;
  vendorCode?: string;
  price: number;
  discount: number;
  promoCode: number;
  finalPrice: number;
  sizes?: Array<{
    sizeID: number;
    price: number;
    discountedPrice: number;
    techSizeName?: string;
  }>;
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
 * Get prices from WB API
 */
export async function getPrices(input: GetPricesInput): Promise<{
  products: PriceData[];
  total: number;
}> {
  const { nmIds, limit, offset } = input;
  const products: PriceData[] = [];
  let currentOffset = offset;

  // WB goods/filter не фильтрует по nmID на сервере — отбор идёт на клиенте,
  // поэтому страницу тянем целиком, иначе искомый nmID может не попасть в выборку
  // при маленьком limit (баг: limit=1 находил только первый товар каталога).
  const PAGE_SIZE = 1000;

  while (products.length < limit) {
    const url = `${WB_API_URLS.prices}/api/v2/list/goods/filter?limit=${PAGE_SIZE}&offset=${currentOffset}`;

    const result = await fetchWB<{
      data?: {
        listGoods?: Array<{
          nmID: number;
          vendorCode?: string;
          sizes: Array<{
            sizeID: number;
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
      // Filter by nmIds if specified
      if (nmIds && nmIds.length > 0 && !nmIds.includes(item.nmID)) {
        continue;
      }

      const size = item.sizes?.[0];
      if (size) {
        const discount = item.discount || 0;
        products.push({
          nmId: item.nmID,
          vendorCode: item.vendorCode,
          price: size.price,
          discount,
          promoCode: item.promoCode || 0,
          // WB возвращает готовую цену со скидкой (discountedPrice); пересчёт — только fallback
          finalPrice: size.discountedPrice ?? Math.round(size.price * (1 - discount / 100)),
          sizes: item.sizes,
        });
      }

      if (products.length >= limit) break;
    }

    if (goods.length < PAGE_SIZE) break;
    currentOffset += goods.length;
  }

  await logRead('wb_get_prices', 'prices', input, { count: products.length });

  return {
    products,
    total: products.length,
  };
}

/**
 * Format prices as markdown table
 */
export function formatPricesAsMarkdown(products: PriceData[]): string {
  if (products.length === 0) {
    return 'Товары не найдены';
  }

  const lines = [
    '| nmId | Артикул | Цена | Скидка | Промокод | Финальная цена |',
    '|------|---------|------|--------|----------|----------------|',
  ];

  for (const p of products.slice(0, 50)) {
    lines.push(
      `| ${p.nmId} | ${p.vendorCode || '-'} | ${p.price}₽ | ${p.discount}% | ${p.promoCode}% | ${p.finalPrice}₽ |`
    );
  }

  if (products.length > 50) {
    lines.push(`\n... и ещё ${products.length - 50} товаров`);
  }

  lines.push(`\n**Всего товаров:** ${products.length}`);

  return lines.join('\n');
}

/**
 * Get current price for a product (from cache or API)
 */
async function getCurrentPrice(nmId: number): Promise<{
  price: number;
  discount: number;
  finalPrice: number;
} | null> {
  const result = await getPrices({ nmIds: [nmId], limit: 1, offset: 0 });
  if (result.products.length > 0) {
    const product = result.products[0];
    return {
      price: product.price,
      discount: product.discount,
      finalPrice: product.finalPrice,
    };
  }

  return null;
}

/**
 * Update price with confirmation system
 */
export async function updatePrice(
  input: UpdatePriceInput
): Promise<WriteOperationResult<{ success: boolean; nmId: number; newPrice?: number; newDiscount?: number }>> {
  const { nmId, price, discount, confirm } = input;

  if (price === undefined && discount === undefined) {
    throw new Error('At least one of price or discount must be specified');
  }

  // Get current price
  const current = await getCurrentPrice(nmId);
  if (!current) {
    throw new Error(`Product ${nmId} not found`);
  }

  const newPrice = price ?? current.price;
  const newDiscount = discount ?? current.discount;

  // If not confirmed, return preview
  if (!confirm) {
    const preview = createPriceChangePreview({
      nmId: nmId.toString(),
      currentPrice: current.price,
      currentFinalPrice: current.finalPrice,
      newPrice,
      currentDiscount: current.discount,
      newDiscount,
      toolName: 'wb_update_price',
    });

    await logWriteWithPreview('wb_update_price', 'prices', input, preview as unknown as Record<string, unknown>);

    return needsConfirmation(preview);
  }

  // Confirmed - apply changes
  try {
    // Call WB API to update price
    const url = `${WB_API_URLS.prices}/api/v2/upload/task`;

    const response = await fetchWB<{ data: unknown; error: boolean; errorText?: string }>(url, {
      method: 'POST',
      body: JSON.stringify({
        data: [
          {
            nmID: nmId,
            price: newPrice,
            discount: newDiscount,
          },
        ],
      }),
    });

    const preview = createPriceChangePreview({
      nmId: nmId.toString(),
      currentPrice: current.price,
      currentFinalPrice: current.finalPrice,
      newPrice,
      currentDiscount: current.discount,
      newDiscount,
      toolName: 'wb_update_price',
    });

    // В журнал — точное БЫЛО для отката: цена и скидка до изменения
    journalWrite({
      tool: 'wb_update_price',
      entity: { type: 'product', id: nmId },
      before: { nmId, price: current.price, discount: current.discount },
      after: { nmId, price: newPrice, discount: newDiscount },
      response,
      ok: true,
      reversible: true,
    });
    void preview;

    return confirmed({
      success: true,
      nmId,
      newPrice,
      newDiscount,
    });
  } catch (error) {
    journalWrite({
      tool: 'wb_update_price',
      entity: { type: 'product', id: nmId },
      before: { nmId, price: current.price, discount: current.discount },
      after: { nmId, price: newPrice, discount: newDiscount },
      ok: false,
      reversible: false,
      error: (error as Error).message,
    });
    await logError('wb_update_price', 'prices', input, error as Error);
    throw error;
  }
}

/**
 * Format update result for display
 */
export function formatUpdateResult(
  result: WriteOperationResult<{ success: boolean; nmId: number; newPrice?: number; newDiscount?: number }>
): string {
  if (!result.confirmed) {
    return formatPreviewForDisplay(result.preview);
  }

  const { nmId, newPrice, newDiscount } = result.result;
  return [
    '## Цена успешно обновлена',
    '',
    `**nmId:** ${nmId}`,
    `**Новая цена:** ${newPrice}₽`,
    `**Новая скидка:** ${newDiscount}%`,
    `**Финальная цена:** ${Math.round(newPrice! * (1 - newDiscount! / 100))}₽`,
  ].join('\n');
}
