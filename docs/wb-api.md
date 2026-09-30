# API WB: что используем (сверено с dev.wildberries.ru 30.09.2026)

Полные схемы запросов и ответов лежат в `docs/wb-schemas/`, это выдержки из swagger.

| Задача | Метод | Лимит (персональный токен) | Категория токена |
|---|---|---|---|
| Детализация реализации | `POST finance-api /api/finance/v1/sales-reports/detailed` (rrdId до 204, limit ≤ 100000) | 1 в минуту | Финансы |
| Платное хранение по nmID | `GET seller-analytics-api /api/v1/paid_storage` → `/tasks/{id}/status` → `/download`, ≤ 8 дней | создание 1 в минуту | Аналитика |
| Платная приёмка | `GET /api/v1/acceptance_report` (тот же поток), ≤ 31 дня | 1 в минуту | Аналитика |
| Список кампаний | `GET advert-api /adv/v1/promotion/count` | 5 в секунду | Продвижение |
| Статистика рекламы по nmID | `GET /adv/v3/fullstats?ids=…&beginDate&endDate` (≤ 50 кампаний, ≤ 31 дня, статусы 7/9/11) | 3 в минуту | Продвижение |
| Воронка карточек | `POST seller-analytics-api /api/analytics/v3/sales-funnel/products` (≤ 365 дней, без Джема) | 3 в минуту | Аналитика |
| Поисковые запросы карточки | `POST /api/v2/search-report/product/search-texts` (≤ 50 nmID, 30 запросов; Джем «Продвинутый» — 100) | — | Аналитика |
| Карточки | `POST content-api /content/v2/get/cards/list` (курсор updatedAt+nmID) | 100 в минуту | Контент |
| Правка карточки | `POST /content/v2/cards/update`: **перезапись целиком**, включая `documents` с 08.09.2026 | 10 в минуту | Контент |
| Ошибки правок | `POST /content/v2/cards/error/list` | 10 в минуту | Контент |
| Проверка токена | `GET <домен>/ping` | — | любая |

## Важно
- Органических показов и CTR нет ни в одном методе. Есть `visibility` (%), позиции и переходы из поиска.
- Строки реализации без товара: хранение, «ВБ.Продвижение» с баланса, «Джем», разовые удержания (причина в `bonusTypeName`).
- Лимиты считаются на аккаунт продавца и делятся со всеми программами, у которых есть токен (MPStats и другие).
- 429: ждать `X-Ratelimit-Retry` секунд.
- Токен: персональный, срок 180 дней. Бит 30 поля `s` в JWT означает «только чтение».
- `GET /adv/v1/budget` отключат 16.11.2026, замена `POST /api/advert/v2/budget`. Проверить `wb_update_campaign_budget` до этой даты.
