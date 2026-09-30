/**
 * Supplies tools for Wildberries MCP
 * Управление поставками на склады WB (FBO)
 */

import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead, journalWrite } from '../utils/logger.js';

// ==================== Input Schemas ====================

export const GetSuppliesInputSchema = z.object({
  limit: z.number().optional().default(50).describe('Максимальное количество поставок (по умолчанию 50)'),
  next: z.number().optional().describe('Курсор для пагинации'),
}).strict();

export const GetSupplyInputSchema = z.object({
  supplyId: z.string().describe('ID поставки (например WB-GI-123456)'),
}).strict();

export const CreateSupplyInputSchema = z.object({
  name: z.string().optional().describe('Название поставки'),
  confirm: z.boolean().optional().default(false).describe('true для подтверждения создания'),
}).strict();

export const AddToSupplyInputSchema = z.object({
  supplyId: z.string().describe('ID поставки'),
  orderIds: z.array(z.number()).describe('Массив ID заказов для добавления'),
  confirm: z.boolean().optional().default(false).describe('true для подтверждения'),
}).strict();

export const CloseSupplyInputSchema = z.object({
  supplyId: z.string().describe('ID поставки для закрытия'),
  confirm: z.boolean().optional().default(false).describe('true для подтверждения'),
}).strict();

export const DeleteSupplyInputSchema = z.object({
  supplyId: z.string().describe('ID поставки для удаления'),
  confirm: z.boolean().optional().default(false).describe('true для подтверждения'),
}).strict();

export type GetSuppliesInput = z.infer<typeof GetSuppliesInputSchema>;
export type GetSupplyInput = z.infer<typeof GetSupplyInputSchema>;
export type CreateSupplyInput = z.infer<typeof CreateSupplyInputSchema>;
export type AddToSupplyInput = z.infer<typeof AddToSupplyInputSchema>;
export type CloseSupplyInput = z.infer<typeof CloseSupplyInputSchema>;
export type DeleteSupplyInput = z.infer<typeof DeleteSupplyInputSchema>;

// ==================== Interfaces ====================

export interface SupplyData {
  id: string;
  name: string;
  createdAt: string;
  closedAt?: string;
  scanDate?: string;
  done: boolean;
  isLargeCargo: boolean;
  ordersCount?: number;
}

export interface SupplyOrder {
  id: number;
  rid: string;
  createdAt: string;
  warehouseId: number;
  supplyId: string;
  barcodes: string[];
  address?: {
    fullAddress: string;
    province?: string;
    area?: string;
    city?: string;
    street?: string;
  };
  user?: {
    phone?: string;
  };
  skus: string[];
  price: number;
  convertedPrice: number;
  currencyCode: number;
  cargoType: number;
}

// ==================== Fetch Helper ====================

async function fetchWB<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...createWBHeaders(),
      'Content-Type': 'application/json',
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

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  return {} as T;
}

// ==================== Functions ====================

/**
 * Получить список поставок
 * GET /api/v3/supplies
 */
export async function getSupplies(input: GetSuppliesInput): Promise<{
  supplies: SupplyData[];
  total: number;
  next?: number;
}> {
  const { limit, next } = input;

  // WB требует обязательный параметр next (0 — первая страница)
  const url = `${WB_API_URLS.marketplace}/api/v3/supplies?limit=${limit}&next=${next ?? 0}`;

  const result = await fetchWB<{
    supplies: Array<{
      id: string;
      name: string;
      createdAt: string;
      closedAt?: string;
      scanDt?: string;
      done: boolean;
      isLargeCargo?: boolean;
    }>;
    next?: number;
  }>(url);

  const supplies: SupplyData[] = (result.supplies || []).map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    scanDate: s.scanDt,
    done: s.done,
    isLargeCargo: s.isLargeCargo || false,
  }));

  await logRead('wb_get_supplies', 'supplies', input, { count: supplies.length });

  return {
    supplies,
    total: supplies.length,
    next: result.next,
  };
}

/**
 * Получить детали поставки с заказами
 * GET /api/v3/supplies/{supplyId}/orders
 */
export async function getSupply(input: GetSupplyInput): Promise<{
  supply: SupplyData;
  orders: SupplyOrder[];
}> {
  const { supplyId } = input;

  // Получаем информацию о поставке
  const suppliesResult = await fetchWB<{
    supplies: Array<{
      id: string;
      name: string;
      createdAt: string;
      closedAt?: string;
      scanDt?: string;
      done: boolean;
      isLargeCargo?: boolean;
    }>;
  }>(`${WB_API_URLS.marketplace}/api/v3/supplies?limit=1000`);

  const supplyInfo = (suppliesResult.supplies || []).find((s) => s.id === supplyId);

  if (!supplyInfo) {
    throw new Error(`Поставка ${supplyId} не найдена`);
  }

  // Получаем заказы в поставке
  const ordersResult = await fetchWB<{
    orders: Array<{
      id: number;
      rid: string;
      createdAt: string;
      warehouseId: number;
      supplyId: string;
      barcodes: string[];
      address?: {
        fullAddress: string;
        province?: string;
        area?: string;
        city?: string;
        street?: string;
      };
      user?: {
        phone?: string;
      };
      skus: string[];
      price: number;
      convertedPrice: number;
      currencyCode: number;
      cargoType: number;
    }>;
  }>(`${WB_API_URLS.marketplace}/api/v3/supplies/${supplyId}/orders`);

  const supply: SupplyData = {
    id: supplyInfo.id,
    name: supplyInfo.name,
    createdAt: supplyInfo.createdAt,
    closedAt: supplyInfo.closedAt,
    scanDate: supplyInfo.scanDt,
    done: supplyInfo.done,
    isLargeCargo: supplyInfo.isLargeCargo || false,
    ordersCount: ordersResult.orders?.length || 0,
  };

  const orders: SupplyOrder[] = (ordersResult.orders || []).map((o) => ({
    id: o.id,
    rid: o.rid,
    createdAt: o.createdAt,
    warehouseId: o.warehouseId,
    supplyId: o.supplyId,
    barcodes: o.barcodes || [],
    address: o.address,
    user: o.user,
    skus: o.skus || [],
    price: o.price,
    convertedPrice: o.convertedPrice,
    currencyCode: o.currencyCode,
    cargoType: o.cargoType,
  }));

  await logRead('wb_get_supply', 'supplies', input, {
    supplyId,
    ordersCount: orders.length,
  });

  return { supply, orders };
}

/**
 * Создать новую поставку
 * POST /api/v3/supplies
 */
export async function createSupply(input: CreateSupplyInput): Promise<{
  supply?: SupplyData;
  preview: boolean;
  message: string;
}> {
  const { name, confirm } = input;

  const supplyName = name || `Поставка ${new Date().toLocaleDateString('ru-RU')}`;

  if (!confirm) {
    return {
      preview: true,
      message: `📦 **Preview создания поставки**\n\n` +
        `**Название:** ${supplyName}\n\n` +
        `Для создания поставки добавьте \`confirm=true\``,
    };
  }

  const result = await fetchWB<{
    id: string;
  }>(`${WB_API_URLS.marketplace}/api/v3/supplies`, {
    method: 'POST',
    body: JSON.stringify({ name: supplyName }),
  });

  const supply: SupplyData = {
    id: result.id,
    name: supplyName,
    createdAt: new Date().toISOString(),
    done: false,
    isLargeCargo: false,
  };

  // Операции с поставками FBS в журнал пишутся без автоматического отката
  journalWrite({
    tool: 'wb_create_supply',
    entity: { type: 'supply', id: String((input as Record<string, unknown>).supplyId ?? '') },
    before: null,
    after: input,
    response: {
    supplyId: result.id,
    name: supplyName,
  },
    ok: true,
    reversible: false,
  });

  return {
    supply,
    preview: false,
    message: `✅ Поставка создана: **${result.id}**\n\nДобавьте заказы через \`wb_add_to_supply\``,
  };
}

/**
 * Добавить заказы в поставку
 * PATCH /api/v3/supplies/{supplyId}/orders/{orderId}
 */
export async function addToSupply(input: AddToSupplyInput): Promise<{
  added: number;
  failed: number;
  preview: boolean;
  message: string;
}> {
  const { supplyId, orderIds, confirm } = input;

  if (!confirm) {
    return {
      added: 0,
      failed: 0,
      preview: true,
      message: `📦 **Preview добавления в поставку**\n\n` +
        `**Поставка:** ${supplyId}\n` +
        `**Заказов:** ${orderIds.length}\n` +
        `**ID заказов:** ${orderIds.slice(0, 10).join(', ')}${orderIds.length > 10 ? '...' : ''}\n\n` +
        `Для добавления укажите \`confirm=true\``,
    };
  }

  let added = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const orderId of orderIds) {
    try {
      await fetchWB<void>(
        `${WB_API_URLS.marketplace}/api/v3/supplies/${supplyId}/orders/${orderId}`,
        { method: 'PATCH' }
      );
      added++;
    } catch (error) {
      failed++;
      errors.push(`Заказ ${orderId}: ${error instanceof Error ? error.message : 'Ошибка'}`);
    }
  }

  // Операции с поставками FBS в журнал пишутся без автоматического отката
  journalWrite({
    tool: 'wb_add_to_supply',
    entity: { type: 'supply', id: String((input as Record<string, unknown>).supplyId ?? '') },
    before: null,
    after: input,
    response: { added, failed },
    ok: true,
    reversible: false,
  });

  let message = `✅ Добавлено в поставку ${supplyId}:\n` +
    `• Успешно: ${added}\n` +
    `• Ошибок: ${failed}`;

  if (errors.length > 0) {
    message += `\n\n⚠️ Ошибки:\n${errors.slice(0, 5).join('\n')}`;
    if (errors.length > 5) {
      message += `\n...и ещё ${errors.length - 5} ошибок`;
    }
  }

  return { added, failed, preview: false, message };
}

/**
 * Закрыть поставку (передать в доставку)
 * PATCH /api/v3/supplies/{supplyId}/deliver
 */
export async function closeSupply(input: CloseSupplyInput): Promise<{
  closed: boolean;
  preview: boolean;
  message: string;
}> {
  const { supplyId, confirm } = input;

  // Получаем информацию о поставке
  const { supply, orders } = await getSupply({ supplyId });

  if (supply.done) {
    return {
      closed: false,
      preview: false,
      message: `⚠️ Поставка ${supplyId} уже закрыта`,
    };
  }

  if (!confirm) {
    return {
      closed: false,
      preview: true,
      message: `📦 **Preview закрытия поставки**\n\n` +
        `**ID:** ${supplyId}\n` +
        `**Название:** ${supply.name}\n` +
        `**Заказов:** ${orders.length}\n` +
        `**Создана:** ${new Date(supply.createdAt).toLocaleDateString('ru-RU')}\n\n` +
        `⚠️ После закрытия поставку нельзя изменить!\n\n` +
        `Для закрытия укажите \`confirm=true\``,
    };
  }

  await fetchWB<void>(
    `${WB_API_URLS.marketplace}/api/v3/supplies/${supplyId}/deliver`,
    { method: 'PATCH' }
  );

  // Операции с поставками FBS в журнал пишутся без автоматического отката
  journalWrite({
    tool: 'wb_close_supply',
    entity: { type: 'supply', id: String((input as Record<string, unknown>).supplyId ?? '') },
    before: null,
    after: input,
    response: {
    supplyId,
    ordersCount: orders.length,
  },
    ok: true,
    reversible: false,
  });

  return {
    closed: true,
    preview: false,
    message: `✅ Поставка ${supplyId} закрыта и передана в доставку\n\n` +
      `• Заказов: ${orders.length}\n` +
      `• Следующий шаг: привезите товары на склад WB`,
  };
}

/**
 * Удалить поставку
 * DELETE /api/v3/supplies/{supplyId}
 */
export async function deleteSupply(input: DeleteSupplyInput): Promise<{
  deleted: boolean;
  preview: boolean;
  message: string;
}> {
  const { supplyId, confirm } = input;

  // Получаем информацию о поставке
  const { supply, orders } = await getSupply({ supplyId });

  if (supply.done) {
    return {
      deleted: false,
      preview: false,
      message: `⚠️ Нельзя удалить закрытую поставку ${supplyId}`,
    };
  }

  if (!confirm) {
    return {
      deleted: false,
      preview: true,
      message: `🗑️ **Preview удаления поставки**\n\n` +
        `**ID:** ${supplyId}\n` +
        `**Название:** ${supply.name}\n` +
        `**Заказов:** ${orders.length}\n\n` +
        `⚠️ Все заказы будут возвращены в список ожидающих сборки!\n\n` +
        `Для удаления укажите \`confirm=true\``,
    };
  }

  await fetchWB<void>(
    `${WB_API_URLS.marketplace}/api/v3/supplies/${supplyId}`,
    { method: 'DELETE' }
  );

  // Операции с поставками FBS в журнал пишутся без автоматического отката
  journalWrite({
    tool: 'wb_delete_supply',
    entity: { type: 'supply', id: String((input as Record<string, unknown>).supplyId ?? '') },
    before: null,
    after: input,
    response: {
    supplyId,
    ordersCount: orders.length,
  },
    ok: true,
    reversible: false,
  });

  return {
    deleted: true,
    preview: false,
    message: `✅ Поставка ${supplyId} удалена\n\n` +
      `• Заказов возвращено: ${orders.length}`,
  };
}

// ==================== Formatters ====================

/**
 * Форматировать список поставок как Markdown
 */
export function formatSuppliesAsMarkdown(supplies: SupplyData[]): string {
  const lines: string[] = [
    '## Поставки Wildberries',
    '',
  ];

  const active = supplies.filter((s) => !s.done);
  const closed = supplies.filter((s) => s.done);

  if (active.length > 0) {
    lines.push('### 📦 Активные поставки');
    lines.push('');
    lines.push('| ID | Название | Создана | Заказов |');
    lines.push('|----|----------|---------|---------|');

    for (const s of active) {
      const date = new Date(s.createdAt).toLocaleDateString('ru-RU');
      const orders = s.ordersCount !== undefined ? s.ordersCount : '—';
      lines.push(`| ${s.id} | ${s.name} | ${date} | ${orders} |`);
    }
    lines.push('');
  }

  if (closed.length > 0) {
    lines.push('### ✅ Закрытые поставки');
    lines.push('');
    lines.push('| ID | Название | Закрыта | Заказов |');
    lines.push('|----|----------|---------|---------|');

    for (const s of closed.slice(0, 10)) {
      const date = s.closedAt
        ? new Date(s.closedAt).toLocaleDateString('ru-RU')
        : '—';
      const orders = s.ordersCount !== undefined ? s.ordersCount : '—';
      lines.push(`| ${s.id} | ${s.name} | ${date} | ${orders} |`);
    }

    if (closed.length > 10) {
      lines.push(`\n> Показано 10 из ${closed.length} закрытых поставок`);
    }
    lines.push('');
  }

  lines.push(`**Всего поставок:** ${supplies.length} (активных: ${active.length}, закрытых: ${closed.length})`);

  return lines.join('\n');
}

/**
 * Форматировать детали поставки как Markdown
 */
export function formatSupplyDetailsAsMarkdown(
  supply: SupplyData,
  orders: SupplyOrder[]
): string {
  const lines: string[] = [
    `## Поставка ${supply.id}`,
    '',
    `**Название:** ${supply.name}`,
    `**Статус:** ${supply.done ? '✅ Закрыта' : '📦 Активная'}`,
    `**Создана:** ${new Date(supply.createdAt).toLocaleString('ru-RU')}`,
  ];

  if (supply.closedAt) {
    lines.push(`**Закрыта:** ${new Date(supply.closedAt).toLocaleString('ru-RU')}`);
  }

  lines.push('');
  lines.push(`### Заказы (${orders.length})`);
  lines.push('');

  if (orders.length > 0) {
    lines.push('| ID | Дата | SKU | Цена |');
    lines.push('|----|------|-----|------|');

    for (const o of orders.slice(0, 30)) {
      const date = new Date(o.createdAt).toLocaleDateString('ru-RU');
      const skus = o.skus.length > 0 ? o.skus[0] : '—';
      const price = (o.convertedPrice / 100).toLocaleString('ru-RU');
      lines.push(`| ${o.id} | ${date} | ${skus} | ${price} ₽ |`);
    }

    if (orders.length > 30) {
      lines.push(`\n> Показано 30 из ${orders.length} заказов`);
    }
  } else {
    lines.push('*Нет заказов в поставке*');
  }

  const totalPrice = orders.reduce((sum, o) => sum + o.convertedPrice, 0) / 100;
  lines.push('');
  lines.push(`**Общая сумма:** ${totalPrice.toLocaleString('ru-RU')} ₽`);

  return lines.join('\n');
}
