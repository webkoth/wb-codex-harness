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
      error?: boolean;
      errorText?: string;
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

    if (result?.error === true) throw new Error(`WB prices: ${result.errorText || 'чтение отклонено'}`);
    if (!Array.isArray(result?.data?.listGoods)) throw new Error('WB prices: некорректный ответ чтения');
    const goods = result.data.listGoods;
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
export interface PriceUpdateResult {
  success: boolean;
  nmId: number;
  newPrice?: number;
  newDiscount?: number;
  status: 'applied' | 'pending';
  taskId: number;
  journalId: string;
  warning?: string;
}

export async function updatePrice(
  input: UpdatePriceInput,
  context: { rollbackOf?: string } = {}
): Promise<WriteOperationResult<PriceUpdateResult>> {
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

  const base = {
    tool: 'wb_update_price',
    entity: { type: 'product', id: nmId },
    before: { nmId, price: current.price, discount: current.discount },
    after: { nmId, price: newPrice, discount: newDiscount },
    ...context,
  };
  let response: { data?: { id?: number }; error?: boolean; errorText?: string } | undefined;
  let rejected = false;
  try {
    response = await fetchWB(`${WB_API_URLS.prices}/api/v2/upload/task`, {
      method: 'POST',
      body: JSON.stringify({ data: [{ nmID: nmId, price: newPrice, discount: newDiscount }] }),
    });
    if (response?.error === true) {
      rejected = true;
      throw new Error(`WB отклонил цену: ${response.errorText || 'error:true'}`);
    }
    if (response?.error !== false || (!Number.isInteger(response?.data?.id) || response!.data!.id! < 0)) {
      throw new Error('Некорректный ответ WB: исход записи неизвестен, не повторяйте запись автоматически.');
    }
  } catch (error) {
    const entry = journalWrite({ ...base, response, ok: false, reversible: !rejected,
      status: rejected ? 'rejected' : 'unknown', error: (error as Error).message });
    await logError('wb_update_price', 'prices', input, error as Error);
    if (rejected) throw error;
    throw new Error(`${(error as Error).message} Исход записи неизвестен; автоматически повторять нельзя. Журнал: ${entry.id}`);
  }

  let applied = false;
  let warning = 'Задача принята WB, применение цены и скидки пока не подтверждено.';
  try {
    const observed = await getCurrentPrice(nmId);
    applied = observed?.price === newPrice && observed.discount === newDiscount;
  } catch (error) {
    warning += ` Повторное чтение недоступно: ${(error as Error).message}`;
  }
  const status = applied ? 'applied' : 'pending';
  const taskId = response.data!.id!;
  const entry = journalWrite({ ...base, response, taskId, status, ok: applied, reversible: true });
  return confirmed({ success: applied, nmId, newPrice, newDiscount, status, taskId,
    journalId: entry.id, ...(applied ? {} : { warning }) });
}

/**
 * Format update result for display
 */
export function formatUpdateResult(
  result: WriteOperationResult<PriceUpdateResult>
): string {
  if (!result.confirmed) {
    return formatPreviewForDisplay(result.preview);
  }

  const { nmId, newPrice, newDiscount } = result.result;
  if (!result.result.success || result.result.status !== 'applied') {
    return `Цена ожидает подтверждения WB (pending). nmId: ${nmId}, taskId: ${result.result.taskId}.\n${result.result.warning ?? ''}\nЖурнал: ${result.result.journalId}`;
  }
  return [
    '## Цена успешно обновлена',
    '',
    `**nmId:** ${nmId}`,
    `**Новая цена:** ${newPrice}₽`,
    `**Новая скидка:** ${newDiscount}%`,
    `**Финальная цена:** ${Math.round(newPrice! * (1 - newDiscount! / 100))}₽`,
  ].join('\n');
}
