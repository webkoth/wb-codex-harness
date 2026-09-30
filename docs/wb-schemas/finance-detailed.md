# WB Finance API — детализации к отчётам реализации за период

Source: https://dev.wildberries.ru/api/swagger/yaml/ru/13-finances.yaml (fetched 2026-09-30 via browser, $ref resolved).
Old `GET statistics-api /api/v5/supplier/reportDetailByPeriod` — removed from swagger, disabled 15.07.2026 (release-notes?id=498).
Related methods (same schemas): `POST /api/finance/v1/sales-reports/list` (list of reports, data since 01.01.2025), `POST /api/finance/v1/sales-reports/detailed/{reportId}` (details by report ID, data since 01.01.2025; for daily reports reportId may exceed 2^53 — use BigInt-capable JSON).

## POST /api/finance/v1/sales-reports/detailed

Server: https://finance-api.wildberries.ru
Summary: Детализации к отчётам реализации за период
Category: finance (x-readonly-method: true). Auth header: `Authorization: <token>`.

Description (verbatim, HTML stripped):

Метод возвращает детализации к [отчётам реализации](https://seller.wildberries.ru/suppliers-mutual-settlements) за указанный период.

Данные доступны с 29 января 2024 года.

Лимит запросов на один аккаунт продавца:

| Тип | Период | Лимит | Интервал | Всплеск |
| --- | --- | --- | --- | --- |
| Персональный | 1 мин | 1 запрос | 1 мин | 1 запрос |
| Сервисный | 1 мин | 1 запрос | 1 мин | 1 запрос |
| Базовый с секретом | 1 мин | 1 запрос | 1 мин | 1 запрос |
| Базовый | 24 ч | 2 запроса | 12 ч | 1 запрос |

### Request body (application/json) required — schema SalesReportsDetailedReq

- `dateFrom` (string) **required**: Начальная дата отчёта. Можно передать дату или дату со временем. Время можно указывать с точностью до секунд или миллисекунд. Дата передаётся в формате RFC3339, время — в часовом поясе Москва `UTC+3`. Примеры: `2025-06-20`, `2025-06-20T23:59:59`, `2025-06-20T00:00:00.12345`, `2025-06-20T00:00:00` [example "2026-03-17"]
- `dateTo` (string) **required**: Конечная дата отчёта. (формат как dateFrom) [example "2026-03-20"]
- `limit` (integer): Количество строк в ответе [max 100000; default 100000; example 21100]
- `rrdId` (integer): ID строки ответа. Необходим для получения отчёта частями. Начинайте загрузку отчёта с `"rrdid":0`. В последующих запросах передавайте значение `rrdId` из последней строки предыдущего ответа. Повторяйте запрос, пока не получите ответ `204` [default 0]
- `period` (string): Периодичность отчётов: `weekly` — еженедельные, `daily` — ежедневные [enum: ["daily","weekly"]; default "weekly"; example "daily"]
- `fields` (array of string): Список полей, которые вернутся в ответе. Если параметр не указан, возвращаются все поля [example ["rrdId","nmId","docTypeName","retailAmount","acquiringFee","srid"]]

Request example:
```json
{
 "dateFrom": "2026-03-17",
 "dateTo": "2026-03-20",
 "limit": 21100,
 "rrdId": 0,
 "period": "daily",
 "fields": ["rrdId","nmId","docTypeName","retailAmount","acquiringFee","srid"]
}
```

### Response 200: Успешно

Envelope: **bare JSON array** (no `{data: ...}` wrapper) of objects `SalesReportsDetailedRes`. 204 = no more data (end of pagination).
NOTE: money fields are **strings** (e.g. "376.99"); percents are numbers.

Row fields (all listed as required unless noted):

- `reportId` (integer, int64): ID отчёта [example 1234567]
- `dateFrom` (string, date): Дата начала отчётного периода [example "2026-03-16"]
- `dateTo` (string, date): Дата конца отчётного периода [example "2026-03-22"]
- `createDate` (string, date): Дата формирования отчёта [example "2026-03-23"]
- `currency` (string): Валюта отчёта [example "RUB"]
- `reportType` (integer): Тип отчёта: `1` — основной, `2` — по выкупам [enum: [1,2]; example 1]
- `rrdId` (integer): ID строки [example 1232610467]
- `giId` (integer): ID поставки [example 123456]
- `dlvPrc` (number): Фиксированный коэффициент склада по поставке [example 1.8]
- `fixTariffDateFrom` (string, date): Дата начала действия фиксации [example "2026-03-18"]
- `fixTariffDateTo` (string, date): Дата конца действия фиксации [example "2026-03-19"]
- `subjectName` (string): Предмет [example "Мини-печи"]
- `nmId` (integer): Артикул WB [example 1234567]
- `brandName` (string): Бренд [example "BlahBlah"]
- `vendorCode` (string): Артикул продавца [example "MAB123"]
- `title` (string): Название товара [example "ДС тарелка"]
- `techSize` (string): Размер [example "0"]
- `sku` (string): Баркод [example "1231312352310"]
- `docTypeName` (string): Тип документа [example "Продажа"]
- `quantity` (integer): Количество [example 1]
- `retailPrice` (string): Цена розничная [example "1249"]
- `retailAmount` (string): Wildberries реализовал Товар (Пр) [example "367"]
- `salePercent` (integer): Согласованный продуктовый дисконт, % [example 0]
- `commissionPercent` (number): Размер кВВ, % [example 24]
- `officeName` (string): Склад [example "Склад WB"]
- `sellerOperName` (string): Обоснование для оплаты [example "Продажа"]
- `orderDt` (string, date-time): Дата и время заказа [example "2026-03-14T00:00:00Z"]
- `saleDt` (string, date-time): Дата и время продажи [example "2026-03-21T00:00:00Z"]
- `rrDate` (string, date): Дата операции [example "2025-10-20"]   <-- (old rr_dt)
- `shkId` (integer): Штрихкод [example 1239159661]
- `retailPriceWithDisc` (string): Цена розничная с учётом согласованной скидки [example "399.68"]
- `deliveryAmount` (integer): Количество доставок [example 0]
- `returnAmount` (integer): Количество возврата [example 0]
- `deliveryService` (string): Услуги по доставке товара покупателю [example "0"]   <-- (old delivery_rub, mapping by description)
- `giBoxTypeName` (string): Тип коробов [example "Монопаллета"]
- `productDiscountForReport` (number): Итоговая согласованная скидка, % [example 0]
- `sellerPromo` (number): Промокод, % [example 0]
- `spp` (number): Платформенные скидки, % [example 25.31]
- `kvwBase` (number): Размер кВВ без НДС, % базовый [example 24.15]
- `kvw` (number): Итоговый кВВ без НДС, % [example 1.81]
- `supRatingUp` (number): Размер снижения кВВ из-за рейтинга, %
- `isKgvpV2` (number): Размер снижения кВВ из-за акции, %
- `ppvzSalesCommission` (string): Вознаграждение с продаж до вычета услуг поверенного, без НДС [example "23.74"]
- `forPay` (string): К перечислению продавцу за реализованный товар [example "376.99"]   <-- (old ppvz_for_pay)
- `ppvzReward` (string): Возмещение за выдачу и возврат товаров на ПВЗ [example "0"]
- `acquiringFee` (string): Компенсация платёжных услуг/комиссия за интеграцию платёжных сервисов [example "14.89"]
- `acquiringPercent` (number): Размер компенсации платёжных услуг/комиссии за интеграцию платёжных сервисов [example 4.06]
- `paymentProcessing` (string): Тип платежа: компенсация платёжных услуг/комиссия за интеграцию платёжных сервисов [example "Комиссия за организацию платежа с НДС"]
- `acquiringBank` (string): Наименование банка-эквайера [example "Вайлдберриз Банк"]
- `vw` (string): Вознаграждение Wildberries (ВВ), без НДС [example "22.25"]
- `vwNds` (string): НДС с вознаграждения Wildberries [example "4.45"]
- `ppvzOfficeName` (string): Наименование офиса доставки [example "Москва Москва Очаковское шоссе 6к2"]
- `ppvzOfficeId` (integer): ID офиса доставки [example 105383]
- `ppvzSupplierName` (string): Партнёр [example "ИП Жасмин"]
- `ppvzSupplierInn` (string): ИНН партнёра [example "010101010101"]
- `declarationNumber` (string): Номер таможенной декларации [example ""]
- `bonusTypeName` (string, NOT required): Виды доставок, штрафов и корректировок ВВ [example "Штраф МП. Невыполненный заказ (отмена клиентом после недовоза)"]
- `stickerId` (string): Стикер МП [example "1964038895"]
- `country` (string): Страна продажи [example "Россия"]
- `srvDbs` (boolean): Признак услуги платной доставки [example true]
- `penalty` (string): Общая сумма штрафов [example "231.35"]
- `additionalPayment` (string): Корректировка Вознаграждения Wildberries (ВВ) [example "0"]
- `rebillLogisticCost` (string): Возмещение издержек по перемещению и операционной обработке товара [example "1.349"]
- `rebillLogisticOrg` (string, NOT required): Организатор перевозки [example "ИП Иванов Иван Иванович(123456789012)"]
- `paidStorage` (string): Хранение [example "12647.29"]   <-- (old storage_fee)
- `deduction` (string): Удержания [example "6354"]
- `paidAcceptance` (string): Операции на приёмке [example "865"]   <-- (old acceptance)
- `orderId` (integer): ID сборочного задания [example 2816993144]
- `kiz` (string, NOT required): Код маркировки Честного знака
- `isB2b` (boolean): Признак B2B-продажи [example false]
- `trbxId` (string): ID короба для обработки товара [example "WB-TRBX-1234567"]
- `installmentCofinancingAmount` (string): Скидка по программе софинансирования [example "0"]
- `wibesDiscountPercent` (number): Скидка Wibes, % [example 1]
- `cashbackAmount` (string): Сумма баллов, удержанных по программе лояльности [example "2"]
- `cashbackDiscount` (string): Компенсация скидки по программе лояльности [example "19"]
- `cashbackCommissionChange` (string): Стоимость участия в программе лояльности [example "0.2"]
- `paymentSchedule` (string): Разовое изменение срока перечисления денежных средств [example "-1"]
- `deliveryMethod` (string): Способ продажи и тип товара [example "FBS, (МГТ)"]
- `sellerPromoId` (integer): ID собственной акции продавца с дополнительной скидкой [example 14350]
- `sellerPromoDiscount` (number): Размер дополнительной скидки по собственной акции продавца, % [example 3]
- `loyaltyId` (integer): ID скидки лояльности от продавца [example 0]
- `loyaltyDiscount` (number): Размер скидки лояльности от продавца, % [example 0]
- `uuidPromocode` (string): ID промокода [example ""]
- `salePricePromocodeDiscountPrc` (number): Скидка за промокод, % [example 0]
- `articleSubstitution` (string): ID подменного артикула [example ""]
- `salePriceAffiliatedDiscountPrc` (number): Скидка по подменному артикулу, % [example 0]
- `agencyVat` (number, NOT required): Удержание Агентского НДС, %. Только для продавцов из Кыргызстана [example 0]
- `salePriceWholesaleDiscountPrc` (number): Оптовая скидка для бизнеса, % [example 0]
- `b2bCustomerTin` (string): ИНН B2B-покупателя [example "010101010101"]
- `paidWithSocialCertificate` (boolean): Оплата социальным сертификатом [example false]
- `warehouseLogisticsCoeff` (number): Коэффициент доставки [example 0]
- `buyerTaxRegistrationReasonCode` (string): КПП B2B-покупателя [example "7701123301"]  (added 28.09.2026)
- `utdUcdNumber` (string): Номер УПД или УКД [example "12356856523"]  (added 28.09.2026)
- `utdUcdDate` (string, date): Дата УПД или УКД [example "2006-01-02"]  (added 28.09.2026)
- `orderUid` (string): ID корзины заказа — транзакции. Заказы в одной корзине покупателя будут иметь одинаковый `orderUid` [example "id375f16c4bec295d9995393af803ff7b"]
- `srid` (string): ID заказа. В ответах методов сборочных заданий FBS, DBW, DBS и Самовывоз `srid` равен `rid` [example "0f1c3999172603062979867564654dac5b702849"]

Not present in new API (vs old v5): `sa_name`→`vendorCode`, `ts_name`→`techSize`, `supplier_oper_name`→`sellerOperName`, `retail_price_withdisc_rub`→`retailPriceWithDisc`, `ppvz_for_pay`→`forPay`, `storage_fee`→`paidStorage`, `acceptance`→`paidAcceptance`, `rr_dt`→`rrDate`, `barcode`→`sku`. Release note: `suppliercontract_code` and `ppvz_supplier_id` were dropped without analogues; money fields changed number→string; `title` added.

Rows without product info (official seller help, updated 29.09.2026, https://seller.wildberries.ru/instructions/ru/ru/material/how-to-read-fimancial-reports-detalization): «Хранение» and «Удержания» (ВБ.Продвижение paid from balance, Джем, Конструктор тарифов minimum, one-off compensations) are not tied to an order — product columns (баркод, поставка, предмет...) are empty; `docTypeName` is empty for delivery/storage/deduction rows. Reason — in `bonusTypeName`.

### Error responses (application/problem+json)

- 204: Нет данных (empty body)
- 400: `{status, title, detail, requestId, origin}` e.g. title "GetReportDetailByPeriodNBAndNNB decode error", origin "open-api-finreports"
- 401: `{title, detail, code, requestId, origin, status, statusText, timestamp}`
- 402: `{title:"payment required", detail:"wb solution for business has insufficient funds..."}` — only for services from Каталог решений
- 403: `{status:403, title:"Forbidden", detail:"scope is not allowed for this resource", ...}`
- 429: `{title:"too many requests", detail:"limited by <uuid>", code, requestId, origin, status:429, statusText, timestamp}`; headers X-Ratelimit-Retry / X-Ratelimit-Limit / X-Ratelimit-Reset (see api-information).
