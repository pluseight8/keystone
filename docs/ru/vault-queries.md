# Запросы и представления Vault

`VaultQueryParser` поддерживает безопасный AST: `SELECT`, `FROM notes|tasks`,
`WHERE` (`AND`, `OR`, `NOT`, `CONTAINS`, `EXISTS` и сравнения), `SORT`,
`GROUP BY`, `LIMIT`. Planner ограничивает стоимость, результаты имеют
пагинацию, отмену и таймаут.

LIST/TABLE/BOARD используют обычные мутации Vault. Перемещение карточки Board
меняет свойство с проверкой revision. Сохранённые views — переносимые sidecar-
определения. QueryFunctionProvider и renderer-и — только декларации с hash;
произвольный код не исполняется.
