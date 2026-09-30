# Paid storage report (Платное хранение) — async task flow

Source: https://dev.wildberries.ru/api/swagger/yaml/ru/12-reports.yaml (fetched 2026-09-30, $ref resolved). Nesting shown with ". " prefixes.
Server: https://seller-analytics-api.wildberries.ru — category Аналитика (x-category: contentanalytics). All GET.
Flow: create task → poll status until `done` → download (JSON array).

## 1. GET /api/v1/paid_storage — Создать отчёт

Description (verbatim): Метод создаёт задание на генерацию отчёта о платном хранении. Можно получить отчёт максимум за 8 дней.

| Тип | Период | Лимит | Интервал | Всплеск |
| --- | --- | --- | --- | --- |
| Персональный | 1 мин | 1 запрос | 1 мин | 5 запросов |
| Сервисный | 1 мин | 1 запрос | 1 мин | 5 запросов |
| Базовый с секретом | 1 мин | 1 запрос | 1 мин | 5 запросов |
| Базовый | 1 ч | 1 запрос | 1 ч | 1 запрос |

Parameters:
- `dateFrom` (in query, string) **required**: Начало отчётного периода в формате RFC3339. Можно передать дату или дату со временем. Примеры: `2019-06-20`, `2019-06-20T23:59:59`, `2019-06-20T00:00:00.12345`, `2017-03-25T00:00:00` [example "2022-01-01"]
- `dateTo` (in query, string) **required**: Конец отчётного периода в формате RFC3339 [example "2022-01-09"]

Response 200:
- `data` (object)
. - `taskId` (string): ID задания на генерацию
```json
{"data": {"taskId": "219eaecf-e532-4bd8-9f15-8036ec1b042d"}}
```
Errors: 400 (e.g. missing/incorrect dates, DateRangeExceeded), 401, 402, 403, 429.

## 2. GET /api/v1/paid_storage/tasks/{task_id}/status — Проверить статус

Limits: Персональный/Сервисный/Базовый с секретом — 1 запрос / 5 сек, всплеск 5; Базовый — 2 запроса / 1 ч.

Parameters:
- `task_id` (in path, string) **required**: ID задания на генерацию [example "06e06887-9d9f-491f-b16a-bb1766fcb8d2"]

Response 200:
- `data` (object)
. - `id` (string): ID задания
. - `status` (string): Статус задания: `new` — новое, `processing` — обрабатывается, `done` — отчёт готов, `purged` — отчёт удалён, `canceled` — отклонено
```json
{"data": {"id": "cad56ec5-91ec-43a2-b5e8-efcf244cf309", "status": "done"}}
```
Errors: 400 (invalid UUID), 401, 403, 404 (`{"detail":"not found","origin":"api-statistics",...}`), 429.

## 3. GET /api/v1/paid_storage/tasks/{task_id}/download — Получить отчёт

Limits: Персональный/Сервисный/Базовый с секретом — 1 запрос / 1 мин, всплеск 1; Базовый — 2 запроса / 1 ч.

Parameters:
- `task_id` (in path, string) **required**

Response 200 — bare JSON array; one row per date × nmId × size/barcode (× supply giId):
- `[items]` (object):
. - `date` (string): Дата, за которую был расчёт или перерасчёт
. - `logWarehouseCoef` (number): Коэффициент логистики и хранения. На данный момент может быть только `0`
. - `officeId` (integer): ID склада. На данный момент может быть только `0`
. - `warehouse` (string): Название склада. На данный момент может быть только `Склад WB РФ`
. - `warehouseCoef` (number): Коэффициент хранения
. - `giId` (integer): ID поставки
. - `chrtId` (integer, uint64): ID размера для этого артикула WB
. - `size` (string): Размер (`techSize` в карточке товара)
. - `barcode` (string): Баркод
. - `subject` (string): Предмет
. - `brand` (string): Бренд
. - `vendorCode` (string): Артикул продавца
. - `nmId` (integer): Артикул WB
. - `volume` (number): Объём товара
. - `calcType` (string): Способ расчёта
. - `warehousePrice` (number): Сумма хранения
. - `barcodesCount` (integer): Количество единиц товара (штук), подлежащих тарифицированию за расчётные сутки
. - `palletPlaceCode` (integer): Код паллетоместа. На данный момент может быть только `0`
. - `palletCount` (number): Количество паллет
. - `originalDate` (string): Если был перерасчёт, это дата первоначального расчёта. Если перерасчёта не было, совпадает с `date`
. - `loyaltyDiscount` (number): Скидка программы лояльности, ₽
. - `tariffFixDate` (string): Дата фиксации тарифа
. - `tariffLowerDate` (string): Дата понижения тарифа

Example:
```json
[
 {
  "date": "2023-10-01", "logWarehouseCoef": 0, "officeId": 0, "warehouse": "Склад WB РФ",
  "warehouseCoef": 1.7, "giId": 123456, "chrtId": 1234567, "size": "0", "barcode": "",
  "subject": "Маски одноразовые", "brand": "1000 Каталог", "vendorCode": "567383", "nmId": 1234567,
  "volume": 12, "calcType": "короба: без габаритов", "warehousePrice": 7.65, "barcodesCount": 1,
  "palletPlaceCode": 0, "palletCount": 0, "originalDate": "2023-03-01", "loyaltyDiscount": 10,
  "tariffFixDate": "2023-10-01", "tariffLowerDate": "2023-11-01"
 }
]
```
Response 204: Нет данных. Errors: 400, 401, 402, 403, 404, 429.

Gap: how far back the report can go is not stated in swagger.
