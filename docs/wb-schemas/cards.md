# Content API: cards list, cards update, error list

Source: https://dev.wildberries.ru/api/swagger/yaml/ru/02-items.yaml (fetched 2026-09-30, $ref resolved). Nesting shown with ". " prefixes.
Servers: https://content-api.wildberries.ru (prod), https://content-api-sandbox.wildberries.ru (sandbox) — category Контент.

## POST /content/v2/get/cards/list — Список карточек товаров

Description (verbatim, condensed): Метод возвращает список созданных карточек товаров. В ответе метода не будет карточек, находящихся в корзине (для них — отдельный метод `/content/v2/get/cards/trash`).
Чтобы получить **больше 100** карточек товаров, используйте пагинацию:
1. Сделайте первый запрос: `{"settings":{"sort":{"ascending":true},"cursor":{"limit":100},"filter":{"withPhoto":-1}}}`
   Чтобы после выгрузки получать только новые или обновлённые карточки товаров, используйте сортировку по возрастанию: `"sort":{"ascending":true}`.
2. Скопируйте `"updatedAt":"***","nmID":"***"` из `cursor` ответа и вставьте в `cursor` запроса.
3. Повторите запрос.
4. Повторяйте пункты 2 и 3, пока значение `total` в ответе не станет меньше, чем значение `limit` в запросе. Это будет означать, что вы получили все карточки.
Инкрементальная выгрузка: сохраните `cursor{updatedAt,nmID}` из последнего ответа и начните с него следующую выгрузку (ascending:true).
Limit: 100 запросов / 1 мин, интервал 600 мс, всплеск 5.

Parameters:
- `locale` (in query, string): Язык полей ответа `name`, `value` и `object`: `ru`, `en`, `zh`. Не используется в песочнице [example "ru"]

### Request body (application/json) required
- `settings` (object): Настройки
. - `sort` (object)
. . - `ascending` (boolean): Сортировать по полю `updatedAt`: `false` — по убыванию, `true` — по возрастанию [default false]
. - `filter` (object): Параметры фильтрации
. . - `withPhoto` (integer): Фильтр по фото: `-1` — любые карточки; `0` — только карточки без фото (с 16 июня — любые карточки); `1` — только карточки с фото; `2` — только карточки без фото (с 16 июня) [enum: [-1,0,1,2]; default 0]
. . - `textSearch` (string): Поиск по артикулу продавца, артикулу WB, баркоду
. . - `tagIDs` (array of integer): Поиск по ID ярлыков
. . - `allowedCategoriesOnly` (boolean): Фильтр по категории: `true` — только разрешённые, `false` — все. Не используется в песочнице
. . - `objectIDs` (array of integer): Поиск по ID предметов
. . - `brands` (array of string): Поиск по брендам
. . - `imtID` (integer, int64): Поиск по ID для объединённых карточек товаров
. - `cursor` (object): Курсор
. . - `limit` (integer): Сколько карточек товаров выдать в ответе [max 100; default 10]
. . - `updatedAt` (string, nullable): Дата и время изменения
. . - `nmID` (integer): Артикул WB, с которого надо запрашивать следующий список карточек товаров

Request example (verbatim):
```json
{"settings": {"sort": {"ascending": false},
  "filter": {"textSearch": "4603743187500888", "allowedCategoriesOnly": true, "tagIDs": [345, 415], "objectIDs": [235, 67], "brands": ["уллу", "EkkE"], "imtID": 328632, "withPhoto": 0},
  "cursor": {"updatedAt": "2023-12-06T11:17:00.96577Z", "nmID": 370870300, "limit": 11}}}
```

### Response 200 — `{ "cards": [...], "cursor": {...} }`
- `cards` (array): Список карточек товаров
. - `nmID` (integer): Артикул WB
. - `imtID` (integer, int64): ID для объединённых карточек товаров. Един для всех артикулов WB группы объединённых карточек. У каждой карточки товара есть `imtID`, даже если она не объединена с другими карточками
. - `nmUUID` (string, UUID): Внутренний технический ID карточки товара
. - `subjectID` (integer): ID предмета
. - `subjectName` (string): Название предмета
. - `vendorCode` (string): Артикул продавца
. - `brand` (string): Бренд
. - `title` (string): Наименование товара
. - `description` (string): Описание товара
. - `needKiz` (boolean): Требуется ли код маркировки Честного знака для этого товара
. - `kizMarked` (boolean): Есть ли подтверждение от продавца, что обязательный код маркировки нанесён на товар [default false]
. - `photos` (array): Массив фото — items {`big` 900x1200, `c246x328`, `c516x688`, `square` 600x600, `tm` 75x100} (URLs)
. - `video` (string): URL видео
. - `wholesale` (object): B2B-продажа
. . - `enabled` (boolean): `true` — товар предназначен для продажи только B2B-покупателям; `false` — B2B и B2C
. . - `quantum` (number, uint64): Минимальное количество единиц товара в одной корзине B2B-покупателя. Только при `"enable":true`
. - `dimensions` (object): Габариты и вес товара c упаковкой, см и кг
. . - `length` (integer), `width` (integer), `height` (integer): см
. . - `weightBrutto` (number): Вес, кг. Количество знаков после запятой <=3
. . - `isValid` (boolean): Потенциальная некорректность габаритов: `true` — не выявлена (не гарантирует корректность); `false` — габариты значительно отличаются от средних по предмету; функциональность карточки не ограничивается
. - `documents` (object): Документы  (added 08.09.2026)
. . - `items` (array): Список документов
. . . - `id` (string): ID документа
. . . - `type` (integer): `1` Сертификат соответствия; `2` Декларация о соответствии; `3` СГР; `4` РУ на медицинские изделия; `5` РУ Республики Беларусь; `7` регистрация пестицида; `8` регистрация агрохимиката; `9` РУ на лекарственные препараты
. . . - `number` (string): Номер документа
. . . - `productNumber` (string): Дополнительный номер документа
. . . - `tradeName` (string): Торговое наименование
. . . - `applicant` (string): Представитель изготовителя медицинского изделия
. . . - `startDate` (string, date-time), `endDate` (string, date-time)
. . . - `isEndless` (boolean): Бессрочный ли документ
. . . - `verdict` (object): Результат проверки документа (когда проверка завершена)
. . . . - `verified` (boolean), `status` (integer: `1` пройдена, `2` не пройдена)
. . . . - `reason` (string, nullable): для `status: 2`: `document_missing`, `document_not_found`, `document_inactive`, `document_expired`, `applicant_mismatch`, `trade_name_mismatch`, `unknown`, `document_type_mismatch`, `document_dates_mismatch`, ...
. . . . - `additionalData` (object, nullable), `createdAt` (date-time)
. . . - `createdAt` (string, date-time): Дата добавления документа
. . - `overallVerdict` (object): Результат проверки карточки товара
. . . - `isFullyChecked` (boolean), `status` (integer: 1/2)
. . . - `reason` (string, nullable): `tnved_missing`, `supplier_inn_missing`, `supplier_not_registered`, `supplier_inactive`, `product_group_not_registered`, `kiz_required`, `kiz_certificate_missing`, ...
. . . - `createdAt` (string, date-time)
. . - `excludeDocuments` (boolean): Исключены ли документы из проверки карточки товара
. - `characteristics` (array)
. . - `id` (integer): ID характеристики
. . - `name` (string): Название характеристики
. . - `value` (any): Значение характеристики. Тип значения зависит от типа характеристики (array of strings or number)
. - `sizes` (array): Размеры товара
. . - `chrtID` (integer, uint64): Числовой ID размера для данного артикула WB
. . - `techSize` (string): Размер товара (А, XXL, 57 и др.)
. . - `wbSize` (string): Российский размер товара
. . - `skus` (array of string): Баркод товара
. - `tags` (array): Ярлыки — {`id` integer, `name` string, `color` string: D1CFD7 серый, FEE0E0 красный, ECDAFF фиолетовый, E4EAFF синий, DEF1DD зеленый, FFECC7 желтый}
. - `createdAt` (string): Дата и время создания
. - `updatedAt` (string): Дата и время изменения
- `cursor` (object): Пагинатор
. - `updatedAt` (string): Дата и время, с которых надо запрашивать следующий список
. - `nmID` (integer): Артикул WB, с которого надо запрашивать следующий список
. - `total` (integer): Количество возвращённых карточек товаров

Response example (verbatim):
```json
{
 "cards": [
  {
   "nmID": 12345678, "imtID": 123654789, "nmUUID": "01bda0b1-5c0b-736c-b2be-d0a6543e9be",
   "subjectID": 7771, "subjectName": "AKF системы", "vendorCode": "wb7f6mumjr1", "kizMarked": true,
   "brand": "Тест", "title": "Тест-система", "description": "Тестовое описание", "needKiz": false,
   "photos": [{"big": "https://basket-10.wbbasket.ru/vol1592/part159206/159206280/images/big/1.webp",
               "c246x328": "https://basket-10.wbbasket.ru/vol1592/part159206/159206280/images/c246x328/1.webp",
               "c516x688": "https://basket-10.wbbasket.ru/vol1592/part159206/159206280/images/c516x688/1.webp",
               "square": "https://basket-10.wbbasket.ru/vol1592/part159206/159206280/images/square/1.webp",
               "tm": "https://basket-10.wbbasket.ru/vol1592/part159206/159206280/images/tm/1.webp"}],
   "video": "https://videonme-basket-12.wbbasket.ru/vol137/part22557/225577433/hls/1440p/index.m3u8",
   "wholesale": {"enabled": true, "quantum": 112},
   "dimensions": {"length": 55, "width": 40, "height": 15, "weightBrutto": 6.24, "isValid": false},
   "documents": {
    "items": [{"id": "019f3c09-8c1f-7063-aee4-c45969fb2dc5", "type": 1, "number": "123456", "productNumber": "123456",
               "tradeName": "Trade Name", "applicant": "Applicant Name",
               "startDate": "2023-01-15T03:00:00+03:00", "endDate": "2026-01-14T03:00:00+03:00",
               "verdict": {"verified": true, "status": 1, "reason": null, "additionalData": null, "createdAt": "2026-05-28T18:10:43.375306+03:00"},
               "createdAt": "2026-05-28T18:09:25.394692+03:00"}],
    "overallVerdict": {"isFullyChecked": true, "status": 1, "reason": null, "createdAt": "2026-05-28T18:19:19.99444+03:00"},
    "excludeDocuments": false
   },
   "characteristics": [{"id": 14177449, "name": "Цвет", "value": ["красно-сиреневый"]}],
   "sizes": [{"chrtID": 316399238, "techSize": "0", "skus": ["987456321654"]}],
   "tags": [{"id": 592569, "name": "Популярный", "color": "D1CFD7"}],
   "createdAt": "2023-12-06T11:17:00.96577Z", "updatedAt": "2023-12-06T11:17:00.96577Z"
  }
 ],
 "cursor": {"updatedAt": "2023-12-06T11:17:00.96577Z", "nmID": 123654123, "total": 1}
}
```
Errors: 400, 401, 402, 403, 429.

## POST /content/v2/cards/update — Редактирование карточек товаров

Description (verbatim, HTML stripped): Метод обновляет данные карточек товаров. Также используйте его, чтобы добавлять новые размеры.
**Карточка товара перезаписывается при обновлении. Поэтому в запросе нужно передать в том числе те параметры карточки, которые вы не собираетесь обновлять.** Их значения можно получить в списке карточек товаров и списке карточек товаров в корзине.
С помощью этого метода нельзя обновлять или удалять: баркоды размеров товара (можно только добавить дополнительные баркоды); параметры `photos`, `video` и `tags`; цены товаров (цену можно задать, только если вы добавляете новые размеры).
При добавлении нового размера укажите его цену через параметр `price`. Если в запросе не указан `price`, цена размера будет `0` — изменить её можно методами цен (`/api/v2/upload/task` при `"editablePriceSize":false`, `/api/v2/upload/task/size` при `"editablePriceSize":true`).
Габариты товаров можно указать только в `сантиметрах`, вес товара с упаковкой — в `килограммах`.
Одним запросом можно отредактировать максимум 3000 карточек товаров (`nmID`). Максимальный размер запроса 10 Мб.
Если ответ `Успешно` (`200`), но какие-то карточки не обновились, проверьте список несозданных карточек товаров (`/content/v2/cards/error/list`).
Синхронизация данных с сервисами может занимать до 30 минут. В течение этого времени невозможно добавить остатки на склады и настроить цены.
Limit: 10 запросов / 1 мин, интервал 6 сек, всплеск 5.
Release note 08.09.2026: documents must be sent via `documents` object; since cards are overwritten, pass also the documents you are not changing.

### Request body (application/json) — array [min 1; max 3000]
- `[items]` (object):
. - `nmID` (integer) **required**: Артикул WB
. - `vendorCode` (string) **required**: Артикул продавца
. - `kizMarked` (boolean): Подтверждение, что на товар нанесён обязательный код маркировки Честного знака. Передайте `true`, чтобы подтвердить. Карточка не пройдёт модерацию без подтверждения, если код обязателен (см. `needKiz`) [default false]
. - `brand` (string): Бренд
. - `title` (string): Наименование товара [maxLength 60]
. - `description` (string): Описание товара. Максимальное количество символов зависит от категории товара. Стандарт — 2000, минимум — 1000, максимум — 5000
. - `dimensions` (object): Габариты и вес товара **c упаковкой**, в сантиметрах и килограммах. Синхронизация до 30 минут
. . - `length` (integer), `width` (integer), `height` (integer): см
. . - `weightBrutto` (number): кг, <=3 знаков после запятой
. - `documents` (object): Документы
. . - `items` (array): {`id` string, `type` integer (1,2,3,4,5,7,8,9 — см. выше), `number` string, `productNumber` string, `tradeName` string, `applicant` string, `startDate` date-time, `endDate` date-time, `isEndless` boolean}
. . - `excludeDocuments` (boolean): `true` — не проверять документы; при `true` все значения, переданные в `documents`, будут заменены на пустые значения [default false]
. - `characteristics` (array): Характеристики товара (получить: Характеристики предмета `/content/v2/object/charcs/{subjectId}`)
. . - `id` (integer) **required**: ID характеристики
. . - `value` (any) **required**: Значения характеристики. Тип данных — массив строк или число — зависит от `charcType`; допустимое количество значений — `maxCount`
. - `sizes` (array) **required**: Массив размеров. Для безразмерного товара всё равно нужно передавать данный массив без параметров (wbSize и techSize), но с баркодом
. . - `chrtID` (integer, uint64): ID размера. Обязателен для существующих размеров; для добавляемых размеров не указывается
. . - `techSize` (string): Размер товара (например, XL, S, 45)
. . - `wbSize` (string): Российский размер товара
. . - `price` (integer): Цена товара, ₽. Указывается при добавлении размера
. . - `skus` (array of string): Баркоды

Request example (verbatim):
```json
[
 {
  "nmID": 11111111, "vendorCode": "wbiz72wmro", "kizMarked": true, "brand": "",
  "title": "Свитер женский оверсайз с горлом", "description": "12345",
  "dimensions": {"length": 35, "width": 40, "height": 15, "weightBrutto": 3},
  "documents": {"items": [{"id": "019f3c09-8c1f-7063-aee4-c45969fb2dc5", "type": 1, "number": "123456", "productNumber": "123456",
                           "tradeName": "Trade Name", "applicant": "Applicant Name",
                           "startDate": "2023-01-15T03:00:00+03:00", "endDate": "2026-01-14T03:00:00+03:00", "isEndless": false}],
                "excludeDocuments": false},
  "characteristics": [{"id": 14177450, "value": ["хлопок 50% акрил 50%"]}, {"id": 50, "value": ["свободный крой"]}],
  "sizes": [{"chrtID": 12345678, "techSize": "ONE SIZE", "wbSize": "78-90", "skus": ["123487653460134"]}]
 }
]
```

### Response 200
- `data` (object, nullable)
- `error` (boolean): Флаг ошибки
- `errorText` (string): Описание ошибки
- `additionalErrors` (oneOf: object `{string: string|null}` | string|null | object `{error: string}`): Дополнительные ошибки
```json
{"data": null, "error": false, "errorText": "", "additionalErrors": {}}
```
Errors: 400, 401, 402, 403, 413 (Превышен лимит объёма данных в запросе), 429.

## POST /content/v2/cards/error/list — Список несозданных карточек товаров с ошибками

(Only POST exists in current swagger; no GET.)
Description (verbatim, HTML stripped): Метод возвращает список карточек товаров (черновиков), при создании или редактировании которых произошли ошибки, с описанием этих ошибок.
Данные в ответе возвращаются пакетами `batch`. Один пакет содержит: все ошибки по одному массиву `variants` одного запроса при создании карточек товаров; все ошибки одного запроса при создании с присоединением или редактировании карточек товаров.
Чтобы получить более 100 пакетов, используйте пагинацию:
1. Сделайте первый запрос: `{"cursor":{"limit":100},"order":{"ascending":true}}`
2. Скопируйте `"updatedAt":"***","batchUUID":"***"` из `cursor` ответа и вставьте в `cursor` запроса.
3. Повторите запрос.
4. Повторяйте пункты 2 и 3, пока не получите в ответе `"next":false`. Это будет означать, что вы получили все пакеты.
Чтобы удалить карточку товара из списка, сделайте ещё один запрос на создание, создание с присоединением или редактирование карточки товара с исправленными ошибками.
Limit (shared with «получение лимитов карточек товаров»): 10 запросов / 1 мин, интервал 6 сек, всплеск 5. В песочнице — максимум 1 запрос в секунду суммарно для всех методов Контента.

Parameters:
- `locale` (in query, string): Язык названий предметов: `ru`, `en`, `zh`. Не используется в песочнице

### Request body (application/json) required
- `cursor` (object): Пагинатор
. - `limit` (number, int): Количество пакетов в ответе [max 100; default 100]
. - `updatedAt` (string, date-time): Дата и время формирования последнего пакета в ответе на предыдущий запрос
. - `batchUUID` (string, UUID): ID последнего пакета в ответе на предыдущий запрос
- `order` (object)
. - `ascending` (boolean): `false` — по убыванию, `true` — по возрастанию [default true]

```json
{"cursor": {"limit": 31, "updatedAt": "2025-08-05T17:54:40+08:00", "batchUUID": "bca3744c-1c8b-4588-b345-62af3b2899ae"}, "order": {"ascending": true}}
```

### Response 200
- `data` (object) **required**
. - `items` (array) **required**: Пакеты данных
. . - `batchUUID` (string, UUID) **required**: ID пакета
. . - `subjects` (object) **required**: Предметы. Разбивка по `vendorCodes` — map vendorCode → {`id` uint64, `name` string}
. . - `brands` (object) **required**: Бренды. Разбивка по `vendorCodes` — map vendorCode → {`id`, `name`}
. . - `vendorCodes` (array of string) **required**: Артикулы продавца
. . - `errors` (object) **required**: Ошибки. Разбивка по `vendorCodes` — map vendorCode → array of string
. . - `updatedAt` (string, date-time) **required**: Дата и время создания или редактирования пакета
. - `cursor` (object) **required**
. . - `next` (boolean) **required**: Есть ли ещё черновики
. . - `updatedAt` (string, date-time) **required**
. . - `batchUUID` (string, UUID) **required**
- `error` (boolean) **required**, `errorText` (string) **required**, `additionalErrors` (object, nullable) **required**

```json
{
 "data": {
  "items": [
   {"batchUUID": "b15fecaf-57fd-4b63-ab6f-18d630b8793e",
    "subjects": {"wb15j2kjk9": {"id": 8827, "name": "Автомобили с пробегом"}},
    "brands": {},
    "vendorCodes": ["wb15j2kjk9"],
    "errors": {"wb15j2kjk9": ["Поле Наименование не должно содержать запрещенные символы: 😈 😊 🤨"]},
    "updatedAt": "2025-12-19T23:59:59Z"}
  ],
  "cursor": {"next": false, "updatedAt": "...", "batchUUID": "..."}
 },
 "error": false, "errorText": "", "additionalErrors": null
}
```
(verbatim example truncated/condensed; cursor values elided)
Errors: 400, 401, 403, 429.
