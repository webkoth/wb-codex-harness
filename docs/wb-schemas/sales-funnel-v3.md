# Sales funnel v3 — POST /api/analytics/v3/sales-funnel/products

Source: https://dev.wildberries.ru/api/swagger/yaml/ru/11-analytics.yaml (fetched 2026-09-30, $ref resolved). Nesting shown with ". " prefixes.
Server: https://seller-analytics-api.wildberries.ru — category Аналитика (x-category: contentanalytics).
Old `/api/v2/nm-report/detail` and `/detail/history` are no longer in swagger.
Sibling methods: `POST /api/analytics/v3/sales-funnel/products/history` (по дням/неделям, максимум последняя неделя), `POST /api/analytics/v3/sales-funnel/grouped/history`. History up to a year only via CSV `POST /api/v2/nm-report/downloads` type DETAIL_HISTORY_REPORT / GROUPED_HISTORY_REPORT — only with Джем.

Description (verbatim, HTML stripped):

Метод формирует отчёт о товарах, сравнивая ключевые показатели за текущий период с аналогичным прошлым.

Данные отчёта обновляются 1 раз в 2 часа.

В течение часа после события появляется большая часть данных: о заказах; о переходах в карточку товара; о добавлениях товаров в корзину. Малая часть этих данных может появляться в течение нескольких дней.

Выкупы, отмены и возвраты отображаются в отчёте за тот день, когда товар был заказан. Например, если заказ был сделан 1 января, а покупатель вернул товар 10 января, данные об этом возврате появятся в отчёте за 1 января. Окончательные итоги продаж вы можете отслеживать с помощью детализаций к отчётам реализации.

Параметры `brandNames`,`subjectIds`, `tagIds`, `nmIds` могут быть пустыми `[]`, тогда в ответе возвращаются все карточки продавца.

Если вы указали несколько параметров, в ответе будут карточки, в которых есть одновременно все эти параметры. Если карточки не подходят по параметрам запроса, вернётся пустой ответ `[]`.

Можно получить отчёт максимум за последние 365 дней.

В данных предыдущего периода:
* Данные в `pastPeriod` указаны за такой же период, что и в `selectedPeriod`
* Если дата начала `pastPeriod` раньше, чем год назад от текущей даты, она будет приведена к виду: `pastPeriod.start = текущая дата — 365 дней`

Можно использовать пагинацию.

| Тип | Период | Лимит | Интервал | Всплеск |
| --- | --- | --- | --- | --- |
| Персональный | 1 мин | 3 запроса | 20 сек | 3 запроса |
| Сервисный | 1 мин | 3 запроса | 20 сек | 3 запроса |
| Базовый с секретом | 1 мин | 3 запроса | 20 сек | 3 запроса |
| Базовый | 1 ч | 2 запроса | 30 мин | 1 запрос |

## Request body (application/json) required

- `selectedPeriod` (object) **required**: Запрашиваемый период
. - `start` (string, date) **required**: Начало периода [example "2023-06-01"]
. - `end` (string, date) **required**: Конец периода [example "2024-03-01"]
- `pastPeriod` (object): Период для сравнения
. - `start` (string, date) **required**
. - `end` (string, date) **required**
- `nmIds` (array of integer uint64): Артикулы WB, по которым нужно составить отчёт. Оставьте пустым, чтобы получить отчёт обо всех товарах [maxItems 1000]
- `brandNames` (array of string): Список брендов для фильтрации
- `subjectIds` (array of integer uint64): Список ID предметов для фильтрации
- `tagIds` (array of integer uint64): Список ID ярлыков для фильтрации
- `skipDeletedNm` (boolean): Скрыть удалённые товары [example false]
- `orderBy` (object): Параметры сортировки
. - `field` (string) **required**: Поле для сортировки [enum: ["openCard","addToCart","orderCount","orderSum","buyoutCount","buyoutSum","cancelCount","cancelSum","avgPrice","stockMpQty","stockWbQty","shareOrderPercent","addToWishlist","timeToReady","localizationPercent","wbClub.orderCount","wbClub.orderSum","wbClub.buyoutSum","wbClub.cancelSum","wbClub.buyoutCount","wbClub.avgPrice","wbClub.buyoutPercent","wbClub.avgOrderCountPerDay","wbClub.cancelCount"]; default "openCard"]
. - `mode` (string) **required**: `asc` | `desc` [default "desc"]
- `limit` (integer, uint32): Количество карточек товара в ответе [max 1000; default 50]
- `offset` (integer, uint32): Сколько элементов пропустить [default 0]

Example:
```json
{
 "selectedPeriod": {"start": "2026-09-01", "end": "2026-09-29"},
 "pastPeriod": {"start": "2026-08-04", "end": "2026-08-31"},
 "nmIds": [],
 "brandNames": [], "subjectIds": [], "tagIds": [],
 "skipDeletedNm": true,
 "orderBy": {"field": "openCard", "mode": "desc"},
 "limit": 1000, "offset": 0
}
```
(example constructed from schema, not copied from docs)

## Response 200 (application/json) — envelope `{ "data": { "products": [...], "currency": "RUB" } }`

- `data` (object) **required**
. - `products` (array) **required**: Список карточек товаров
. . - `[items]` (object):
. . . - `product` (object) **required**: Карточка товара
. . . . - `nmId` (integer, int64) **required**: Артикул WB [example 268913787]
. . . . - `title` (string) **required**: Название карточки товара [example "Кроссовки для бега"]
. . . . - `vendorCode` (string) **required**: Артикул продавца [example "12345456"]
. . . . - `brandName` (string) **required**: Бренд [example "Demix"]
. . . . - `subjectId` (integer, uint64) **required**: ID предмета [example 105]
. . . . - `subjectName` (string) **required**: Название предмета [example "Кроссовки"]
. . . . - `tags` (array of {`id` integer, `name` string}) **required**: Ярлыки
. . . . - `productRating` (number, float32) **required**: Оценка карточки [example 4.5]
. . . . - `feedbackRating` (number, float32) **required**: Оценка пользователей [example 4]
. . . . - `stocks` (object) **required**: Остатки
. . . . . - `wb` (integer, uint32) **required**: Общее количество остатков на складах WB на текущий день, шт.
. . . . . - `mp` (integer, uint32) **required**: Общее количество остатков на складах продавца на текущий день, шт.
. . . . . - `balanceSum` (integer, uint32) **required**: Сумма остатков на складах на текущий день, шт.
. . . - `statistic` (object) **required**: Статистика
. . . . - `selected` (object) **required**: Запрашиваемый период  — schema `Statistic`:
. . . . . - `period` (object) **required**: {`start` date, `end` date}
. . . . . - `openCount` (integer, uint32) **required**: Количество переходов в карточку товара [example 45]
. . . . . - `cartCount` (integer, int32) **required**: Положили в корзину, шт. [example 34]
. . . . . - `orderCount` (integer, uint32) **required**: Заказали товаров, шт. [example 19]
. . . . . - `orderSum` (integer, uint32) **required**: Заказали на сумму [example 1262]
. . . . . - `buyoutCount` (integer, uint32) **required**: Выкупили товаров, шт. [example 19]
. . . . . - `buyoutSum` (integer, uint32) **required**: Выкупили на сумму [example 1262]
. . . . . - `cancelCount` (integer, uint32) **required**: Отменили и вернули товаров, шт. [example 0]
. . . . . - `cancelSum` (integer, uint32) **required**: Отменили и вернули на сумму [example 0]
. . . . . - `avgPrice` (integer, uint32) **required**: Средняя цена [example 1262]
. . . . . - `avgOrdersCountPerDay` (number, float64) **required**: Среднее количество заказов в день, шт. [example 0.04]
. . . . . - `shareOrderPercent` (number, float64) **required**: Доля в выручке [example 3]
. . . . . - `addToWishlist` (integer) **required**: Добавили в **Отложенные** [example 455]
. . . . . - `timeToReady` (object) **required**: Среднее время доставки {`days`, `hours`, `mins` integer}
. . . . . - `localizationPercent` (integer) **required**: Локальные заказы в рамках одного региона. На данный момент может быть только `100`
. . . . . - `wbClub` (object) **required**: Статистика WB Клуба {`orderCount`, `orderSum`, `buyoutSum`, `buyoutCount`, `cancelSum`, `cancelCount`, `avgPrice`, `buyoutPercent` (uint32), `avgOrderCountPerDay` (float64)}
. . . . . - `conversions` (object) **required**: Конверсии
. . . . . . - `addToCartPercent` (integer) **required**: Конверсия в корзину. Какой процент посетителей, открывших карточку товара, добавили товар в корзину, % [example 19]
. . . . . . - `cartToOrderPercent` (integer) **required**: Конверсия в заказ. Какой процент посетителей, добавивших товар в корзину, сделали заказ, % [example 65]
. . . . . . - `buyoutPercent` (integer) **required**: Процент выкупа. Какой процент посетителей, заказавших товар, его выкупили. Без учёта товаров, которые еще доставляются покупателю, %
. . . . - `past` (object): Период для сравнения — same `Statistic` schema as `selected`
. . . . - `comparison` (object): Сравнение
. . . . . - `openCountDynamic`, `cartCountDynamic`, `orderCountDynamic`, `orderSumDynamic`, `buyoutCountDynamic`, `buyoutSumDynamic`, `cancelCountDynamic`, `cancelSumDynamic`, `avgOrdersCountPerDayDynamic`, `avgPriceDynamic`, `shareOrderPercentDynamic`, `addToWishlistDynamic`, `localizationPercentDynamic` (integer, all required): динамика, %
. . . . . - `timeToReadyDynamic` (object) **required**: {`days`,`hours`,`mins`}
. . . . . - `wbClubDynamic` (object) **required**: {orderCount, orderSum, buyoutSum, buyoutCount, cancelSum, cancelCount, avgPrice, buyoutPercent, avgOrderCountPerDay}
. . . . . - `conversions` (object) **required**: {addToCartPercent, cartToOrderPercent, buyoutPercent}
. - `currency` (string) **required**: Валюта отчёта [example "RUB"]

NB: no impressions / CTR fields in the funnel. Errors: 400, 401, 402 (only Каталог services), 403, 429.
