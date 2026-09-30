import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead, logWriteWithPreview, journalWrite } from '../utils/logger.js';
import {
  roiStatus,
  formatNumber,
  formatRub,
  formatPercent,
  STATUS,
} from '../utils/visualize.js';

// Input schema for wb_get_campaigns
export const GetCampaignsInputSchema = z.object({
  status: z
    .enum(['active', 'paused', 'stopped', 'all'])
    .optional()
    .default('all')
    .describe('Filter by campaign status'),
  type: z
    .enum(['auction', 'auto', 'search', 'catalog', 'card', 'all'])
    .optional()
    .default('all')
    .describe('Filter by campaign type'),
  limit: z.number().optional().default(50).describe('Maximum number of campaigns'),
});

export type GetCampaignsInput = z.infer<typeof GetCampaignsInputSchema>;

// Input schema for wb_get_campaign_stats
export const GetCampaignStatsInputSchema = z.object({
  ids: z
    .array(z.number())
    .max(50)
    .describe('Campaign IDs to get statistics for (maximum 50)'),
  beginDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Start date for statistics period (YYYY-MM-DD)'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('End date for statistics period (YYYY-MM-DD)'),
});

export type GetCampaignStatsInput = z.infer<typeof GetCampaignStatsInputSchema>;

// Campaign data interface
interface CampaignData {
  id: number;
  name: string;
  type: string;
  typeName: string;
  status: string;
  statusName: string;
  dailyBudget?: number;
  createTime: string;
  changeTime: string;
  startTime?: string;
  endTime?: string;
  nmIds?: number[];
  stats?: {
    views: number;
    clicks: number;
    ctr: number;
    cpc: number;
    spend: number;
    orders: number;
    revenue: number;
  };
}

// Campaign statistics interface
interface CampaignStats {
  advertId: number;
  views: number;
  clicks: number;
  ctr: number;
  cpc: number;
  sum: number; // Total spend
  sum_price: number; // Total revenue
  orders: number;
  cr: number; // Conversion rate
  shks: number; // Number of orders paid
  atbs: number; // Orders added to cart
  days: Array<{
    date: string;
    views: number;
    clicks: number;
    ctr: number;
    cpc: number;
    sum: number;
    orders: number;
    cr: number;
  }>;
}

// Campaign type mapping
const CAMPAIGN_TYPES: Record<number, string> = {
  4: 'Каталог',
  5: 'Карточка товара',
  6: 'Поиск',
  7: 'Рекомендации',
  8: 'Автоматическая',
  9: 'Поиск + Каталог',
};

// Campaign status mapping
const CAMPAIGN_STATUSES: Record<number, string> = {
  4: 'Готова к запуску',
  7: 'Завершена',
  8: 'Отменена',
  9: 'Активна',
  11: 'На паузе',
};

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
 * Get advertising campaigns from WB Advert API
 */
export async function getCampaigns(input: GetCampaignsInput): Promise<{
  campaigns: CampaignData[];
  total: number;
  summary: {
    active: number;
    paused: number;
    totalBudget: number;
  };
}> {
  const { status, type, limit } = input;

  // Get campaign list
  const url = `${WB_API_URLS.advert}/adv/v1/promotion/count`;

  const countResult = await fetchWB<{
    adverts?: Array<{
      type: number;
      status: number;
      count: number;
      advert_list?: Array<{
        advertId: number;
        changeTime: string;
      }>;
    }>;
  }>(url);

  // Тип и статус кампании приходят на уровне группы count — строим список прямо из него.
  const typeFilter: Record<string, number[]> = {
    auction: [4, 5, 6],
    auto: [8],
    search: [6, 9],
    catalog: [4, 9],
    card: [5],
  };
  const statusFilter: Record<string, number[]> = {
    active: [9],
    paused: [11],
    stopped: [7, 8],
  };

  let campaigns: CampaignData[] = [];
  for (const group of countResult.adverts || []) {
    if (type !== 'all' && typeFilter[type] && !typeFilter[type].includes(group.type)) continue;
    if (status !== 'all' && statusFilter[status] && !statusFilter[status].includes(group.status)) continue;

    for (const item of group.advert_list || []) {
      campaigns.push({
        id: item.advertId,
        name: '',
        type: group.type.toString(),
        typeName: CAMPAIGN_TYPES[group.type] || `Тип ${group.type}`,
        status: group.status.toString(),
        statusName: CAMPAIGN_STATUSES[group.status] || `Статус ${group.status}`,
        createTime: '',
        changeTime: item.changeTime,
        nmIds: [],
      });
      if (campaigns.length >= limit) break;
    }
    if (campaigns.length >= limit) break;
  }

  if (campaigns.length === 0) {
    return {
      campaigns: [],
      total: 0,
      summary: { active: 0, paused: 0, totalBudget: 0 },
    };
  }

  // Опциональное обогащение деталями (name, budget, даты, nmIds).
  // WB периодически меняет этот эндпоинт; если он недоступен — отдаём данные из count.
  try {
    const ids = campaigns.map((c) => c.id);
    const detailsUrl = `${WB_API_URLS.advert}/adv/v1/promotion/adverts`;
    const details = await fetchWB<
      Array<{
        advertId: number;
        name?: string;
        dailyBudget?: number;
        createTime?: string;
        startTime?: string;
        endTime?: string;
        autoParams?: { nms?: number[] };
        unitedParams?: Array<{ nms?: number[] }>;
      }>
    >(detailsUrl, {
      method: 'POST',
      body: JSON.stringify(ids),
    });

    const byId = new Map((details || []).map((d) => [d.advertId, d]));
    campaigns = campaigns.map((c) => {
      const d = byId.get(c.id);
      if (!d) return c;
      let nmIds: number[] = [];
      if (d.autoParams?.nms) {
        nmIds = d.autoParams.nms;
      } else if (d.unitedParams) {
        for (const p of d.unitedParams) {
          if (p.nms) nmIds = [...nmIds, ...p.nms];
        }
      }
      return {
        ...c,
        name: d.name || c.name,
        dailyBudget: d.dailyBudget,
        createTime: d.createTime || c.createTime,
        startTime: d.startTime,
        endTime: d.endTime,
        nmIds,
      };
    });
  } catch (err) {
    console.error(
      `wb_get_campaigns: обогащение деталями недоступно (${(err as Error).message}). Возвращаю данные из promotion/count.`
    );
  }

  // Calculate summary
  const active = campaigns.filter((c) => c.status === '9').length;
  const paused = campaigns.filter((c) => c.status === '11').length;
  const totalBudget = campaigns.reduce((sum, c) => sum + (c.dailyBudget || 0), 0);

  await logRead('wb_get_campaigns', 'advertising', input, {
    count: campaigns.length,
    active,
    paused,
    totalBudget,
  });

  return {
    campaigns,
    total: campaigns.length,
    summary: {
      active,
      paused,
      totalBudget,
    },
  };
}

/**
 * Get campaign statistics from WB Advert API
 */
export async function getCampaignStats(input: GetCampaignStatsInput): Promise<{
  stats: CampaignStats[];
  period: { from: string; to: string };
  summary: {
    totalViews: number;
    totalClicks: number;
    avgCTR: number;
    avgCPC: number;
    totalSpend: number;
    totalRevenue: number;
    totalOrders: number;
    avgCR: number;
    ROI: number;
  };
}> {
  const { ids, beginDate, endDate } = input;

  // Validate date range (max 31 days)
  const begin = new Date(beginDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil((end.getTime() - begin.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays > 31) {
    throw new Error('Maximum period is 31 days');
  }

  if (diffDays < 0) {
    throw new Error('End date must be after start date');
  }

  // Build URL with query parameters
  const idsParam = ids.join(',');
  const url = `${WB_API_URLS.advert}/adv/v3/fullstats?ids=${idsParam}&beginDate=${beginDate}&endDate=${endDate}`;

  const statsData = await fetchWB<CampaignStats[]>(url);

  // Calculate summary
  let totalViews = 0;
  let totalClicks = 0;
  let totalSpend = 0;
  let totalRevenue = 0;
  let totalOrders = 0;
  let totalAtbs = 0;

  for (const stat of statsData) {
    totalViews += stat.views || 0;
    totalClicks += stat.clicks || 0;
    totalSpend += stat.sum || 0;
    totalRevenue += stat.sum_price || 0;
    totalOrders += stat.orders || 0;
    totalAtbs += stat.atbs || 0;
  }

  const avgCTR = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;
  const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const avgCR = totalClicks > 0 ? (totalOrders / totalClicks) * 100 : 0;
  const ROI = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0;

  await logRead('wb_get_campaign_stats', 'advertising', input, {
    campaigns: statsData.length,
    totalSpend,
    totalRevenue,
    ROI: ROI.toFixed(2),
  });

  return {
    stats: statsData,
    period: { from: beginDate, to: endDate },
    summary: {
      totalViews,
      totalClicks,
      avgCTR,
      avgCPC,
      totalSpend,
      totalRevenue,
      totalOrders,
      avgCR,
      ROI,
    },
  };
}

/**
 * Format campaign statistics as markdown with visual indicators
 */
export function formatCampaignStatsAsMarkdown(
  stats: CampaignStats[],
  period: { from: string; to: string },
  summary: {
    totalViews: number;
    totalClicks: number;
    avgCTR: number;
    avgCPC: number;
    totalSpend: number;
    totalRevenue: number;
    totalOrders: number;
    avgCR: number;
    ROI: number;
  }
): string {
  const lines: string[] = [];

  lines.push('## Статистика рекламных кампаний\n');
  lines.push(`**Период:** ${period.from} — ${period.to}\n`);

  // Summary with ROI status
  lines.push('### Общие показатели\n');
  lines.push('| Метрика | Значение |');
  lines.push('|---------|----------|');
  lines.push(`| Показы | ${formatNumber(summary.totalViews)} |`);
  lines.push(`| Клики | ${formatNumber(summary.totalClicks)} |`);
  lines.push(`| CTR | ${formatPercent(summary.avgCTR, 2)} |`);
  lines.push(`| CPC | ${formatRub(summary.avgCPC)} |`);
  lines.push(`| Расход | ${formatRub(summary.totalSpend)} |`);
  lines.push(`| Выручка | ${formatRub(summary.totalRevenue)} |`);
  lines.push(`| Заказы | ${formatNumber(summary.totalOrders)} |`);
  lines.push(`| CR (заказ) | ${formatPercent(summary.avgCR, 2)} |`);
  lines.push(`| ROI | ${roiStatus(summary.ROI)} |`);
  lines.push('');

  // Legend
  lines.push(`*${STATUS.good} ROI >100% | ${STATUS.warning} ROI 0-100% | ${STATUS.bad} ROI <0%*\n`);

  // Campaign details
  lines.push('### Эффективность по кампаниям\n');
  lines.push('| ID | Показы | Клики | CTR | CPC | Расход | Заказы | ROI |');
  lines.push('|----|--------|-------|-----|-----|--------|--------|-----|');

  for (const stat of stats.slice(0, 50)) {
    const roi = stat.sum > 0 ? ((stat.sum_price - stat.sum) / stat.sum) * 100 : 0;

    lines.push(
      `| ${stat.advertId} | ${formatNumber(stat.views)} | ${formatNumber(stat.clicks)} | ${formatPercent(stat.ctr, 1)} | ${formatRub(stat.cpc)} | ${formatRub(stat.sum)} | ${stat.orders} | ${roiStatus(roi)} |`
    );
  }

  if (stats.length > 50) {
    lines.push(`\n*... и ещё ${stats.length - 50} кампаний*`);
  }

  lines.push(`\n**Всего кампаний:** ${stats.length}`);

  return lines.join('\n');
}

/**
 * Format campaigns as markdown with status indicators
 */
export function formatCampaignsAsMarkdown(
  campaigns: CampaignData[],
  summary: { active: number; paused: number; totalBudget: number }
): string {
  const lines: string[] = [];

  lines.push('## Рекламные кампании\n');
  lines.push(`**Активных:** ${summary.active} | **На паузе:** ${summary.paused} | **Дневной бюджет:** ${formatRub(summary.totalBudget)}\n`);

  // Legend
  lines.push(`*${STATUS.good} Активна | ${STATUS.warning} На паузе | ${STATUS.neutral} Остановлена*\n`);

  lines.push('| ID | Название | Тип | Статус | Бюджет/день | Товаров |');
  lines.push('|----|----------|-----|--------|-------------|---------|');

  for (const c of campaigns.slice(0, 50)) {
    const budget = c.dailyBudget ? formatRub(c.dailyBudget) : '-';
    const nmCount = c.nmIds?.length || 0;
    // Status: 9 = active, 11 = paused, other = stopped
    const statusIcon = c.status === '9' ? STATUS.good : c.status === '11' ? STATUS.warning : STATUS.neutral;

    lines.push(`| ${c.id} | ${c.name.substring(0, 22)} | ${c.typeName} | ${statusIcon} ${c.statusName} | ${budget} | ${nmCount} |`);
  }

  if (campaigns.length > 50) {
    lines.push(`\n*... и ещё ${campaigns.length - 50} кампаний*`);
  }

  lines.push(`\n**Всего кампаний:** ${campaigns.length}`);

  return lines.join('\n');
}

// ============ CAMPAIGN MANAGEMENT ============

// Input schema for wb_pause_campaign
export const PauseCampaignInputSchema = z.object({
  campaignId: z.number().describe('ID рекламной кампании'),
  action: z.enum(['pause', 'start']).describe('Действие: pause (пауза) или start (запуск)'),
  confirm: z.boolean().optional().default(false).describe('true для применения изменений'),
});

export type PauseCampaignInput = z.infer<typeof PauseCampaignInputSchema>;

// Input schema for wb_update_campaign_budget
export const UpdateCampaignBudgetInputSchema = z.object({
  campaignId: z.number().describe('ID рекламной кампании'),
  amount: z.number().min(100).describe('Сумма пополнения бюджета (мин. 100 ₽)'),
  type: z.enum(['add', 'limit']).optional().default('add').describe('add = пополнить, limit = установить лимит'),
  confirm: z.boolean().optional().default(false).describe('true для применения изменений'),
});

export type UpdateCampaignBudgetInput = z.infer<typeof UpdateCampaignBudgetInputSchema>;

// Input schema for wb_update_campaign_cpm
export const UpdateCampaignCpmInputSchema = z.object({
  campaignId: z.number().describe('ID рекламной кампании'),
  cpm: z.number().min(50).describe('Новая ставка CPM (мин. 50 ₽)'),
  type: z.number().optional().describe('Тип кампании (если известен)'),
  param: z.number().optional().describe('ID параметра (menu, subject, set) для изменения ставки'),
  confirm: z.boolean().optional().default(false).describe('true для применения изменений'),
});

export type UpdateCampaignCpmInput = z.infer<typeof UpdateCampaignCpmInputSchema>;

/**
 * Pause or start a campaign
 */
export async function pauseCampaign(input: PauseCampaignInput): Promise<{
  success: boolean;
  preview: boolean;
  campaignId: number;
  action: string;
  message: string;
}> {
  const { campaignId, action, confirm } = input;

  // Get current campaign status
  const detailsUrl = `${WB_API_URLS.advert}/adv/v1/promotion/adverts`;
  const details = await fetchWB<
    Array<{
      advertId: number;
      name: string;
      status: number;
    }>
  >(detailsUrl, {
    method: 'POST',
    body: JSON.stringify([campaignId]),
  });

  const campaign = details?.[0];
  if (!campaign) {
    throw new Error(`Кампания ${campaignId} не найдена`);
  }

  const currentStatus = CAMPAIGN_STATUSES[campaign.status] || `Статус ${campaign.status}`;
  const newStatus = action === 'pause' ? 'На паузе' : 'Активна';

  // Preview mode
  if (!confirm) {
    const preview = {
      campaignId,
      name: campaign.name,
      currentStatus,
      newStatus,
      action,
    };

    await logWriteWithPreview('wb_pause_campaign', 'advertising', input as Record<string, unknown>, preview);

    return {
      success: false,
      preview: true,
      campaignId,
      action,
      message: `## Preview изменения статуса кампании\n\n| Параметр | Значение |\n|----------|----------|\n| ID | ${campaignId} |\n| Название | ${campaign.name} |\n| БЫЛО | ${currentStatus} |\n| СТАНЕТ | ${newStatus} |\n\n> Для применения добавьте \`confirm: true\``,
    };
  }

  // Apply change
  const endpoint = action === 'pause' ? 'pause' : 'start';
  const url = `${WB_API_URLS.advert}/adv/v1/${endpoint}?id=${campaignId}`;

  try {
    await fetchWB<void>(url, { method: 'GET' });
  } catch (error) {
    journalWrite({
      tool: 'wb_pause_campaign',
      entity: { type: 'campaign', id: campaignId },
      before: { campaignId, status: campaign.status },
      after: { campaignId, action },
      ok: false,
      reversible: false,
      error: (error as Error).message,
    });
    throw error;
  }

  const result = {
    campaignId,
    action,
    previousStatus: currentStatus,
    newStatus,
  };

  // Откат: статус 11 (пауза) → pause, иначе → start
  journalWrite({
    tool: 'wb_pause_campaign',
    entity: { type: 'campaign', id: campaignId },
    before: { campaignId, status: campaign.status, action: campaign.status === 11 ? 'pause' : 'start' },
    after: { campaignId, action },
    response: result,
    ok: true,
    reversible: true,
  });

  return {
    success: true,
    preview: false,
    campaignId,
    action,
    message: `✅ Кампания #${campaignId} "${campaign.name}": ${currentStatus} → ${newStatus}`,
  };
}

/**
 * Update campaign budget (deposit or set daily limit)
 */
export async function updateCampaignBudget(input: UpdateCampaignBudgetInput): Promise<{
  success: boolean;
  preview: boolean;
  campaignId: number;
  amount: number;
  message: string;
}> {
  const { campaignId, amount, type, confirm } = input;

  // Get current campaign info
  const detailsUrl = `${WB_API_URLS.advert}/adv/v1/promotion/adverts`;
  const details = await fetchWB<
    Array<{
      advertId: number;
      name: string;
      dailyBudget?: number;
    }>
  >(detailsUrl, {
    method: 'POST',
    body: JSON.stringify([campaignId]),
  });

  const campaign = details?.[0];
  if (!campaign) {
    throw new Error(`Кампания ${campaignId} не найдена`);
  }

  // Get current balance
  const balanceUrl = `${WB_API_URLS.advert}/adv/v1/budget?id=${campaignId}`;
  const balanceData = await fetchWB<{ balance?: number }>(`${balanceUrl}`);
  const currentBalance = balanceData?.balance || 0;

  const actionText = type === 'limit' ? 'Установить дневной лимит' : 'Пополнить бюджет';

  // Preview mode
  if (!confirm) {
    const preview = {
      campaignId,
      name: campaign.name,
      currentBalance,
      amount,
      type,
    };

    await logWriteWithPreview('wb_update_campaign_budget', 'advertising', input as Record<string, unknown>, preview);

    const lines = [
      '## Preview изменения бюджета кампании',
      '',
      '| Параметр | Значение |',
      '|----------|----------|',
      `| ID | ${campaignId} |`,
      `| Название | ${campaign.name} |`,
      `| Текущий баланс | ${formatRub(currentBalance)} |`,
      `| Действие | ${actionText} |`,
      `| Сумма | ${formatRub(amount)} |`,
    ];

    if (type === 'add') {
      lines.push(`| Баланс после | ${formatRub(currentBalance + amount)} |`);
    }

    lines.push('');
    lines.push('> Для применения добавьте `confirm: true`');

    return {
      success: false,
      preview: true,
      campaignId,
      amount,
      message: lines.join('\n'),
    };
  }

  // Apply change
  const url = `${WB_API_URLS.advert}/adv/v1/budget/deposit`;
  try {
    await fetchWB<void>(url, {
      method: 'POST',
      body: JSON.stringify({
        id: campaignId,
        sum: amount,
        type: type === 'limit' ? 1 : 0, // 0 = deposit, 1 = daily limit
      }),
    });
  } catch (error) {
    journalWrite({
      tool: 'wb_update_campaign_budget',
      entity: { type: 'campaign', id: campaignId },
      before: { campaignId, balance: currentBalance },
      after: { campaignId, amount, type },
      ok: false,
      reversible: false,
      error: (error as Error).message,
    });
    throw error;
  }

  const result = {
    campaignId,
    amount,
    type,
    previousBalance: currentBalance,
    newBalance: type === 'add' ? currentBalance + amount : currentBalance,
  };

  // Пополнение — это деньги с баланса, обратно их не вернуть: откат невозможен
  journalWrite({
    tool: 'wb_update_campaign_budget',
    entity: { type: 'campaign', id: campaignId },
    before: { campaignId, balance: currentBalance },
    after: { campaignId, amount, type },
    response: result,
    ok: true,
    reversible: false,
  });

  return {
    success: true,
    preview: false,
    campaignId,
    amount,
    message: `✅ Кампания #${campaignId}: ${actionText} на ${formatRub(amount)}. Баланс: ${formatRub(currentBalance)} → ${formatRub(currentBalance + amount)}`,
  };
}

/**
 * Update campaign CPM (bid)
 */
export async function updateCampaignCpm(input: UpdateCampaignCpmInput): Promise<{
  success: boolean;
  preview: boolean;
  campaignId: number;
  cpm: number;
  message: string;
}> {
  const { campaignId, cpm, type, param, confirm } = input;

  // Get current campaign info
  const detailsUrl = `${WB_API_URLS.advert}/adv/v1/promotion/adverts`;
  const details = await fetchWB<
    Array<{
      advertId: number;
      name: string;
      type: number;
      unitedParams?: Array<{
        subject?: { id: number; name: string };
        menus?: Array<{ id: number; name: string }>;
        nms?: number[];
        searchCPM?: number;
        catalogCPM?: number;
      }>;
      autoParams?: {
        cpm?: number;
        subject?: { id: number; name: string };
      };
    }>
  >(detailsUrl, {
    method: 'POST',
    body: JSON.stringify([campaignId]),
  });

  const campaign = details?.[0];
  if (!campaign) {
    throw new Error(`Кампания ${campaignId} не найдена`);
  }

  // Determine current CPM based on campaign type
  let currentCpm = 0;
  const campaignType = type || campaign.type;

  if (campaign.autoParams?.cpm) {
    currentCpm = campaign.autoParams.cpm;
  } else if (campaign.unitedParams?.[0]) {
    const params = campaign.unitedParams[0];
    currentCpm = params.searchCPM || params.catalogCPM || 0;
  }

  // Preview mode
  if (!confirm) {
    const preview = {
      campaignId,
      name: campaign.name,
      type: CAMPAIGN_TYPES[campaignType] || `Тип ${campaignType}`,
      currentCpm,
      newCpm: cpm,
    };

    await logWriteWithPreview('wb_update_campaign_cpm', 'advertising', input as Record<string, unknown>, preview);

    return {
      success: false,
      preview: true,
      campaignId,
      cpm,
      message: `## Preview изменения ставки\n\n| Параметр | Значение |\n|----------|----------|\n| ID | ${campaignId} |\n| Название | ${campaign.name} |\n| Тип | ${CAMPAIGN_TYPES[campaignType] || campaignType} |\n| БЫЛО CPM | ${formatRub(currentCpm)} |\n| СТАНЕТ CPM | ${formatRub(cpm)} |\n\n> Для применения добавьте \`confirm: true\``,
    };
  }

  // Apply change
  const url = `${WB_API_URLS.advert}/adv/v0/cpm`;
  const body: Record<string, unknown> = {
    advertId: campaignId,
    type: campaignType,
    cpm,
  };

  if (param !== undefined) {
    body.param = param;
  }

  try {
    await fetchWB<void>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    journalWrite({
      tool: 'wb_update_campaign_cpm',
      entity: { type: 'campaign', id: campaignId },
      before: { campaignId, cpm: currentCpm, type: campaignType, param },
      after: { campaignId, cpm, type: campaignType, param },
      ok: false,
      reversible: false,
      error: (error as Error).message,
    });
    throw error;
  }

  const result = {
    campaignId,
    previousCpm: currentCpm,
    newCpm: cpm,
    type: campaignType,
  };

  journalWrite({
    tool: 'wb_update_campaign_cpm',
    entity: { type: 'campaign', id: campaignId },
    before: { campaignId, cpm: currentCpm, type: campaignType, param },
    after: { campaignId, cpm, type: campaignType, param },
    response: result,
    // Откат возможен, только если прежняя ставка была известна (≥ 50 ₽ — минимум WB)
    ok: true,
    reversible: currentCpm >= 50,
  });

  return {
    success: true,
    preview: false,
    campaignId,
    cpm,
    message: `✅ Кампания #${campaignId}: CPM изменён ${formatRub(currentCpm)} → ${formatRub(cpm)}`,
  };
}

/**
 * Format pause/start result
 */
export function formatPauseCampaignResult(result: {
  success: boolean;
  preview: boolean;
  campaignId: number;
  action: string;
  message: string;
}): string {
  return result.message;
}

/**
 * Format budget update result
 */
export function formatUpdateBudgetResult(result: {
  success: boolean;
  preview: boolean;
  campaignId: number;
  amount: number;
  message: string;
}): string {
  return result.message;
}

/**
 * Format CPM update result
 */
export function formatUpdateCpmResult(result: {
  success: boolean;
  preview: boolean;
  campaignId: number;
  cpm: number;
  message: string;
}): string {
  return result.message;
}
