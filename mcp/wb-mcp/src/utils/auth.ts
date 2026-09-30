import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// Load .env from project root
const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../../');
config({ path: join(projectRoot, '.env') });

export interface WBTokens {
  apiToken: string;
  analyticsToken?: string;
  adsToken?: string;
}

/**
 * Get WB API token from environment or file
 * Priority: .env > ~/.wb_token > environment variable
 */
export function getWBApiToken(): string {
  // 1. Try .env file (already loaded)
  if (process.env.WB_API_TOKEN) {
    return process.env.WB_API_TOKEN.replace(/^["']|["']$/g, '');
  }

  // 2. Try ~/.wb_token
  const homeTokenPath = join(process.env.HOME || '', '.wb_token');
  if (existsSync(homeTokenPath)) {
    const token = readFileSync(homeTokenPath, 'utf-8').trim();
    if (token) return token;
  }

  // 3. Try ~/.config/wb/token
  const configTokenPath = join(process.env.HOME || '', '.config', 'wb', 'token');
  if (existsSync(configTokenPath)) {
    const token = readFileSync(configTokenPath, 'utf-8').trim();
    if (token) return token;
  }

  throw new Error(
    'WB_API_TOKEN not found. Please set it in:\n' +
    '  1. .env file (WB_API_TOKEN="your_token")\n' +
    '  2. ~/.wb_token\n' +
    '  3. Environment variable WB_API_TOKEN'
  );
}

/**
 * Get all WB tokens
 */
export function getWBTokens(): WBTokens {
  return {
    apiToken: getWBApiToken(),
    analyticsToken: process.env.WB_ANALYTICS_TOKEN?.replace(/^["']|["']$/g, ''),
    adsToken: process.env.WB_ADS_TOKEN?.replace(/^["']|["']$/g, ''),
  };
}

/**
 * WB API base URLs (согласно dev.wildberries.ru/openapi/api-information)
 *
 * Каждая категория API имеет свой базовый URL и требует соответствующий токен:
 * - Content: карточки товаров, категории, медиа
 * - Statistics: статистика продаж, остатков, заказов
 * - Prices: цены и скидки
 * - Marketplace: FBS заказы, склады продавца, остатки
 * - Feedbacks: отзывы и вопросы
 * - Advert: рекламные кампании
 * - Analytics: воронка продаж, поисковые запросы
 * - Common: тарифы, новости, информация о продавце (любой токен)
 * - Supplies: FBW поставки
 * - Returns: возвраты покупателей
 * - Documents: документы
 * - Finance: баланс
 * - BuyerChat: чат с покупателями
 * - UserManagement: управление пользователями
 */
export const WB_API_URLS = {
  // Content API - карточки товаров
  content: 'https://content-api.wildberries.ru',

  // Statistics API - статистика (заказы, продажи, остатки)
  statistics: 'https://statistics-api.wildberries.ru',

  // Prices and Discounts API - цены и скидки
  prices: 'https://discounts-prices-api.wildberries.ru',

  // Marketplace API - FBS заказы, склады, остатки
  marketplace: 'https://marketplace-api.wildberries.ru',

  // Feedbacks and Questions API - отзывы и вопросы
  feedbacks: 'https://feedbacks-api.wildberries.ru',

  // Promotion (Advert) API - рекламные кампании
  advert: 'https://advert-api.wildberries.ru',

  // Analytics API - воронка продаж, аналитика (требует подписку Джем)
  analytics: 'https://seller-analytics-api.wildberries.ru',

  // Common API - тарифы, новости, информация о продавце
  common: 'https://common-api.wildberries.ru',

  // Supplies API - FBW поставки
  supplies: 'https://supplies-api.wildberries.ru',

  // Buyers Returns API - возвраты
  returns: 'https://returns-api.wildberries.ru',

  // Documents API - документы
  documents: 'https://documents-api.wildberries.ru',

  // Finance API - баланс
  finance: 'https://finance-api.wildberries.ru',

  // Buyers Chat API - чат с покупателями
  buyerChat: 'https://buyer-chat-api.wildberries.ru',

  // User Management API - управление пользователями (только РФ)
  userManagement: 'https://user-management-api.wildberries.ru',
} as const;

/**
 * Rate limits по категориям API (согласно документации)
 */
export const WB_RATE_LIMITS = {
  content: { period: 60, limit: 100, interval: 600, burst: 5 },
  prices: { period: 6, limit: 10, interval: 600, burst: 5 },
  marketplace: { period: 60, limit: 300, interval: 200, burst: 20 },
  statistics: { period: 60, limit: 60, interval: 1000, burst: 5 },
  feedbacks: { period: 60, limit: 60, interval: 1000, burst: 5 },
  advert: { period: 60, limit: 300, interval: 200, burst: 10 },
  analytics: { period: 60, limit: 60, interval: 1000, burst: 5 },
  common: { period: 60, limit: 1, interval: 60000, burst: 10 },
} as const;

/**
 * Create headers for WB API request
 */
export function createWBHeaders(token?: string): Record<string, string> {
  const apiToken = token || getWBApiToken();
  return {
    'Authorization': apiToken,
    'Content-Type': 'application/json',
  };
}
