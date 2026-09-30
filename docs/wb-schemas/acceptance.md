# Paid acceptance report (Операции при приёмке) — async task flow

Source: https://dev.wildberries.ru/api/swagger/yaml/ru/12-reports.yaml (fetched 2026-09-30, $ref resolved). Nesting shown with ". " prefixes.
Server: https://seller-analytics-api.wildberries.ru — category Аналитика (x-category: contentanalytics). All GET.
Flow: create task → poll status until `done` → download (JSON array).

## 1. GET /api/v1/acceptance_report — Создать отчёт

Description (verbatim): Метод создаёт задание на генерацию отчёта об операциях при приёмке. Можно получить отчёт максимум за 31 день.

| Тип | Период | Лимит | Интервал | Всплеск |
| --- | --- | --- | --- | --- |
| Персональный | 1 мин | 1 запрос | 1 мин | 1 запрос |
| Сервисный | 1 мин | 1 запрос | 1 мин | 1 запрос |
| Базовый с секретом | 1 мин | 1 запрос | 1 мин | 1 запрос |
| Базовый | 3 ч | 1 запрос | 3 ч | 1 запрос |

Parameters:
- `dateFrom` (in query, string) **required**: Начало отчётного периода, `ГГГГ-ММ-ДД` [example "2025-02-28"]
- `dateTo` (in query, string) **required**: Конец отчётного периода, `ГГГГ-ММ-ДД` [example "2025-03-21"]

Response 200:
- `data` (object)
. - `taskId` (string): ID задания на генерацию
```json
{"data": {"taskId": "219eaecf-e532-4bd8-9f15-8036ec1b042d"}}
```
Errors: 400 (MissingDateTimeFrom/To, IncorrectDateTimeFrom/To, DateRangeExceeded, DateRanges), 401, 402, 403, 429.

## 2. GET /api/v1/acceptance_report/tasks/{task_id}/status — Проверить статус

Limits: Персональный/Сервисный/Базовый с секретом — 1 запрос / 5 сек, всплеск 1; Базовый — 2 запроса / 1 ч.

Parameters:
- `task_id` (in path, string) **required**: ID задания на генерацию [example "06e06887-9d9f-491f-b16a-bb1766fcb8d2"]

Response 200:
- `data` (object)
. - `id` (string): ID задания
. - `status` (string): `new` — новое, `processing` — обрабатывается, `done` — отчёт готов, `purged` — отчёт удалён, `canceled` — отклонено
```json
{"data": {"id": "cad56ec5-91ec-43a2-b5e8-efcf244cf309", "status": "done"}}
```
Errors: 400, 401, 403, 404, 429.

## 3. GET /api/v1/acceptance_report/tasks/{task_id}/download — Получить отчёт

Limits: Персональный/Сервисный/Базовый с секретом — 1 запрос / 1 мин, всплеск 1; Базовый — 2 запроса / 1 ч.

Parameters:
- `task_id` (in path, string) **required**

Response 200 — bare JSON array:
- `[items]` (object):
. - `count` (integer): Количество товаров, шт. [example 40]
. - `giCreateDate` (string, date): Дата создания поставки [example "2025-03-04"]
. - `incomeId` (integer): Номер поставки [example 11834106]
. - `nmID` (integer): Артикул WB [example 123456789]   <-- note capital "ID"
. - `shkCreateDate` (string, date): Дата приёмки [example "2025-03-14"]
. - `subjectName` (string): Предмет [example "Добавки пищевые"]
. - `total` (number): Суммарная стоимость приёмки, ₽ с копейками [example 873.04]

Example (constructed from field examples):
```json
[{"count": 40, "giCreateDate": "2025-03-04", "incomeId": 11834106, "nmID": 123456789, "shkCreateDate": "2025-03-14", "subjectName": "Добавки пищевые", "total": 873.04}]
```
Response 204: Нет данных. Errors: 400, 401, 402, 403, 404, 429.

Gap: history depth not stated in swagger. No vendorCode/size in rows — join by nmID.
