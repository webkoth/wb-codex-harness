/**
 * Confirmation system for write operations
 * Implements БЫЛО → СТАЛО preview for all data changes
 */

export interface FieldChange {
  field: string;
  was: unknown;
  becomes: unknown;
  diff?: string;  // Human-readable diff like "-20%" or "+5 шт"
}

export interface ConfirmationPreview {
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  changes: FieldChange[];
  confirmationRequired: true;
  message: string;
}

export interface ConfirmationResult {
  confirmed: false;
  preview: ConfirmationPreview;
}

export interface ExecutionResult<T> {
  confirmed: true;
  result: T;
}

export type WriteOperationResult<T> = ConfirmationResult | ExecutionResult<T>;

/**
 * Calculate percentage difference between two numbers
 */
function calculatePercentDiff(was: number, becomes: number): string {
  if (was === 0) return becomes > 0 ? '+100%' : '0%';
  const diff = ((becomes - was) / was) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}%`;
}

/**
 * Calculate absolute difference
 */
function calculateAbsDiff(was: number, becomes: number, unit = ''): string {
  const diff = becomes - was;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff}${unit}`;
}

/**
 * Create a field change object
 */
export function createFieldChange(
  field: string,
  was: unknown,
  becomes: unknown,
  options?: { unit?: string; isPercent?: boolean }
): FieldChange {
  const change: FieldChange = { field, was, becomes };

  if (typeof was === 'number' && typeof becomes === 'number') {
    if (options?.isPercent) {
      change.diff = calculateAbsDiff(was, becomes, '%');
    } else if (options?.unit) {
      change.diff = calculateAbsDiff(was, becomes, options.unit);
    } else {
      change.diff = calculatePercentDiff(was, becomes);
    }
  }

  return change;
}

/**
 * Create price change preview
 */
export function createPriceChangePreview(params: {
  nmId: string;
  productName?: string;
  currentPrice: number;
  newPrice: number;
  currentDiscount?: number;
  newDiscount?: number;
  currentFinalPrice?: number;
  toolName: string;
}): ConfirmationPreview {
  const changes: FieldChange[] = [];

  changes.push(
    createFieldChange('price', params.currentPrice, params.newPrice, { unit: '₽' })
  );

  if (params.currentDiscount !== undefined && params.newDiscount !== undefined) {
    changes.push(
      createFieldChange('discount', params.currentDiscount, params.newDiscount, { isPercent: true })
    );
  }

  // Цена со скидкой: для "БЫЛО" — фактическое значение от WB (если передано),
  // для "СТАЛО" — проекция по новой скидке (точного discountedPrice ещё нет).
  const oldFinalPrice =
    params.currentFinalPrice ?? Math.round(params.currentPrice * (1 - (params.currentDiscount || 0) / 100));
  const newFinalPrice = Math.round(params.newPrice * (1 - (params.newDiscount || 0) / 100));
  changes.push(
    createFieldChange('finalPrice', Math.round(oldFinalPrice), newFinalPrice, { unit: '₽' })
  );

  return {
    action: 'UPDATE_PRICE',
    entityType: 'product',
    entityId: params.nmId,
    entityName: params.productName,
    changes,
    confirmationRequired: true,
    message: `Для применения изменений вызовите ${params.toolName} с параметром confirm: true`,
  };
}

/**
 * Create review reply preview
 */
export function createReviewReplyPreview(params: {
  reviewId: string;
  reviewText: string;
  reviewRating: number;
  currentResponse?: string | null;
  newResponse: string;
  toolName: string;
}): ConfirmationPreview {
  const changes: FieldChange[] = [
    createFieldChange('response', params.currentResponse || '(нет ответа)', params.newResponse),
  ];

  return {
    action: 'REPLY_REVIEW',
    entityType: 'review',
    entityId: params.reviewId,
    entityName: `Отзыв ${params.reviewRating} на товар`,
    changes,
    confirmationRequired: true,
    message: `Для отправки ответа вызовите ${params.toolName} с параметром confirm: true`,
  };
}

/**
 * Create stock update preview
 */
export function createStockUpdatePreview(params: {
  nmId: string;
  productName?: string;
  warehouseId: string;
  warehouseName?: string;
  currentStock: number;
  newStock: number;
  toolName: string;
}): ConfirmationPreview {
  const changes: FieldChange[] = [
    createFieldChange('stock', params.currentStock, params.newStock, { unit: ' шт' }),
  ];

  return {
    action: 'UPDATE_STOCK',
    entityType: 'product_stock',
    entityId: `${params.nmId}:${params.warehouseId}`,
    entityName: params.productName ? `${params.productName} @ ${params.warehouseName || params.warehouseId}` : undefined,
    changes,
    confirmationRequired: true,
    message: `Для обновления остатков вызовите ${params.toolName} с параметром confirm: true`,
  };
}

/**
 * Create card update preview
 */
export function createCardUpdatePreview(params: {
  nmId: string;
  productName?: string;
  fieldChanges: Array<{ field: string; was: unknown; becomes: unknown }>;
  toolName: string;
}): ConfirmationPreview {
  const changes: FieldChange[] = params.fieldChanges.map((fc) =>
    createFieldChange(fc.field, fc.was, fc.becomes)
  );

  return {
    action: 'UPDATE_CARD',
    entityType: 'product_card',
    entityId: params.nmId,
    entityName: params.productName,
    changes,
    confirmationRequired: true,
    message: `Для обновления карточки вызовите ${params.toolName} с параметром confirm: true`,
  };
}

/**
 * Format preview for display
 */
export function formatPreviewForDisplay(preview: ConfirmationPreview): string {
  const lines: string[] = [
    `## Подтверждение: ${preview.action}`,
    '',
    `**${preview.entityType}**: ${preview.entityName || preview.entityId}`,
    '',
    '### Изменения (БЫЛО → СТАЛО):',
    '',
    '| Поле | БЫЛО | СТАЛО | Изменение |',
    '|------|------|-------|-----------|',
  ];

  for (const change of preview.changes) {
    const was = typeof change.was === 'string' ? change.was : JSON.stringify(change.was);
    const becomes = typeof change.becomes === 'string' ? change.becomes : JSON.stringify(change.becomes);
    const diff = change.diff || '—';
    lines.push(`| ${change.field} | ${was} | ${becomes} | ${diff} |`);
  }

  lines.push('');
  lines.push(`> ${preview.message}`);

  return lines.join('\n');
}

/**
 * Create a confirmation result (operation not confirmed)
 */
export function needsConfirmation(preview: ConfirmationPreview): ConfirmationResult {
  return {
    confirmed: false,
    preview,
  };
}

/**
 * Create an execution result (operation confirmed and executed)
 */
export function confirmed<T>(result: T): ExecutionResult<T> {
  return {
    confirmed: true,
    result,
  };
}
