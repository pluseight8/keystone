# Дополнения

Дополнения — необязательные недоверенные расширения для явно поддержанных
поверхностей Keystone. Они не входят в Core, не наследуют полномочия владельца
и не превращают provider в сервис Keystone. Core, NativeHost и security policy
остаются главными.

## Граница между Plugin, Skill и Core

Core владеет основными продуктами, Identity, authorization, Files, Tasks,
Contacts, Calendar, Messages, Сетью Keystone и исходными данными. Дополнение
подходит для узкого provider integration, Tool, renderer и другой extension
point. Skill — версионируемая декларативная процедура; это не executable
plugin, и она не может регистрировать Tool или запускать code.

CalDAV, CardDAV, внешние bridges контактов и календаря и подобная
интероперабельность относятся к provider/plugin boundary, если не являются
необходимой частью Core-модели. Это не переносит основные продукты в
дополнения.

## Модель capabilities

Manifest объявляет желаемый доступ, но объявление не является grant. Каждая
операция проверяется по revision, scope, явному одобрению владельца и
возможности отзыва. `ALL`, `ADMIN` и `FULL_ACCESS` отсутствуют.

Примеры capabilities:

- schema-constrained запрос к AI через host model path;
- отфильтрованная host projection выбранных данных Life Map или продукта;
- один ограниченный P2P-запрос;
- provider registration для заявленной extension point.

Перед чувствительной операцией пользователь видит данные, последствие, scope
и срок. Plugin не может использовать Contact, content hash, path, webpage,
feed enclosure или captured item как permission. Без отдельного решения
владельца он не перечисляет private Contacts, Files, Vault, Memory, Mail,
Location или Capture.

Технические capability IDs находятся в [Plugin API](plugin-api.md) и
[справочнике capabilities](plugin-capabilities.md), а не в обычном product
copy.

## Runtime и NativeHost boundary

Plugin запускается вне основного React, Expo или Tauri renderer. Production host
должен дать изолированный runtime, запретить Node/process/shell/socket-доступ,
проверить безопасный entrypoint и integrity/signature пакета и ограничить CPU,
memory, storage, output и время. Host handlers получают copied validated data,
а не raw Core objects, CRDT, native handles, credentials или unrestricted
`fetch`.

NativeHost владеет platform isolation и permission prompts. Core всё равно
проверяет principal, capability, operation, scope, revision и expiry. Crash,
timeout, malformed response или отсутствие host adapter останавливают операцию
и не перезапускают и не ослабляют Core.

## Распространение и lifecycle

Получение package не делает source metadata доверенным. Полученные bytes
остаются в quarantine, пока host не проверит manifest, entrypoint, size,
integrity, signature/provenance, compatibility и dependencies. Перед install
нужен review; install и enable — разные действия.

Update проходит staging. Новое или более широкое permission не появляется
молча; rollback использует проверенную предыдущую revision. Disable, quarantine,
uninstall и revoke удаляют активные registrations; executable provider должен
зарегистрироваться заново после restart. Unknown package остаётся opaque и не
исполняется.

См. [Plugin security model](plugin-security-model.md), [Plugin distribution](plugin-distribution.md),
[Plugin sandbox](plugin-sandbox.md), [Plugin providers](plugin-providers.md),
[Пакеты Skills](skill-packages.md) и [Безопасность](security.md).

## Provider integrations

Provider output недоверен, ограничен и имеет источник. Он не может напрямую
записать canonical object, изменить authorization source, опубликовать без
policy или отправить private data внешней модели. External media provider остаётся
помеченным внешним source и не копируется автоматически в CDN или private
library Keystone.

Plugin может запросить узкую projection или выбранный владельцем picker result.
Он не получает Identity keys, recovery material, provider credentials,
filesystem paths, raw transport topology, точное Location или browser-session
secrets. Само наличие Plugin не превращает nearby endpoint в Contact или
provider в social authority.
