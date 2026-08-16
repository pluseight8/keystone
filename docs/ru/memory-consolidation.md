# Консолидация памяти

Консолидация — локальная операция, превращающая недавние observations в долговременную память:

`recent events → candidate memories → проверка provenance/privacy → deduplication и конфликты → устойчивые записи`

## Граница модели

`MemoryModelGateway` объявляет execution: `local`, `personal_trusted` или `external`. `MemoryService.consolidate()` принимает только первые два. Внешний gateway отклоняется до вызова `propose()`, поэтому внешний AI не получает private observations и не записывает private memory. Автоматического fallback во внешний AI нет.

Ответ модели считается недоверенным: проверяются kind, assertion, source-ссылки, IDs, timestamp и ограничения размера. Источники candidate должны быть подмножеством переданных observations. Поля `explicit`/`pinned` из ответа модели игнорируются. Privacy-класс результата — самый строгий из его sources и объявления candidate.

Prompt injection в сообщении, файле или объекте сообщества остаётся обычным текстом observation. Он не выдаёт capabilities, не меняет provenance, не делает запись explicit и не превращает private данные в public.

## Deduplication и конфликты

Стабильный fingerprint строится по kind, assertion, нормализованным subject/predicate, summary и value. Эквивалентные candidates объединяют источники и уверенность. Разные значения при одинаковых subject/predicate сохраняются как конфликт; более сильная запись получает `supersedes`/`supersededBy`, обе provenance-цепочки остаются доступными.

## Chronos

`LocalMemoryConsolidationRunner` — bounded-адаптер для существующего Chronos. Он получает observations из host source, выполняет одну локальную консолидацию и возвращает metadata-only результат. Расписание, pause/disable и audit остаются у Chronos; обязательной nightly/cloud-задачи нет. При отключённой automatic memory модель не вызывается.

Если host объединяет несколько Chronos workflow handlers, можно использовать `createMemoryChronosWorkflow()` и типизированный prefix `memoryConsolidationInstruction()`. Адаптер обрабатывает только собственную инструкцию и не меняет остальные Chronos actions.

## Удаление и восстановление

Забывание source обновляет все связанные записи через `MemoryForgetPolicy`, не оставляя устаревшие provenance-ссылки. В snapshot попадают только memory records и настройки; embeddings восстанавливаются локально после restart.
