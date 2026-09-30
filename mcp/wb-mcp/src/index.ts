#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  GetInventoryInputSchema,
  getInventory,
  formatInventoryAsMarkdown,
} from './tools/inventory.js';
import {
  GetPricesInputSchema,
  UpdatePriceInputSchema,
  getPrices,
  updatePrice,
  formatPricesAsMarkdown,
  formatUpdateResult,
} from './tools/prices.js';
import {
  GetCardsInputSchema,
  UpdateCardInputSchema,
  getCards,
  updateCard,
  formatCardsAsMarkdown,
} from './tools/cards.js';
import {
  GetReviewsInputSchema,
  ReplyReviewInputSchema,
  getReviews,
  replyReview,
  formatReviewsAsMarkdown,
  formatReplyResult,
} from './tools/reviews.js';
import {
  GetOrdersInputSchema,
  getOrders,
  formatOrdersAsMarkdown,
} from './tools/orders.js';
import {
  GetSalesInputSchema,
  getSales,
  formatSalesAsMarkdown,
} from './tools/sales.js';
import {
  GetWarehousesInputSchema,
  getWarehouses,
  formatWarehousesAsMarkdown,
} from './tools/warehouses.js';
import {
  GetCampaignsInputSchema,
  GetCampaignStatsInputSchema,
  PauseCampaignInputSchema,
  UpdateCampaignBudgetInputSchema,
  UpdateCampaignCpmInputSchema,
  getCampaigns,
  getCampaignStats,
  pauseCampaign,
  updateCampaignBudget,
  updateCampaignCpm,
  formatCampaignsAsMarkdown,
  formatCampaignStatsAsMarkdown,
  formatPauseCampaignResult,
  formatUpdateBudgetResult,
  formatUpdateCpmResult,
} from './tools/campaigns.js';
import {
  GetSalesFunnelInputSchema,
  GetSellerInfoInputSchema,
  getSalesFunnel,
  getSellerInfo,
  formatSalesFunnelAsMarkdown,
  formatSellerInfoAsMarkdown,
} from './tools/analytics.js';
import {
  GetProductsInStockInputSchema,
  getProductsInStock,
  formatProductsInStockAsMarkdown,
} from './tools/products-in-stock.js';
import {
  GetBalanceInputSchema,
  GetPaymentsInputSchema,
  getBalance,
  getPayments,
  formatBalanceAsMarkdown,
  formatPaymentsAsMarkdown,
} from './tools/finance.js';
import {
  GetRealizationReportInputSchema,
  getRealizationReport,
  formatRealizationReportAsMarkdown,
  formatCostPriceTableAsMarkdown,
} from './tools/realization.js';
import {
  GetSuppliesInputSchema,
  GetSupplyInputSchema,
  CreateSupplyInputSchema,
  AddToSupplyInputSchema,
  CloseSupplyInputSchema,
  DeleteSupplyInputSchema,
  getSupplies,
  getSupply,
  createSupply,
  addToSupply,
  closeSupply,
  deleteSupply,
  formatSuppliesAsMarkdown,
  formatSupplyDetailsAsMarkdown,
} from './tools/supplies.js';
import {
  GetDocumentsListInputSchema,
  GetDocumentCategoriesInputSchema,
  DownloadDocumentInputSchema,
  GetNPDReportInputSchema,
  getDocumentsList,
  getDocumentCategories,
  downloadDocument,
  getNPDReport,
  formatDocumentsAsMarkdown,
  formatCategoriesAsMarkdown,
  formatNPDReportAsMarkdown,
} from './tools/documents.js';

// Create server
const server = new Server(
  {
    name: 'wb-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'wb_get_inventory',
      annotations: { readOnlyHint: true },
      description:
        'Получить остатки товаров на складах Wildberries. ' +
        'Возвращает список товаров с ценами, скидками и количеством на складах (FBO/FBS).',
      inputSchema: {
        type: 'object',
        properties: {
          minQuantity: {
            type: 'number',
            description: 'Минимальное количество на складе (по умолчанию 1)',
            default: 1,
          },
          mode: {
            type: 'string',
            enum: ['all', 'fbo', 'fbs'],
            description: 'Режим: all (все товары), fbo (склады WB), fbs (склады продавца)',
            default: 'all',
          },
        },
      },
    },
    {
      name: 'wb_get_prices',
      annotations: { readOnlyHint: true },
      description:
        'Получить цены и скидки на товары Wildberries. ' +
        'Возвращает список товаров с ценами, скидками, промокодами и финальной ценой.',
      inputSchema: {
        type: 'object',
        properties: {
          nmIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Фильтр по nmId товаров',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество товаров (по умолчанию 100)',
            default: 100,
          },
          offset: {
            type: 'number',
            description: 'Смещение для пагинации',
            default: 0,
          },
        },
      },
    },
    {
      name: 'wb_update_price',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Изменить цену или скидку на товар Wildberries. ' +
        'ВАЖНО: Без параметра confirm=true показывает preview изменений (БЫЛО → СТАЛО). ' +
        'С confirm=true применяет изменения.',
      inputSchema: {
        type: 'object',
        properties: {
          nmId: {
            type: 'number',
            description: 'nmId товара для изменения цены',
          },
          price: {
            type: 'number',
            description: 'Новая цена (до скидки)',
          },
          discount: {
            type: 'number',
            description: 'Новая скидка в процентах (0-100)',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения и применения изменений',
            default: false,
          },
        },
        required: ['nmId'],
      },
    },
    {
      name: 'wb_get_cards',
      annotations: { readOnlyHint: true },
      description:
        'Получить карточки товаров Wildberries. ' +
        'Возвращает список карточек с названиями, брендами, категориями, фотографиями и характеристиками.',
      inputSchema: {
        type: 'object',
        properties: {
          nmIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Фильтр по nmId товаров',
          },
          vendorCodes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Фильтр по артикулам (SKU)',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество карточек (по умолчанию 100)',
            default: 100,
          },
          withPhoto: {
            type: 'boolean',
            description: 'Только с фото (по умолчанию true)',
            default: true,
          },
        },
      },
    },
    {
      name: 'wb_update_card',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Обновить контент карточки товара (название до 60 символов, описание, характеристики, габариты). ' +
        'ВАЖНО: без confirm=true показывает preview (БЫЛО → СТАЛО) и ничего не меняет. ' +
        'С confirm=true берёт свежую карточку целиком, меняет только переданные поля, проверяет error/list и пишет журнал для отката.',
      inputSchema: {
        type: 'object',
        properties: {
          nmId: {
            type: 'number',
            description: 'Артикул WB (nmId)',
          },
          title: {
            type: 'string',
            description: 'Новое название',
          },
          description: {
            type: 'string',
            description: 'Новое описание',
          },
          vendorCode: {
            type: 'string',
            description: 'Артикул продавца (необязательно)',
          },
          characteristics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'ID характеристики' },
                value: {
                  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                  description: 'Значение (строка или массив строк)',
                },
              },
              required: ['id', 'value'],
            },
            description: 'Характеристики для обновления',
          },
          dimensions: {
            type: 'object',
            properties: {
              length: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            description: 'Габариты упаковки',
          },
          confirm: {
            type: 'boolean',
            description: 'true — применить изменения. Без него только preview (БЫЛО → СТАЛО)',
            default: false,
          },
        },
        required: ['nmId'],
      },
    },
    {
      name: 'wb_get_reviews',
      annotations: { readOnlyHint: true },
      description:
        'Получить отзывы на товары Wildberries. ' +
        'Возвращает список отзывов с рейтингами, текстами и ответами продавца.',
      inputSchema: {
        type: 'object',
        properties: {
          nmId: {
            type: 'number',
            description: 'Фильтр по nmId товара',
          },
          isAnswered: {
            type: 'boolean',
            description: 'Фильтр: true=с ответом, false=без ответа',
          },
          take: {
            type: 'number',
            description: 'Количество отзывов (по умолчанию 50)',
            default: 50,
          },
          skip: {
            type: 'number',
            description: 'Смещение для пагинации',
            default: 0,
          },
          order: {
            type: 'string',
            enum: ['dateAsc', 'dateDesc'],
            description: 'Сортировка по дате',
            default: 'dateDesc',
          },
        },
      },
    },
    {
      name: 'wb_reply_review',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Ответить на отзыв Wildberries. ' +
        'ВАЖНО: Без параметра confirm=true показывает preview ответа. ' +
        'С confirm=true отправляет ответ.',
      inputSchema: {
        type: 'object',
        properties: {
          reviewId: {
            type: 'string',
            description: 'ID отзыва',
          },
          text: {
            type: 'string',
            description: 'Текст ответа',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения и отправки ответа',
            default: false,
          },
        },
        required: ['reviewId', 'text'],
      },
    },
    {
      name: 'wb_get_orders',
      annotations: { readOnlyHint: true },
      description:
        'Получить заказы Wildberries. ' +
        'Возвращает список заказов с суммами, статусами и сводку по выручке.',
      inputSchema: {
        type: 'object',
        properties: {
          dateFrom: {
            type: 'string',
            description: 'Дата начала (YYYY-MM-DD)',
          },
          dateTo: {
            type: 'string',
            description: 'Дата конца (YYYY-MM-DD)',
          },
          status: {
            type: 'string',
            enum: ['waiting', 'sorted', 'sold', 'canceled', 'canceled_by_client', 'defect', 'ready_for_pickup'],
            description: 'Фильтр по статусу',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество заказов',
            default: 100,
          },
        },
      },
    },
    {
      name: 'wb_get_sales',
      annotations: { readOnlyHint: true },
      description:
        'Получить продажи и возвраты Wildberries. ' +
        'Возвращает список продаж с суммами, товарами и сводку по выручке. ' +
        'Данные хранятся 90 дней. Используйте для анализа проданных товаров.',
      inputSchema: {
        type: 'object',
        properties: {
          dateFrom: {
            type: 'string',
            description: 'Дата начала (YYYY-MM-DD). Обязательный параметр.',
          },
          dateTo: {
            type: 'string',
            description: 'Дата конца (YYYY-MM-DD). Если не указана, получаем все до сегодня.',
          },
          flag: {
            type: 'number',
            description: '0 = изменения с даты, 1 = все продажи за конкретную дату',
            default: 0,
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество записей',
            default: 100000,
          },
        },
        required: ['dateFrom'],
      },
    },
    {
      name: 'wb_get_warehouses',
      annotations: { readOnlyHint: true },
      description:
        'Получить список складов Wildberries (FBO) и ваших складов (FBS).',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['fbo', 'fbs', 'all'],
            description: 'Тип складов: fbo, fbs или all',
            default: 'all',
          },
        },
      },
    },
    {
      name: 'wb_get_campaigns',
      annotations: { readOnlyHint: true },
      description:
        'Получить рекламные кампании Wildberries. ' +
        'Возвращает список кампаний со статусами, типами и бюджетами.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'paused', 'stopped', 'all'],
            description: 'Фильтр по статусу',
            default: 'all',
          },
          type: {
            type: 'string',
            enum: ['auction', 'auto', 'search', 'catalog', 'card', 'all'],
            description: 'Фильтр по типу кампании',
            default: 'all',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество кампаний',
            default: 50,
          },
        },
      },
    },
    {
      name: 'wb_get_campaign_stats',
      annotations: { readOnlyHint: true },
      description:
        'Получить статистику рекламных кампаний Wildberries за период. ' +
        'Возвращает показы, клики, CTR, CPC, заказы, расход, выручку и ROI по кампаниям.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'ID кампаний для получения статистики (максимум 50)',
          },
          beginDate: {
            type: 'string',
            description: 'Дата начала периода (YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'Дата конца периода (YYYY-MM-DD)',
          },
        },
        required: ['ids', 'beginDate', 'endDate'],
      },
    },
    {
      name: 'wb_pause_campaign',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Поставить на паузу или запустить рекламную кампанию Wildberries. ' +
        'ВАЖНО: Без параметра confirm=true показывает preview. С confirm=true применяет изменения.',
      inputSchema: {
        type: 'object',
        properties: {
          campaignId: {
            type: 'number',
            description: 'ID рекламной кампании',
          },
          action: {
            type: 'string',
            enum: ['pause', 'start'],
            description: 'Действие: pause (пауза) или start (запуск)',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения и применения изменений',
            default: false,
          },
        },
        required: ['campaignId', 'action'],
      },
    },
    {
      name: 'wb_update_campaign_budget',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Пополнить бюджет или установить дневной лимит рекламной кампании Wildberries. ' +
        'ВАЖНО: Без параметра confirm=true показывает preview. С confirm=true применяет изменения.',
      inputSchema: {
        type: 'object',
        properties: {
          campaignId: {
            type: 'number',
            description: 'ID рекламной кампании',
          },
          amount: {
            type: 'number',
            description: 'Сумма пополнения бюджета (мин. 100 ₽)',
          },
          type: {
            type: 'string',
            enum: ['add', 'limit'],
            description: 'add = пополнить, limit = установить лимит',
            default: 'add',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения и применения изменений',
            default: false,
          },
        },
        required: ['campaignId', 'amount'],
      },
    },
    {
      name: 'wb_update_campaign_cpm',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Изменить ставку CPM рекламной кампании Wildberries. ' +
        'ВАЖНО: Без параметра confirm=true показывает preview. С confirm=true применяет изменения.',
      inputSchema: {
        type: 'object',
        properties: {
          campaignId: {
            type: 'number',
            description: 'ID рекламной кампании',
          },
          cpm: {
            type: 'number',
            description: 'Новая ставка CPM (мин. 50 ₽)',
          },
          type: {
            type: 'number',
            description: 'Тип кампании (если известен)',
          },
          param: {
            type: 'number',
            description: 'ID параметра (menu, subject, set) для изменения ставки',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения и применения изменений',
            default: false,
          },
        },
        required: ['campaignId', 'cpm'],
      },
    },
    {
      name: 'wb_get_sales_funnel',
      annotations: { readOnlyHint: true },
      description:
        'Получить воронку продаж Wildberries (Analytics API). ' +
        'Возвращает переходы в карточку, корзину, заказы, выкупы и конверсии по товарам (метод v3, Джем не нужен). ' +
        'Показов и CTR в этом методе нет. Период — не глубже 365 дней.',
      inputSchema: {
        type: 'object',
        properties: {
          nmIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Фильтр по nmId товаров (макс. 1000)',
          },
          dateFrom: {
            type: 'string',
            description: 'Дата начала (YYYY-MM-DD)',
          },
          dateTo: {
            type: 'string',
            description: 'Дата конца (YYYY-MM-DD)',
          },
        },
        required: ['dateFrom', 'dateTo'],
      },
    },
    {
      name: 'wb_get_seller_info',
      annotations: { readOnlyHint: true },
      description:
        'Получить информацию о продавце Wildberries (Common API). ' +
        'Возвращает название, ID и торговую марку продавца. Работает с любым токеном.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'wb_get_products_in_stock',
      annotations: { readOnlyHint: true },
      description:
        'Получить все товары Wildberries в наличии на складах FBS. ' +
        'Возвращает полную информацию: nmId, баркод, артикул, название, описание, фото, цены, остаток, характеристики. ' +
        'Использует баркоды из sizes[].skus[] для запроса остатков FBS.',
      inputSchema: {
        type: 'object',
        properties: {
          minQuantity: {
            type: 'number',
            description: 'Минимальное количество на складе (по умолчанию 1)',
            default: 1,
          },
        },
      },
    },
    {
      name: 'wb_get_balance',
      annotations: { readOnlyHint: true },
      description:
        'Получить баланс продавца Wildberries. ' +
        'Возвращает текущий баланс и валюту.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'wb_get_payments',
      annotations: { readOnlyHint: true },
      description:
        'Получить отчёт о выплатах Wildberries за период. ' +
        'Возвращает детальный отчёт о реализации с комиссиями, логистикой и суммами к перечислению. ' +
        'Источник — finance-api (sales-reports/detailed). ЛИМИТ: базовый токен — 2 запроса в сутки на аккаунт, квота общая с другими программами; не вызывать повторно.',
      inputSchema: {
        type: 'object',
        properties: {
          dateFrom: {
            type: 'string',
            description: 'Дата начала (YYYY-MM-DD)',
          },
          dateTo: {
            type: 'string',
            description: 'Дата конца (YYYY-MM-DD), по умолчанию сегодня',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество записей',
            default: 100,
          },
        },
        required: ['dateFrom'],
      },
    },
    {
      name: 'wb_get_realization_report',
      annotations: { readOnlyHint: true },
      description:
        'Получить полный отчёт о реализации Wildberries с пагинацией. ' +
        'Возвращает все продажи и возвраты с группировкой по товарам. ' +
        'Данные доступны с 29 января 2024. Используйте для анализа себестоимости. ' +
        'Источник — finance-api (sales-reports/detailed). ЛИМИТ: базовый токен — 2 запроса в сутки на аккаунт, квота общая с другими программами; не вызывать повторно.',
      inputSchema: {
        type: 'object',
        properties: {
          dateFrom: {
            type: 'string',
            description: 'Дата начала (YYYY-MM-DD). Данные доступны с 2024-01-29.',
          },
          dateTo: {
            type: 'string',
            description: 'Дата конца (YYYY-MM-DD). Если не указана, получаем до сегодня.',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество записей',
            default: 100000,
          },
        },
        required: ['dateFrom'],
      },
    },
    {
      name: 'wb_get_supplies',
      annotations: { readOnlyHint: true },
      description:
        'Получить список поставок Wildberries. ' +
        'Возвращает активные и закрытые поставки с информацией о заказах.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Максимальное количество поставок (по умолчанию 50)',
            default: 50,
          },
          next: {
            type: 'number',
            description: 'Курсор для пагинации',
          },
        },
      },
    },
    {
      name: 'wb_get_supply',
      annotations: { readOnlyHint: true },
      description:
        'Получить детали поставки Wildberries с заказами. ' +
        'Возвращает информацию о поставке и список заказов в ней.',
      inputSchema: {
        type: 'object',
        properties: {
          supplyId: {
            type: 'string',
            description: 'ID поставки (например WB-GI-123456)',
          },
        },
        required: ['supplyId'],
      },
    },
    {
      name: 'wb_create_supply',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Создать новую поставку Wildberries. ' +
        'ВАЖНО: Без параметра confirm=true показывает preview. С confirm=true создаёт поставку.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Название поставки',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения создания',
            default: false,
          },
        },
      },
    },
    {
      name: 'wb_add_to_supply',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Добавить заказы в поставку Wildberries. ' +
        'ВАЖНО: Без параметра confirm=true показывает preview. С confirm=true добавляет заказы.',
      inputSchema: {
        type: 'object',
        properties: {
          supplyId: {
            type: 'string',
            description: 'ID поставки',
          },
          orderIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Массив ID заказов для добавления',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения добавления',
            default: false,
          },
        },
        required: ['supplyId', 'orderIds'],
      },
    },
    {
      name: 'wb_close_supply',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Закрыть поставку и передать в доставку. ' +
        'ВАЖНО: После закрытия поставку нельзя изменить! Требует confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          supplyId: {
            type: 'string',
            description: 'ID поставки для закрытия',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения закрытия',
            default: false,
          },
        },
        required: ['supplyId'],
      },
    },
    {
      name: 'wb_delete_supply',
      annotations: { destructiveHint: true, readOnlyHint: false },
      description:
        'Удалить поставку Wildberries. ' +
        'Все заказы будут возвращены в список ожидающих сборки. Требует confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          supplyId: {
            type: 'string',
            description: 'ID поставки для удаления',
          },
          confirm: {
            type: 'boolean',
            description: 'true для подтверждения удаления',
            default: false,
          },
        },
        required: ['supplyId'],
      },
    },
    {
      name: 'wb_get_documents',
      annotations: { readOnlyHint: true },
      description:
        'Получить список финансовых документов из ЛК Wildberries. ' +
        'Возвращает еженедельные отчёты, акты, счета-фактуры и другие документы. ' +
        'Используйте для получения официальных финансовых отчётов для налогов.',
      inputSchema: {
        type: 'object',
        properties: {
          dateFrom: {
            type: 'string',
            description: 'Дата начала (YYYY-MM-DD)',
          },
          dateTo: {
            type: 'string',
            description: 'Дата конца (YYYY-MM-DD)',
          },
          category: {
            type: 'string',
            description: 'ID категории документа (опционально)',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество документов (до 50)',
            default: 50,
          },
          offset: {
            type: 'number',
            description: 'Смещение для пагинации',
            default: 0,
          },
        },
      },
    },
    {
      name: 'wb_get_document_categories',
      annotations: { readOnlyHint: true },
      description:
        'Получить категории документов Wildberries. ' +
        'Возвращает список категорий для фильтрации документов.',
      inputSchema: {
        type: 'object',
        properties: {
          locale: {
            type: 'string',
            description: 'Язык (ru, en, zh)',
            default: 'ru',
          },
        },
      },
    },
    {
      name: 'wb_download_document',
      annotations: { readOnlyHint: true },
      description:
        'Получить ссылку для скачивания документа Wildberries. ' +
        'Возвращает URL для скачивания в указанном формате.',
      inputSchema: {
        type: 'object',
        properties: {
          serviceName: {
            type: 'string',
            description: 'ID документа (serviceName из wb_get_documents)',
          },
          extension: {
            type: 'string',
            description: 'Формат: xlsx, pdf, zip',
            default: 'xlsx',
          },
        },
        required: ['serviceName'],
      },
    },
    {
      name: 'wb_get_npd_report',
      annotations: { readOnlyHint: true },
      description:
        'Рассчитать НПД (налог на профессиональный доход / самозанятый) за год на основе документов WB. ' +
        'Скачивает "Еженедельные отчеты реализации" (физ.лица 4%) и "Уведомления о выкупе" (юр.лица 6%), ' +
        'извлекает суммы и рассчитывает налог помесячно. ' +
        'ВАЖНО: Процесс длительный из-за rate limit WB API (10 сек между запросами).',
      inputSchema: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Год для расчета НПД (например, 2025)',
          },
        },
        required: ['year'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'wb_get_inventory': {
        const input = GetInventoryInputSchema.parse(args || {});
        const result = await getInventory(input);
        const markdown = formatInventoryAsMarkdown(result.products);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            source: result.source,
            syncedAt: result.syncedAt,
            products: result.products.slice(0, 20), // Limit for structured output
          },
        };
      }

      case 'wb_get_prices': {
        const input = GetPricesInputSchema.parse(args || {});
        const result = await getPrices(input);
        const markdown = formatPricesAsMarkdown(result.products);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            products: result.products.slice(0, 20),
          },
        };
      }

      case 'wb_update_price': {
        const input = UpdatePriceInputSchema.parse(args || {});
        const result = await updatePrice(input);
        const markdown = formatUpdateResult(result);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_get_cards': {
        const input = GetCardsInputSchema.parse(args || {});
        const result = await getCards(input);
        const markdown = formatCardsAsMarkdown(result.cards);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            cards: result.cards.slice(0, 20),
          },
        };
      }

      case 'wb_update_card': {
        const input = UpdateCardInputSchema.parse(args || {});
        const result = await updateCard(input);

        return {
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      }

      case 'wb_get_reviews': {
        const input = GetReviewsInputSchema.parse(args || {});
        const result = await getReviews(input);
        const markdown = formatReviewsAsMarkdown(result.reviews);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            hasMore: result.hasMore,
            reviews: result.reviews.slice(0, 20),
          },
        };
      }

      case 'wb_reply_review': {
        const input = ReplyReviewInputSchema.parse(args || {});
        const result = await replyReview(input);
        const markdown = formatReplyResult(result);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_get_orders': {
        const input = GetOrdersInputSchema.parse(args || {});
        const result = await getOrders(input);
        const markdown = formatOrdersAsMarkdown(result.orders, result.summary);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            summary: result.summary,
            orders: result.orders.slice(0, 20),
          },
        };
      }

      case 'wb_get_sales': {
        const input = GetSalesInputSchema.parse(args || {});
        const result = await getSales(input);
        const markdown = formatSalesAsMarkdown(result.sales, result.summary);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            summary: result.summary,
            sales: result.sales.slice(0, 50),
          },
        };
      }

      case 'wb_get_warehouses': {
        const input = GetWarehousesInputSchema.parse(args || {});
        const result = await getWarehouses(input);
        const markdown = formatWarehousesAsMarkdown(result.warehouses, result.byType);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_get_campaigns': {
        const input = GetCampaignsInputSchema.parse(args || {});
        const result = await getCampaigns(input);
        const markdown = formatCampaignsAsMarkdown(result.campaigns, result.summary);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            summary: result.summary,
            campaigns: result.campaigns.slice(0, 20),
          },
        };
      }

      case 'wb_get_campaign_stats': {
        const input = GetCampaignStatsInputSchema.parse(args || {});
        const result = await getCampaignStats(input);
        const markdown = formatCampaignStatsAsMarkdown(result.stats, result.period, result.summary);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            stats: result.stats,
            period: result.period,
            summary: result.summary,
          },
        };
      }

      case 'wb_pause_campaign': {
        const input = PauseCampaignInputSchema.parse(args || {});
        const result = await pauseCampaign(input);
        const markdown = formatPauseCampaignResult(result);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_update_campaign_budget': {
        const input = UpdateCampaignBudgetInputSchema.parse(args || {});
        const result = await updateCampaignBudget(input);
        const markdown = formatUpdateBudgetResult(result);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_update_campaign_cpm': {
        const input = UpdateCampaignCpmInputSchema.parse(args || {});
        const result = await updateCampaignCpm(input);
        const markdown = formatUpdateCpmResult(result);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_get_sales_funnel': {
        const input = GetSalesFunnelInputSchema.parse(args || {});
        const result = await getSalesFunnel(input);
        const markdown = formatSalesFunnelAsMarkdown(result.products, result.summary);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            summary: result.summary,
            products: result.products.slice(0, 30),
          },
        };
      }

      case 'wb_get_seller_info': {
        const input = GetSellerInfoInputSchema.parse(args || {});
        const result = await getSellerInfo(input);
        const markdown = formatSellerInfoAsMarkdown(result);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_get_products_in_stock': {
        const input = GetProductsInStockInputSchema.parse(args || {});
        const result = await getProductsInStock(input);
        const markdown = formatProductsInStockAsMarkdown(result.products);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            summary: result.summary,
            products: result.products,
          },
        };
      }

      case 'wb_get_balance': {
        const input = GetBalanceInputSchema.parse(args || {});
        const result = await getBalance(input);
        const markdown = formatBalanceAsMarkdown(result.balance);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_get_payments': {
        const input = GetPaymentsInputSchema.parse(args || {});
        const result = await getPayments(input);
        const markdown = formatPaymentsAsMarkdown(result.payments, result.summary);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            summary: result.summary,
            payments: result.payments.slice(0, 50),
          },
        };
      }

      case 'wb_get_realization_report': {
        const input = GetRealizationReportInputSchema.parse(args || {});
        const result = await getRealizationReport(input);
        const markdown = formatRealizationReportAsMarkdown(result.products, result.summary);
        const costTable = formatCostPriceTableAsMarkdown(result.products);

        return {
          content: [
            {
              type: 'text',
              text: markdown + '\n\n---\n\n' + costTable,
            },
          ],
          structuredContent: {
            summary: result.summary,
            products: result.products,
          },
        };
      }

      case 'wb_get_supplies': {
        const input = GetSuppliesInputSchema.parse(args || {});
        const result = await getSupplies(input);
        const markdown = formatSuppliesAsMarkdown(result.supplies);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            total: result.total,
            next: result.next,
            supplies: result.supplies,
          },
        };
      }

      case 'wb_get_supply': {
        const input = GetSupplyInputSchema.parse(args || {});
        const result = await getSupply(input);
        const markdown = formatSupplyDetailsAsMarkdown(result.supply, result.orders);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            supply: result.supply,
            orders: result.orders.slice(0, 50),
          },
        };
      }

      case 'wb_create_supply': {
        const input = CreateSupplyInputSchema.parse(args || {});
        const result = await createSupply(input);

        return {
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
          structuredContent: {
            preview: result.preview,
            supply: result.supply,
          },
        };
      }

      case 'wb_add_to_supply': {
        const input = AddToSupplyInputSchema.parse(args || {});
        const result = await addToSupply(input);

        return {
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
          structuredContent: {
            preview: result.preview,
            added: result.added,
            failed: result.failed,
          },
        };
      }

      case 'wb_close_supply': {
        const input = CloseSupplyInputSchema.parse(args || {});
        const result = await closeSupply(input);

        return {
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
          structuredContent: {
            preview: result.preview,
            closed: result.closed,
          },
        };
      }

      case 'wb_delete_supply': {
        const input = DeleteSupplyInputSchema.parse(args || {});
        const result = await deleteSupply(input);

        return {
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
          structuredContent: {
            preview: result.preview,
            deleted: result.deleted,
          },
        };
      }

      case 'wb_get_documents': {
        const input = GetDocumentsListInputSchema.parse(args || {});
        const result = await getDocumentsList(input);
        const markdown = formatDocumentsAsMarkdown(result.documents, result.summary);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: {
            summary: result.summary,
            documents: result.documents,
          },
        };
      }

      case 'wb_get_document_categories': {
        const input = GetDocumentCategoriesInputSchema.parse(args || {});
        const result = await getDocumentCategories(input);
        const markdown = formatCategoriesAsMarkdown(result.categories);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_download_document': {
        const input = DownloadDocumentInputSchema.parse(args || {});
        const result = await downloadDocument(input);

        return {
          content: [
            {
              type: 'text',
              text: result.message,
            },
          ],
          structuredContent: result,
        };
      }

      case 'wb_get_npd_report': {
        const input = GetNPDReportInputSchema.parse(args || {});
        const report = await getNPDReport(input);
        const markdown = formatNPDReportAsMarkdown(report);

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          structuredContent: report,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

// Handle shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('WB MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
