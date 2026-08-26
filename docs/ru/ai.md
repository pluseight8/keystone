# Персональный ИИ

Keystone полноценно работает без генеративного локального ИИ. Локальный ИИ
необязателен, но рекомендуется для расширенного поиска, сводок, планирования
и помощи. Детерминированные сценарии продукта, проверки политики и обычный
локальный поиск от модели не зависят.

Постоянное правило Keystone:

> Модели предлагают. Политика решает. Пользователь разрешает последствия.

Модель всегда является **недоверенным вычислением**. Совместимость не означает
ни разрешение, ни доверие к поставщику.

## Провайдеры моделей

Владелец может выбрать встроенную локальную среду, llama.cpp, Ollama, LM
Studio, локальный OpenAI-compatible endpoint или другую совместимую локальную
модель/дообучение. Host владеет файлами модели, памятью, ускорением,
загрузкой и выгрузкой; Core владеет идентификатором запроса, лимитами,
отменой и policy. Remote/external providers — только явные adapters, а не
тихая замена приватному Local AI.

Ответ модели проверяется по схеме, ограничивается и считается proposal.
Неверные nodes, fields, actions или tool calls отклоняются. Модель не может
создать полномочие, назвав tool, выдумав object ID или заявив, что владелец
уже подтвердил действие.

## Context и Memory

Context resolver начинает с явно выбранного object, tab, workspace, task или
фрагмента. Он проверяет permission, удаление, visibility и data class и
возвращает ограниченные citations. «Не найдено» и «недоступно» — корректные
результаты.

Personal Memory — управляемый владельцем источник с provenance и правилами
хранения. Mail, Contacts, Documents, Capture, Tasks и feeds не являются
автоматическим контейнером Memory. Ingestion и consolidation выполняются по
явной политике и могут быть проверены локально.

RAG индексирует локальные objects и производный text в ограниченном индексе.
Retrieved text — context, а не authority. Note, filename, webpage, email,
message, OCR result, feed item или task могут содержать prompt injection, но
не могут расширить tools, permissions или native capabilities модели.

## Что может Local AI

Local AI может отвечать, суммировать, классифицировать или предлагать правки в
выбранном scope. Он может предложить Task, время в Calendar, заметку Vault,
destination Capture, аннотацию Document или действие Browser, но каждая запись
и внешнее последствие проходят через сервис-владелец и подтверждение.

Local AI не делает автоматически:

- не отправляет Mail или Messages, не совершает Calls, не публикует, не делится
  и не приглашает;
- не меняет связи Contact/Identity, permissions, доверие устройств или
  security policy;
- не читает весь Vault, Memory, Contacts, Mail, Tasks, Documents, Capture,
  Location или private Files из-за выбора одного объекта;
- не исполняет remote content, команды и unsafe URL и не устанавливает
  Plugin/Skill;
- не выводит местоположение, отношения, Identity или согласие человека.

## External AI и egress

External AI — недоверенный выход данных. Он не заменяет Local AI без ведома
владельца, если используется приватный контекст. Vault, Memory, Contacts,
Mail, Tasks, Documents, Capture, Location, private Files, credentials и
browser-session material не отправляются неявно.

Явный внешний запрос проходит через `AIEgressFirewall`, который проверяет data
class, выбранные поля, destination, purpose и confirmation policy. За пределы
локальной границы может уйти только безопасный public или намеренно переданный
владельцем материал. Ответ provider остаётся недоверенным и не может одобрить
собственное действие.

## Полномочия настроек

Поведение ИИ зависит от класса настройки:

| Класс | Поведение ИИ |
| --- | --- |
| `USER_PREFERENCE` | Может следовать ясному прямому запросу владельца. |
| `PRIVACY_SETTING` | Показывает preview и требует подтверждения при изменении раскрытия. |
| `SECURITY_SETTING` | Требует усиленного или двойного подтверждения. |
| `IMMUTABLE_POLICY` | Никогда не изменяется ИИ, plugin или remote content. |

Страницы Web, Mail, Messages, Documents, OCR, feeds и Capture не могут менять
настройки владельца. Действие Settings или policy проходит typed interface и
проверяется непосредственно перед выполнением.

## Agents, Tools и Automation

Agent имеет Identity, session, state, context и capabilities; это не оболочка
для неограниченной модели. Workers, visits, rooms и delegation получают только
явные scope. Tool request проходит ToolPolicy, проверку capability и лимитов,
а также нужное подтверждение.

Chronos планирует ограниченный одобренный эффект и записывает результат.
Reminder не является разрешением выполнить Task. Действия Browser, Files,
publication, Mail, sharing и device placement остаются отдельными typed
actions.

## Границы продукта

- [Capture](capture.md) предлагает destination; captured text, URL, files и
  references не становятся AI context автоматически.
- [Documents](documents.md), [Photos](photos.md), [Web Library](web-library.md),
  [Mail](mail.md), [Subscriptions](subscriptions.md) и [Contacts](contacts.md)
  отдают только выбранные ограниченные projections.
- [Plugins](plugins.md) и [Безопасность](security.md) определяют execution и
  egress boundaries; provider или Skill не могут их расширить.
- [Memory](memory.md), [Agents](agents.md) и [AI privacy](ai-privacy.md)
  описывают durable context, sessions и классы внешних данных.
