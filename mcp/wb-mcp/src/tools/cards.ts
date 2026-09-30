import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead, logWriteWithPreview, journalWrite } from '../utils/logger.js';
import { createCardUpdatePreview, formatPreviewForDisplay, ConfirmationPreview } from '../utils/confirmation.js';

// Input schema for wb_get_cards
export const GetCardsInputSchema = z.object({
  nmIds: z.array(z.number()).optional().describe('Filter by specific nmIds'),
  vendorCodes: z.array(z.string()).optional().describe('Filter by vendor codes (SKUs)'),
  limit: z.number().optional().default(100).describe('Maximum number of cards to return'),
  withPhoto: z.boolean().optional().default(true).describe('Filter: -1=all, 0=without photo, 1=with photo'),
});

export type GetCardsInput = z.infer<typeof GetCardsInputSchema>;

// Input schema for wb_update_card
export const UpdateCardInputSchema = z.object({
  nmId: z.number().describe('Артикул WB (nmId)'),
  vendorCode: z.string().optional().describe('Артикул продавца (если не передан, будет получен из карточки)'),
  title: z.string().optional().describe('Новое название'),
  description: z.string().optional().describe('Новое описание'),
  characteristics: z.array(
    z.object({
      id: z.number(),
      value: z.union([z.string(), z.array(z.string())]),
    })
  ).optional().describe('Характеристики для обновления (требуют ID характеристики)'),
  dimensions: z.object({
    length: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional().describe('Габариты упаковки'),
  confirm: z.boolean().optional().default(false).describe('true — отправить изменения в WB; без него только preview'),
});

export type UpdateCardInput = z.infer<typeof UpdateCardInputSchema>;

// Card data interface
interface CardData {
  nmId: number;
  imtId: number;
  vendorCode: string;
  subjectId: number;
  subjectName: string;
  brand: string;
  title: string;
  description?: string;
  photos: string[];
  video?: string;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  characteristics: Array<{
    id: number;
    name: string;
    value: string | string[];
  }>;
  sizes: Array<{
    techSize: string;
    wbSize: string;
    skus: string[];
  }>;
  createdAt: string;
  updatedAt: string;
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
 * Get product cards from WB Content API
 */
export async function getCards(input: GetCardsInput): Promise<{
  cards: CardData[];
  total: number;
}> {
  const { nmIds, vendorCodes, limit, withPhoto } = input;
  const url = `${WB_API_URLS.content}/content/v2/get/cards/list`;
  const allCards: CardData[] = [];

  let cursor: Record<string, unknown> = { limit: Math.min(100, limit) };

  while (allCards.length < limit) {
    const filter: Record<string, unknown> = {
      withPhoto: withPhoto ? 1 : -1,
    };

    // Add nmIds filter if specified
    if (nmIds && nmIds.length > 0) {
      filter.nmID = nmIds;
    }

    // Add vendorCodes filter if specified
    if (vendorCodes && vendorCodes.length > 0) {
      filter.vendorCode = vendorCodes;
    }

    const result = await fetchWB<{
      cards?: Array<{
        nmID: number;
        imtID: number;
        vendorCode: string;
        subjectID: number;
        subjectName: string;
        brand: string;
        title: string;
        description?: string;
        photos: Array<{ big: string; c246x328: string; c516x688: string }>;
        video?: string;
        dimensions?: { length: number; width: number; height: number };
        characteristics: Array<{ id: number; name: string; value: string | string[] }>;
        sizes: Array<{ techSize: string; wbSize: string; skus: string[] }>;
        createdAt: string;
        updatedAt: string;
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
          filter,
        },
      }),
    });

    const cards = result.cards || [];
    if (cards.length === 0) break;

    for (const card of cards) {
      const cardData: CardData = {
        nmId: card.nmID,
        imtId: card.imtID,
        vendorCode: card.vendorCode,
        subjectId: card.subjectID,
        subjectName: card.subjectName,
        brand: card.brand,
        title: card.title,
        description: card.description,
        photos: card.photos?.map((p) => p.big) || [],
        video: card.video,
        dimensions: card.dimensions,
        characteristics: card.characteristics || [],
        sizes: card.sizes || [],
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      };

      allCards.push(cardData);

      if (allCards.length >= limit) break;
    }

    const total = result.cursor?.total || 0;
    if (total < (cursor.limit as number)) break;

    cursor = {
      limit: Math.min(100, limit - allCards.length),
      updatedAt: result.cursor?.updatedAt,
      nmID: result.cursor?.nmID,
    };
  }

  await logRead('wb_get_cards', 'cards', input, { count: allCards.length });

  return {
    cards: allCards,
    total: allCards.length,
  };
}

/** Сырая карточка из /content/v2/get/cards/list — все поля как пришли от WB. */
export type RawCard = Record<string, unknown> & {
  nmID: number;
  vendorCode: string;
  title?: string;
  description?: string;
  characteristics?: Array<{ id: number; name?: string; value: unknown }>;
  dimensions?: Record<string, unknown>;
};

/**
 * Поля, которые принимает /content/v2/cards/update. Всё остальное (photos, video,
 * tags, createdAt, updatedAt, imtID, nmUUID, subjectID…) методом не меняется и
 * в запрос не идёт. Update перезаписывает карточку целиком, поэтому каждое поле
 * из этого списка берём из свежей карточки, а меняем только запрошенные.
 */
const UPDATABLE_FIELDS = ['nmID', 'vendorCode', 'brand', 'title', 'description', 'dimensions', 'characteristics', 'sizes', 'documents'];

const TITLE_MAX = 60;

/**
 * Свежая сырая карточка по nmID. Сначала textSearch (WB ищет по nmID/артикулу),
 * если не нашли — перебор всех карточек с локальным фильтром.
 */
export async function fetchRawCard(nmId: number): Promise<RawCard> {
  const url = `${WB_API_URLS.content}/content/v2/get/cards/list`;
  type ListResp = { cards?: RawCard[]; cursor?: { total: number; updatedAt?: string; nmID?: number } };

  const quick = await fetchWB<ListResp>(url, {
    method: 'POST',
    body: JSON.stringify({ settings: { cursor: { limit: 100 }, filter: { textSearch: String(nmId), withPhoto: -1 } } }),
  });
  const hit = (quick.cards || []).find((c) => c.nmID === nmId);
  if (hit) return hit;

  // Запасной путь: WB иногда игнорирует фильтр — листаем всё
  let cursor: Record<string, unknown> = { limit: 100 };
  for (let page = 0; page < 200; page++) {
    const res = await fetchWB<ListResp>(url, {
      method: 'POST',
      body: JSON.stringify({ settings: { cursor, filter: { withPhoto: -1 } } }),
    });
    const cards = res.cards || [];
    const found = cards.find((c) => c.nmID === nmId);
    if (found) return found;
    if (cards.length === 0 || (res.cursor?.total || 0) < 100) break;
    cursor = { limit: 100, updatedAt: res.cursor?.updatedAt, nmID: res.cursor?.nmID };
  }
  throw new Error(`Карточка с nmId ${nmId} не найдена. Проверьте правильность nmId.`);
}

/** Тело запроса на update из сырой карточки: только изменяемые поля. */
export function toUpdatePayload(raw: RawCard): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of UPDATABLE_FIELDS) {
    if (raw[f] !== undefined) payload[f] = raw[f];
  }
  if (Array.isArray(raw.characteristics)) {
    payload.characteristics = raw.characteristics.map((c) => ({ id: c.id, value: c.value }));
  }
  return payload;
}

/**
 * Отправить карточку в WB и проверить список ошибок: ответ 200 от update ещё
 * не значит, что правка применилась.
 */
export async function postCardUpdate(payload: Record<string, unknown>): Promise<{ response: unknown; errors: unknown[] }> {
  const response = await fetchWB<unknown>(`${WB_API_URLS.content}/content/v2/cards/update`, {
    method: 'POST',
    body: JSON.stringify([payload]),
  });

  // Ошибки появляются в error/list не сразу
  await new Promise((r) => setTimeout(r, 4000));
  const errors = await fetchCardErrors(String(payload.vendorCode ?? ''), Number(payload.nmID));
  return { response, errors };
}

async function fetchCardErrors(vendorCode: string, nmId: number): Promise<unknown[]> {
  const url = `${WB_API_URLS.content}/content/v2/cards/error/list`;
  let res: unknown;
  try {
    // Только POST (swagger 30.09.2026); свежие пакеты первыми
    res = await fetchWB<unknown>(url, {
      method: 'POST',
      body: JSON.stringify({ cursor: { limit: 100 }, order: { ascending: false } }),
    });
  } catch (err) {
    return [{ warning: `Не удалось проверить error/list: ${(err as Error).message}` }];
  }
  // Форма ответа менялась ({data:[…]} / {data:{items:[…]}}) — ищем свои строки по вхождению
  const data = (res as { data?: unknown })?.data;
  const items: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown[] })?.items)
      ? (data as { items: unknown[] }).items
      : [];
  return items.filter((it) => {
    const txt = JSON.stringify(it);
    return (vendorCode && txt.includes(`"${vendorCode}"`)) || txt.includes(String(nmId));
  });
}

export interface UpdateCardResult {
  confirmed: boolean;
  preview?: ConfirmationPreview;
  success?: boolean;
  message: string;
  journalId?: string;
  errors?: unknown[];
}

/**
 * Обновить карточку: без confirm — preview БЫЛО → СТАЛО, с confirm — запись.
 * Схема: свежая сырая карточка → правка только запрошенных полей → update →
 * проверка error/list → журнал с полной карточкой «до» для отката.
 */
export async function updateCard(input: UpdateCardInput): Promise<UpdateCardResult> {
  const { nmId, confirm, ...updates } = input;

  if (updates.title !== undefined && updates.title.length > TITLE_MAX) {
    throw new Error(`Название ${updates.title.length} символов, WB принимает не больше ${TITLE_MAX}.`);
  }

  const before = await fetchRawCard(nmId);
  const after: RawCard = JSON.parse(JSON.stringify(before));
  const fieldChanges: Array<{ field: string; was: unknown; becomes: unknown }> = [];

  if (updates.title !== undefined && updates.title !== before.title) {
    fieldChanges.push({ field: 'title', was: before.title ?? '', becomes: updates.title });
    after.title = updates.title;
  }
  if (updates.description !== undefined && updates.description !== before.description) {
    fieldChanges.push({ field: 'description', was: before.description ?? '', becomes: updates.description });
    after.description = updates.description;
  }
  if (updates.vendorCode !== undefined && updates.vendorCode !== before.vendorCode) {
    fieldChanges.push({ field: 'vendorCode', was: before.vendorCode, becomes: updates.vendorCode });
    after.vendorCode = updates.vendorCode;
  }
  if (updates.dimensions) {
    const was = before.dimensions || {};
    const merged = { ...was, ...updates.dimensions };
    fieldChanges.push({ field: 'dimensions', was, becomes: merged });
    after.dimensions = merged;
  }
  if (updates.characteristics && updates.characteristics.length > 0) {
    const list = [...(before.characteristics || [])];
    for (const u of updates.characteristics) {
      const i = list.findIndex((c) => c.id === u.id);
      const was = i >= 0 ? list[i].value : '(нет)';
      fieldChanges.push({ field: `characteristic ${u.id}${i >= 0 && list[i].name ? ` (${list[i].name})` : ''}`, was, becomes: u.value });
      if (i >= 0) list[i] = { ...list[i], value: u.value };
      else list.push({ id: u.id, value: u.value });
    }
    after.characteristics = list;
  }

  if (fieldChanges.length === 0) {
    return { confirmed: false, message: 'Изменений нет: переданные значения совпадают с текущей карточкой.' };
  }

  const preview = createCardUpdatePreview({
    nmId: String(nmId),
    productName: before.title,
    fieldChanges,
    toolName: 'wb_update_card',
  });

  if (!confirm) {
    await logWriteWithPreview('wb_update_card', 'cards', input, preview as unknown as Record<string, unknown>);
    return { confirmed: false, preview, message: formatPreviewForDisplay(preview) };
  }

  try {
    const { response, errors } = await postCardUpdate(toUpdatePayload(after));
    const entry = journalWrite({
      tool: 'wb_update_card',
      entity: { type: 'card', id: nmId },
      before,
      after: toUpdatePayload(after),
      response: { response, errors },
      ok: errors.length === 0,
      reversible: true,
    });
    await logRead('wb_update_card', 'cards', input, { success: errors.length === 0 });

    if (errors.length > 0) {
      return {
        confirmed: true,
        success: false,
        journalId: entry.id,
        errors,
        message: `⚠️ WB принял запрос, но в error/list есть ошибки по карточке ${nmId}:\n${JSON.stringify(errors, null, 2)}`,
      };
    }
    return {
      confirmed: true,
      success: true,
      journalId: entry.id,
      errors: [],
      message: `✅ Карточка ${nmId} отправлена в WB (синхронизация до 30 минут). Запись журнала: ${entry.id}`,
    };
  } catch (error) {
    journalWrite({
      tool: 'wb_update_card',
      entity: { type: 'card', id: nmId },
      before,
      after: toUpdatePayload(after),
      ok: false,
      reversible: false,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Format cards as markdown table
 */
export function formatCardsAsMarkdown(cards: CardData[]): string {
  if (cards.length === 0) {
    return 'Карточки не найдены';
  }

  const lines = [
    '| nmId | Артикул | Название | Бренд | Категория | Фото | Размеры |',
    '|------|---------|----------|-------|-----------|------|---------|',
  ];

  for (const c of cards.slice(0, 50)) {
    const name = c.title.substring(0, 25);
    const photoCount = c.photos?.length || 0;
    const sizeCount = c.sizes?.length || 0;
    lines.push(
      `| ${c.nmId} | ${c.vendorCode} | ${name} | ${c.brand} | ${c.subjectName} | ${photoCount} | ${sizeCount} |`
    );
  }

  if (cards.length > 50) {
    lines.push(`\n... и ещё ${cards.length - 50} карточек`);
  }

  lines.push(`\n**Всего карточек:** ${cards.length}`);

  return lines.join('\n');
}
