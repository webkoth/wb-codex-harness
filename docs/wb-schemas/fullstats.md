# Promotion API: fullstats, campaign lists

Source: https://dev.wildberries.ru/api/swagger/yaml/ru/08-promotion.yaml (fetched 2026-09-30, $ref resolved). Nesting shown with ". " prefixes.
Server: https://advert-api.wildberries.ru — category Продвижение. Money in "базовые единицы валюты аккаунта продавца" (RUB); bids in kopecks.

## GET /adv/v3/fullstats — Статистика кампаний

Description (verbatim): Метод формирует статистику для кампаний независимо от типа. Максимальный период в запросе — 31 день. Для кампаний в статусах `7`, `9` и `11`. В песочнице статистика кампаний доступна за последние 30 дней. Генерируется только для компаний в статусе `9`, тип `8`, 9 раз в сутки

| Тип | Период | Лимит | Интервал | Всплеск |
| --- | --- | --- | --- | --- |
| Персональный | 1 мин | 3 запроса | 20 сек | 1 запрос |
| Сервисный | 1 мин | 3 запроса | 20 сек | 1 запрос |
| Базовый с секретом | 1 мин | 3 запроса | 20 сек | 1 запрос |
| Базовый | 1 ч | 1 запрос | 1 ч | 1 запрос |

Parameters:
- `ids` (in query, string) **required**: ID кампаний, максимум 50 значений [example "22161678,28449281,28155229"]
- `beginDate` (in query, string, date) **required**: Дата начала интервала [example "2025-09-07"]
- `endDate` (in query, string, date) **required**: Дата окончания интервала [example "2025-09-08"]

### Response 200 — bare JSON array (one object per campaign)

Schema as declared in swagger (NB: swagger types `days` and `boosterStats` as "object", but the official example shows them as ARRAYS — trust the example):
- `[items]` (object): Статистика по одной кампании за период, указанный в запросе. По всем артикулам WB и платформам
. - `advertId` (integer) **required**: ID кампании
. - `atbs` (integer) **required**: Количество добавлений товаров в корзину
. - `boosterStats` (array per example): Статистика по средней позиции товара (для кампаний с единой ставкой) — items `{avg_position, date, nm}`
. - `canceled` (integer) **required**: Отмены, шт.
. - `clicks` (integer) **required**: Количество кликов
. - `cpc` (number, double) **required**: Средняя стоимость клика в базовых единицах валюты аккаунта продавца
. - `cr` (number, double) **required**: CR (conversion rate) — отношение количества заказов к общему количеству кликов
. - `ctr` (number, double) **required**: CTR (click-through rate) — отношение числа кликов к количеству показов в процентах
. - `days` (array per example) **required**: Статистка по дням
. - `orders` (integer) **required**: Количество заказов
. - `shks` (integer) **required**: Количество заказанных товаров, шт.
. - `sum` (number, double) **required**: Затраты в базовых единицах валюты аккаунта продавца
. - `sum_price` (number, double) **required**: Сумма заказов в базовых единицах валюты аккаунта продавца
. - `views` (integer) **required**: Количество просмотров
. - `currency` (string, ISO 4217) **required**: Валюта аккаунта продавца

Structure (from example): campaign → `days[]` {date, views, clicks, ctr, cpc, cr, atbs, orders, shks, sum, sum_price, canceled, `apps[]`} → `apps[]` {appType, same metrics, `nms[]`} → `nms[]` {nmId, name, views, clicks, ctr, cpc, cr, atbs, orders, shks, sum, sum_price, canceled}.
Per-nm totals for a period = sum over days[].apps[].nms[] with the same nmId. appType values in example: 1, 32, 64 (platforms; meaning not documented in this schema).

Response example (verbatim, truncated):
```json
[
 {
  "advertId": 22161678,
  "atbs": 9,
  "boosterStats": [
   {"avg_position": 24, "date": "2025-09-07", "nm": 221725278},
   {"avg_position": 35, "date": "2025-09-08", "nm": 221725278}
  ],
  "canceled": 0, "clicks": 139, "cpc": 4.76, "cr": 0, "ctr": 10.12,
  "days": [
   {
    "apps": [
     {
      "appType": 1, "atbs": 0, "canceled": 0, "clicks": 1, "cpc": 10.19, "cr": 0, "ctr": 4.76,
      "nms": [
       {"atbs": 0, "canceled": 0, "clicks": 1, "cpc": 10.19, "cr": 0, "ctr": 4.76, "name": "постер 2",
        "nmId": 221725278, "orders": 0, "shks": 0, "sum": 10.19, "sum_price": 0, "views": 21}
      ],
      "orders": 0, "shks": 0, "sum": 10.19, "sum_price": 0, "views": 21
     },
     {
      "appType": 32, "atbs": 1, "canceled": 0, "clicks": 54, "cpc": 4.26, "cr": 0, "ctr": 11.37,
      "nms": [
       {"atbs": 1, "canceled": 0, "clicks": 54, "cpc": 4.26, "cr": 0, "ctr": 11.37, "name": "постер 2",
        "nmId": 221725278, "orders": 0, "shks": 0, "sum": 230.08, "sum_price": 0, "views": 475}
      ],
      "orders": 0, "shks": 0, "sum": 230.08, "sum_price": 0, "views": 475
     }
    ],
    "atbs": 2, "canceled": 0, "clicks": 75, "cpc": 5.05, "cr": 0, "ctr": 9.57,
    "date": "2025-09-07T00:00:00Z",
    "orders": 0, "shks": 0, "sum": 378.49, "sum_price": 0, "views": 784
   },
   ...
  ],
  ...
 }
]
```
(verbatim example truncated after the first day; campaign-level `orders/shks/sum/sum_price/views/currency` follow `days` per schema.)

Errors: 400, 401, 403, 429.

## GET /adv/v1/promotion/count — Списки кампаний

Servers: https://advert-api.wildberries.ru, https://advert-api-sandbox.wildberries.ru
Description (verbatim): Метод возвращает списки всех рекламных кампаний продавца с их ID. Кампании сгруппированы по типу и статусу, у каждой указана дата последнего изменения.
Limits: Персональный/Сервисный/Базовый с секретом — 5 запросов / 1 сек, интервал 200 мс, всплеск 5; Базовый — 4 запроса / 1 ч.
No parameters.

Response 200:
- `adverts` (array, nullable): Данные по кампаниям
. - `type` (integer): Тип кампании: `8` — кампания с единой ставкой (**устаревший тип**); `9` — кампания с единой или ручной ставкой. Тип ставки — поле `bid_type` в методе Информация о кампаниях
. - `status` (integer): Статус кампании
. - `count` (integer): Количество кампаний
. - `advert_list` (array): Список кампаний
. . - `advertId` (integer): ID кампании
. . - `changeTime` (string, date-time): Дата и время последнего изменения кампании
- `all` (integer): Общее количество кампаний всех статусов и типов

```json
{
 "adverts": [
  {"type": 9, "status": 8, "count": 3,
   "advert_list": [
    {"advertId": 6485174, "changeTime": "2023-05-10T12:12:52.676254+03:00"},
    {"advertId": 6500443, "changeTime": "2023-05-10T17:08:46.370656+03:00"},
    {"advertId": 7936341, "changeTime": "2023-07-12T15:51:08.367478+03:00"}
   ]}
 ],
 "all": 3
}
```
Errors: 401, 403, 429.

## GET /api/advert/v2/adverts — Информация о кампаниях

Description (verbatim): Метод возвращает информацию о рекламных кампаниях с единой или ручной ставкой по их статусам, типам оплаты и ID.
Limits: Персональный/Сервисный/Базовый с секретом — 5 запросов / 1 сек, всплеск 5; Базовый — 1 запрос / 1 ч.

Parameters:
- `ids` (in query, string): ID кампаний, максимум 50 [example "12345,23456,34567,45678,56789"]
- `statuses` (in query, string): Статусы кампаний: `-1` — удалена, процесс удаления будет завершён в течение 10 минут; `4` — готова к запуску; `7` — завершена; `8` — отменена; `9` — активна; `11` — на паузе [example "-1,4,8"]
- `payment_type` (in query, string): `cpm` — за показы, `cpc` — за клик [enum: ["cpm","cpc"]]

Response 200:
- `adverts` (array) **required**: Кампании
. - `bid_type` (string) **required**: `unified` — единая ставка, `manual` — ручная ставка
. - `currency` (string, ISO 4217): Валюта аккаунта продавца
. - `id` (integer, int64) **required**: ID кампании
. - `nm_settings` (array, nullable) **required**: Настройки товаров
. . - `bids_kopecks` (object) **required**: Ставка в разменных единицах — 0,01 от базовой валюты
. . . - `search` (integer, int64) **required**: Ставка в поиске
. . . - `recommendations` (integer, int64) **required**: Ставка в рекомендациях
. . - `subject` (object) **required**: {`id` int64, `name` string}
. . - `nm_id` (integer, int64) **required**: Артикул WB
. - `settings` (object) **required**
. . - `payment_type` (string) **required**: `cpm` | `cpc`
. . - `name` (string) **required**: Название кампании
. . - `placements` (object) **required**: {`search` boolean, `recommendations` boolean}
. - `restrictions` (object) **required**: {`can_change_nms` boolean}
. - `status` (integer) **required** [enum: [-1,4,7,8,9,11]]
. - `timestamps` (object) **required**
. . - `created` (date-time) **required**, `updated` (date-time) **required**, `started` (date-time, nullable) **required**: Время последнего запуска кампании, `deleted` (date-time) **required**: Время удаления кампании. Если кампания не удалена, время указывается в будущем

```json
{
 "adverts": [
  {
   "bid_type": "manual", "currency": "RUB", "id": 28150154,
   "nm_settings": [
    {"bids_kopecks": {"recommendations": 0, "search": 1100}, "nm_id": 5764746785, "subject": {"id": 69, "name": "платья"}}
   ],
   "restrictions": {"can_change_nms": false},
   "settings": {"name": "Кампания от 28.08.2025 ", "payment_type": "cpc", "placements": {"recommendations": false, "search": true}},
   "status": 11,
   "timestamps": {"created": "2025-08-28T09:50:57.611559+03:00", "deleted": "2100-01-01T00:00:00+03:00", "started": null, "updated": "2025-09-10T10:14:58.475499+03:00"}
  }
 ]
}
```
Errors: 400, 401, 403, 429.
