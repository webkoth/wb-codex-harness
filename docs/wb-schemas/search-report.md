# Search report («Поисковые запросы по вашим товарам»)

Source: https://dev.wildberries.ru/api/swagger/yaml/ru/11-analytics.yaml (fetched 2026-09-30, $ref resolved). Nesting shown with ". " prefixes.
Server: https://seller-analytics-api.wildberries.ru — category Аналитика.
Metric objects are compacted as `{current, dynamics}` (current required; dynamics = % vs past period, optional) or `{current, dynamics, percentile}`.
Джем: swagger does NOT state a Джем requirement for these methods; it only says search-texts `limit` max 30, or 100 for Джем tariffs «Продвинутый»/«Премиальный». Whether a 403 is returned without Джем — NOT confirmed.
Other methods of the group: `POST /api/v2/search-report/table/groups`, `POST /api/v2/search-report/table/details`, `POST /api/v2/search-report/product/orders` (orders & positions per search text by day, period max 7 days, within last 365 days).

Rate limit (all): Персональный/Сервисный/Базовый с секретом — 3 запроса/1 мин, интервал 20 сек, всплеск 3; Базовый — 1 запрос/1 ч. Data updated once per hour.

## POST /api/v2/search-report/report — «Основная страница»

Description (verbatim, HTML stripped): Метод формирует набор данных для основной страницы отчёта по поисковым запросам с: общей информацией; позициями товаров; данными по видимости и переходам в карточку; данными для таблицы по группам. Для получения дополнительных данных в таблице используйте отдельный запрос для: пагинации по группам; получения по товарам в группе. Дополнительный параметр выбора списка товаров в таблице: `positionCluster` — средняя позиция в поиске. Параметры `includeSubstitutedSKUs` и `includeSearchTexts` не могут одновременно иметь значение `false`. Данные отчёта обновляются 1 раз в час.

### Request body (application/json) required
- `currentPeriod` (object) **required**: Текущий период
. - `start` (string, date) **required**: Дата начала периода. Не позднее `end`. Не ранее 365 суток от сегодня [example "2024-02-10"]
. - `end` (string, date) **required**: Дата окончания периода. Не ранее 365 суток от сегодня [example "2024-02-10"]
- `pastPeriod` (object): Прошлый период для сравнения. Количество дней — меньше или равно `currentPeriod`
. - `start` (string, date) **required** [example "2024-02-08"]
. - `end` (string, date) **required**: Не позднее даты перед датой начала `currentPeriod` [example "2024-02-08"]
- `nmIds` (array of integer int32): Список артикулов WB для фильтрации
- `subjectIds` (array of integer int32): Список ID предметов для фильтрации
- `brandNames` (array of string): Список брендов для фильтрации
- `tagIds` (array of integer int64): Список ID ярлыков для фильтрации
- `positionCluster` (string) **required**: `all` — все, `firstHundred` — 1–100, `secondHundred` — 101–200, `below` — от 201 и ниже [enum; example "all"]
- `orderBy` (object) **required**
. - `field` (string) **required** [enum: ["avgPosition","openCard","addToCart","openToCart","orders","cartToOrder","visibility","minPrice","maxPrice"]]
. - `mode` (string) **required** [enum: ["asc","desc"]]
- `includeSubstitutedSKUs` (boolean): Показать данные по прямым запросам с подменным артикулом [default true]
- `includeSearchTexts` (boolean): Показать данные по поисковым запросам без учёта подменного артикула [default true]
- `limit` (integer, uint32) **required**: Количество групп товаров в ответе [max 1000; example 130]
- `offset` (integer, uint32) **required**: После какого элемента выдавать данные [example 50]

### Response 200 (application/json) — `{ "data": {...}, ... }`
- `data` (object) **required**
. - `commonInfo` (object) **required**: Общая информация
. . - `supplierRating` {current float64, dynamics float64} **required**: Рейтинг продавца
. . - `advertisedProducts` {current, dynamics} **required**: Количество товаров в рекламе
. . - `totalProducts` (integer, uint64) **required**: Общее количество товаров
. - `positionInfo` (object) **required**
. . - `average` {current, dynamics} **required**: Средняя позиция товара в результатах поиска
. . - `median` {current, dynamics} **required**: Медианная позиция
. . - `chartItems` (array of {`dt` string, `average` uint64, `median` uint64}) **required**
. . - `clusters` (object) **required**: `firstHundred`, `secondHundred`, `below` — each {current, dynamics} (количество товаров)
. - `visibilityInfo` (object) **required**: Видимость карточек и переходы в карточки. По дням, неделям, месяцам
. . - `visibility` {current, dynamics} **required**: Видимость — процент вероятности, что пользователь увидит карточку товара. Зависит от средней позиции
. . - `openCard` {current, dynamics} **required**: Количество переходов в карточку товара из поиска
. . - `byDay` / `byWeek` / `byMonth` (array of {`dt` date, `visibility` uint64 %, `open` uint64 переходов})
. - `groups` (array): Список элементов таблицы. Группа — все карточки, подходящие хотя бы по одному из параметров subjectName / brandName / tagName
. . - `subjectName` (string), `subjectId` (uint64), `brandName` (string), `tagName` (string), `tagId` (int64)
. . - `metrics` (object) **required**: `avgPosition`, `openCard`, `addToCart`, `openToCart`, `orders`, `cartToOrder`, `visibility` — each {current, dynamics}, all required
. . - `items` (array) **required**: Массив товаров группы
. . . - `nmId` (int64), `name`, `vendorCode`, `subjectName`, `brandName`, `mainPhoto` (URL)
. . . - `isAdvertised` (boolean): Находится ли товар в продвижении в Поисковой выдаче
. . . - `isSubstitutedSKU` (boolean): Искали ли товар по подменному артикулу
. . . - `isCardRated` (boolean), `rating` (float64), `feedbackRating` (float64)
. . . - `price` {`minPrice` uint64, `maxPrice` uint64}: цена продавца со скидкой продавца (без учёта скидки WB Клуба)
. . . - `avgPosition`, `openCard`, `addToCart`, `openToCart`, `orders`, `cartToOrder`, `visibility` — each {current, dynamics}
- `currency` (string) **required** [example "RUB"]  (in swagger listed at data level, printed under data)

Errors: 400, 401, 402, 403, 429.

## POST /api/v2/search-report/product/search-texts — «Поисковые запросы по товару»

Description (verbatim): Метод формирует топ поисковых запросов по товару. Параметры выбора поисковых запросов: `limit` — количество запросов, максимум 30. Для тарифов Джема **Продвинутый** и **Премиальный** максимум — 100. `topOrderBy` — способ выбора топа запросов. Параметры `includeSubstitutedSKUs` и `includeSearchTexts` не могут одновременно иметь значение `false`. Данные отчёта обновляются 1 раз в час.

### Request body (application/json) required
- `currentPeriod` {start date, end date} **required** (не ранее 365 суток от сегодня)
- `pastPeriod` {start, end}: Прошлый период для сравнения
- `nmIds` (array of uint64) **required**: Список артикулов WB [maxItems 50]
- `topOrderBy` (string) **required**: по каким запросам больше всего [enum: ["openCard","addToCart","openToCart","orders","cartToOrder"]]
- `includeSubstitutedSKUs` (boolean) [default true]
- `includeSearchTexts` (boolean) [default true]
- `orderBy` (object) **required**: `field` [enum: ["avgPosition","openCard","addToCart","openToCart","orders","cartToOrder","visibility"]], `mode` [asc|desc]
- `limit` (integer, uint64) **required**: oneOf — стандартный тариф [min 1; max 30]; продвинутый тариф [min 1; max 100]

### Response 200 (application/json) — `{ "data": { "items": [...] }, "currency" }`
- `data.items[]` (object):
. - `text` (string) **required**: Текст поискового запроса [example "костюм"]
. - `nmId` (uint64) **required**, `subjectName`, `brandName`, `vendorCode`, `name` **required**
. - `isCardRated` (boolean), `rating` (float64), `feedbackRating` (float64) **required**
. - `price` {minPrice, maxPrice} **required**
. - `frequency` {current, dynamics} **required**: Количество обращений с поисковым запросом
. - `weekFrequency` (uint64) **required**: Количество обращений с поисковым запросом за неделю
. - `medianPosition` {current, dynamics} **required**: Медианная позиция. Учитываются только те позиции, из которых пользователи добавляли товар в корзину или переходили в его карточку
. - `avgPosition` {current, dynamics} **required**
. - `openCard` {current, dynamics, percentile} **required**: переходы в карточку из поиска; percentile — на сколько % выше, чем у карточек других продавцов по запросу
. - `addToCart` {current, dynamics, percentile} **required**
. - `openToCart` {current, dynamics, percentile} **required**: Конверсия в корзину из поиска
. - `orders` {current, dynamics, percentile} **required**
. - `cartToOrder` {current, dynamics, percentile} **required**: Конверсия в заказ из поиска
. - `visibility` {current, dynamics} **required**: Процент видимости товара в результатах поиска
- `currency` (string) **required**

NB: no absolute impressions or CTR anywhere — only `visibility` % and `openCard` counts.
