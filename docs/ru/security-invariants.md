
## Инварианты

Discovery не устанавливает; полученный P2P/local package не исполняется; source trust не выдаёт permission; другая hash при той же версии — отде��ьная revision; partial/corrupt transfer не исполняется; permission expansion требует review; revoked revision нельзя восстановить; repair проверяет exact integrity и текущую policy; offline не требует central service.

## Безопасность звонков

Call signalling — это подписанные application-данные, а не замена media
security boundary. `CallService` до изменения состояния проверяет границы
versioned envelope, expiry, sequence, привязку call/session/peer и
replay/deduplication. Device claim scoped и revocable, поэтому второй endpoint
не может незаметно перехватить активную сессию. Приглашение не выдаёт права на
microphone, camera или screen: каждый capture-запрос проходит owner-controlled
host permission boundary непосредственно перед действием.

При наличии native WebRTC media создаётся только через `RTCPeerConnection` и
его DTLS-SRTP. Keystone не называет DTLS-SRTP application-level E2E и не
подменяет production media controlled runtime. SDP/ICE имеют ограничения
размера и количества; malformed/stale signals отклоняются. Запись,
транскрибация, AI, plugin и browser capabilities не включаются неявно.
