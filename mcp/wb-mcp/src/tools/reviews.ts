import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead, logWriteWithPreview, logError, journalWrite } from '../utils/logger.js';
import {
  createReviewReplyPreview,
  formatPreviewForDisplay,
  needsConfirmation,
  confirmed,
  type WriteOperationResult,
} from '../utils/confirmation.js';

// Input schema for wb_get_reviews
export const GetReviewsInputSchema = z.object({
  nmId: z.number().optional().describe('Filter by product nmId'),
  isAnswered: z.boolean().optional().describe('Filter: true=answered, false=unanswered'),
  take: z.number().optional().default(50).describe('Number of reviews to return (max 10000)'),
  skip: z.number().optional().default(0).describe('Offset for pagination'),
  order: z.enum(['dateAsc', 'dateDesc']).optional().default('dateDesc').describe('Sort order'),
});

export type GetReviewsInput = z.infer<typeof GetReviewsInputSchema>;

// Input schema for wb_reply_review
export const ReplyReviewInputSchema = z.object({
  reviewId: z.string().describe('Review ID to reply to'),
  text: z.string().describe('Reply text'),
  confirm: z.boolean().optional().default(false).describe('Set to true to confirm and send reply'),
});

export type ReplyReviewInput = z.infer<typeof ReplyReviewInputSchema>;

// Review data interface
interface ReviewData {
  id: string;
  nmId: number;
  productName?: string;
  userName: string;
  text: string;
  rating: number;
  createdDate: string;
  answer?: {
    text: string;
    createdDate: string;
  };
  photos?: string[];
  pros?: string;
  cons?: string;
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
 * Get reviews from WB Feedbacks API
 */
export async function getReviews(input: GetReviewsInput): Promise<{
  reviews: ReviewData[];
  total: number;
  hasMore: boolean;
}> {
  const { nmId, isAnswered, take, skip, order } = input;

  // WB feedbacks требует обязательный isAnswered. Если фильтр не задан —
  // запрашиваем оба набора (с ответом и без) и объединяем.
  type RawFeedback = {
    id: string;
    nmId: number;
    productDetails?: { productName?: string };
    userName: string;
    text: string;
    productValuation: number;
    createdDate: string;
    answer?: { text: string; createdDate: string };
    photoLinks?: Array<{ fullSize: string }>;
    pros?: string;
    cons?: string;
  };

  const flags = isAnswered === undefined ? [false, true] : [isAnswered];

  let feedbacks: RawFeedback[] = [];
  for (const flag of flags) {
    const params = new URLSearchParams({
      take: take.toString(),
      skip: skip.toString(),
      order,
      isAnswered: flag.toString(),
    });
    if (nmId !== undefined) {
      params.set('nmId', nmId.toString());
    }

    const url = `${WB_API_URLS.feedbacks}/api/v1/feedbacks?${params}`;
    const result = await fetchWB<{ data?: { feedbacks?: RawFeedback[] } }>(url);
    feedbacks = feedbacks.concat(result.data?.feedbacks || []);
  }

  // При объединённом запросе сортируем по дате и обрезаем до take
  if (flags.length > 1) {
    feedbacks.sort((a, b) =>
      order === 'dateAsc'
        ? new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime()
        : new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
    );
    feedbacks = feedbacks.slice(0, take);
  }

  const reviews: ReviewData[] = feedbacks.map((f) => ({
    id: f.id,
    nmId: f.nmId,
    productName: f.productDetails?.productName,
    userName: f.userName,
    text: f.text,
    rating: f.productValuation,
    createdDate: f.createdDate,
    answer: f.answer,
    photos: f.photoLinks?.map((p) => p.fullSize),
    pros: f.pros,
    cons: f.cons,
  }));

  await logRead('wb_get_reviews', 'reviews', input, { count: reviews.length });

  return {
    reviews,
    total: reviews.length,
    hasMore: reviews.length === take,
  };
}

/**
 * Get single review by ID (for confirmation preview)
 */
async function getReviewById(reviewId: string): Promise<ReviewData | null> {
  // WB API doesn't have a direct "get by ID" endpoint
  // We'll try to find it in recent feedbacks
  const result = await getReviews({ take: 1000, skip: 0, order: 'dateDesc' });
  return result.reviews.find((r) => r.id === reviewId) || null;
}

/**
 * Reply to a review with confirmation system
 */
export async function replyReview(
  input: ReplyReviewInput
): Promise<WriteOperationResult<{ success: boolean; reviewId: string }>> {
  const { reviewId, text, confirm } = input;

  // Get current review for preview
  const review = await getReviewById(reviewId);
  if (!review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  // If not confirmed, return preview
  if (!confirm) {
    const preview = createReviewReplyPreview({
      reviewId,
      reviewText: review.text,
      reviewRating: review.rating,
      currentResponse: review.answer?.text || null,
      newResponse: text,
      toolName: 'wb_reply_review',
    });

    await logWriteWithPreview('wb_reply_review', 'reviews', input, preview as unknown as Record<string, unknown>);

    return needsConfirmation(preview);
  }

  // Confirmed - send reply
  try {
    const url = `${WB_API_URLS.feedbacks}/api/v1/feedbacks`;

    await fetchWB<{ data?: unknown; error?: boolean; errorText?: string }>(url, {
      method: 'PATCH',
      body: JSON.stringify({
        id: reviewId,
        text,
      }),
    });

    const preview = createReviewReplyPreview({
      reviewId,
      reviewText: review.text,
      reviewRating: review.rating,
      currentResponse: review.answer?.text || null,
      newResponse: text,
      toolName: 'wb_reply_review',
    });

    // Ответ на отзыв откатить нельзя: WB не даёт удалить опубликованный ответ
    journalWrite({
      tool: 'wb_reply_review',
      entity: { type: 'review', id: reviewId },
      before: { answer: review.answer?.text || null, rating: review.rating, text: review.text },
      after: { answer: text },
      ok: true,
      reversible: false,
    });
    void preview;

    return confirmed({
      success: true,
      reviewId,
    });
  } catch (error) {
    journalWrite({
      tool: 'wb_reply_review',
      entity: { type: 'review', id: reviewId },
      before: { answer: review.answer?.text || null },
      after: { answer: text },
      ok: false,
      reversible: false,
      error: (error as Error).message,
    });
    await logError('wb_reply_review', 'reviews', input, error as Error);
    throw error;
  }
}

/**
 * Format reviews as markdown
 */
export function formatReviewsAsMarkdown(reviews: ReviewData[]): string {
  if (reviews.length === 0) {
    return 'Отзывы не найдены';
  }

  const lines: string[] = [];

  for (const r of reviews.slice(0, 20)) {
    const stars = '⭐'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    const answered = r.answer ? '✅' : '❌';
    const date = new Date(r.createdDate).toLocaleDateString('ru-RU');

    lines.push(`### ${stars} от ${r.userName} (${date}) ${answered}`);
    lines.push(`**nmId:** ${r.nmId}${r.productName ? ` | ${r.productName}` : ''}`);
    lines.push('');

    if (r.pros) lines.push(`**Достоинства:** ${r.pros}`);
    if (r.cons) lines.push(`**Недостатки:** ${r.cons}`);
    if (r.text) lines.push(`**Комментарий:** ${r.text.substring(0, 200)}${r.text.length > 200 ? '...' : ''}`);

    if (r.answer) {
      lines.push(`\n> **Ответ:** ${r.answer.text.substring(0, 150)}${r.answer.text.length > 150 ? '...' : ''}`);
    }

    lines.push('\n---\n');
  }

  if (reviews.length > 20) {
    lines.push(`\n... и ещё ${reviews.length - 20} отзывов`);
  }

  // Summary
  const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const unanswered = reviews.filter((r) => !r.answer).length;

  lines.push(`\n**Всего:** ${reviews.length} | **Средний рейтинг:** ${avgRating.toFixed(1)} | **Без ответа:** ${unanswered}`);

  return lines.join('\n');
}

/**
 * Format reply result for display
 */
export function formatReplyResult(
  result: WriteOperationResult<{ success: boolean; reviewId: string }>
): string {
  if (!result.confirmed) {
    return formatPreviewForDisplay(result.preview);
  }

  return [
    '## Ответ на отзыв отправлен',
    '',
    `**ID отзыва:** ${result.result.reviewId}`,
    '',
    'Ответ успешно опубликован на Wildberries.',
  ].join('\n');
}
