# Совместная работа и shared editing

Collaboration предоставляет в Keystone first-class local-first shared editing. Используется
существующая Yjs/CRDT-основа и существующие правила объектов; второй CRDT и
отдельный collaboration transport stack не вводятся.

Реализация находится в `packages/core/src/collaboration.ts`. Сервис получает
только `KeystoneDeliveryInterface`: выбор Hyperswarm, relay, local route или
provider остаётся у `ConnectivityFabric` через `FabricTransport`. Raw
transport не импортируется в `CollaborationService`.

## Shared objects и адаптеры

`SharedObjectAdapter<TSnapshot, TEdit>` типизировано связывает CRDT с текущими
правилами домена:

| Объект | Что делает адаптер |
| --- | --- |
| `document` / `note` | Y.Text для текста и Y.Map для metadata с bounded edits |
| `canvas` | state-vector deltas поверх Yjs с повторным использованием `CanvasDocument` и `CanvasMutation` validation |
| `workboard` | canonical `Workboard`/`WorkItem` projection с hook для правил `AgentWorkboardService` |

Remote CRDT update не запускает Agent, ToolFlow, plugin, model, browser action
или task graph. `shared-vault` и `calendar` совместимы с тем же adapter
contract, но требуют явной интеграции существующего сервиса.

## Durable state и presence

Durable content/comments сначала применяется локально, затем сохраняется и
попадает в bounded per-peer retry queue. После reconnect или через bounded
retry timer очередь доставляется автоматически. State-vector sync закрывает
пропуски после offline работы и restart; operation ID защищает от повторного
применения.

Presence отделён от durable state: он best-effort, coalesced, bounded и
истекает по TTL. Он не сохраняется, не попадает в Y.Doc, durable CRDT или DTN
custody и не является authority/history. Разрешены только active/idle/editing,
cursor и ограниченный selection. Location/GPS/latitude/longitude/address/route
поля запрещены.

## Роли, приглашения и epoch

| Роль | Read | Durable edit | Comment | Manage members |
| --- | --- | --- | --- | --- |
| owner | да | да | да | да |
| editor | да | да | да | нет |
| commenter | да | нет | да | нет |
| viewer | да | нет | нет | нет |

Приглашение адресуется существующей Keystone identity, содержит роль и expiry.
Invitee принимает его, после чего owner активирует участника. Состояния
`pending`, `accepted`, `expired`, `revoked` сохраняются. Изменение роли или
revoke увеличивает authorization epoch; stale и unauthorized updates
отбрасываются. Комментарии — bounded plain text, не markup и не инструкции.

Private collaboration требует application E2E cipher. Sodium adapter
использует существующий `SodiumDirectMessageCipher`; до попадания в
`FabricTransport` wire body уже имеет `protected` boundary. Relay/provider не
может расшифровать content или выдать authorization.

Вложения не помещаются в CRDT. Shared object хранит только проверенные
 content-addressed IDs/manifest references; байты и их quota/integrity/
quarantine правила остаются в существующем content layer.

Desktop и mobile используют typed host adapter. Если bootstrap не установил
`CollaborationService`, UI показывает boundary state и не создаёт выдуманный
shared state.

Проверка выполняется на **Omarchy (Arch Linux-based distribution)**, Node
`v22.23.2`, pnpm `9.15.0`, engine `>=22 <23`. Omarchy — только текущая
development/validation distro, а не обязательная dependency Keystone.

Контролируемые тесты покрывают роли, expiry/revoke/epoch, forged и oversized
updates, replay, safe comments, presence TTL, restart и Canvas/Workboard
adapters. Real-network proof использует два независимых процесса и путь
`HyperswarmTransportProvider` → `ConnectivityFabric` → `FabricTransport`,
проверяя invite/accept, concurrent offline edits, auto-retry без ручного
flush, convergence, private wire opacity, non-persistent presence и restart.

не расширяет текущую границу продукта и не создаёт отдельный release scope.
