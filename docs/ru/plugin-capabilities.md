# Capability плагина

Запросы манифеста не являются grants. Каждая операция проходит проверку scoped/revocable grant; `ALL`, `ADMIN` и `FULL_ACCESS` отсутствуют.

## Граница Files

Plugin не получает ambient filesystem path или authority shared folder. Он
может работать только через отдельно выданную owner-scoped projection или
результат picker. Folder membership, epochs, revision writes, upload-only
Drop-Zone policy, content authorization, device placement и filesystem binding
остаются решениями Core/NativeHost. Hash content, webpage, enclosure или
plugin manifest не дают доступ, не запускают scan/file, не extract-ят archive,
не передают данные в AI/memory, не публикуют content и не создают Drop Zone.

## Граница Contacts

Plugin не получает ambient Contacts capability и не может перечислять личную
address book. Нужна отдельная owner-approved bounded projection или выбор card
fields; private notes, невыбранные fields, Identity keys и source authority
остаются в Core. Contact group не является plugin permission, folder
authorization или Space membership. Plugin request не может auto-create,
auto-merge, link или trust Contact, вызвать geocoding, вывести relationship или
передать Contact data external AI.
