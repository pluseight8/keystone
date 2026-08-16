# Модель сбоев

Harness моделирует offline, partition, queued/reordered/duplicate envelopes,
invalid signatures, malformed bodies, interrupted/corrupt content provider и
restart поверх atomic test file store. Validation и persistence не mock’аются.

Пока не проверены real process crash во время OS write, NAT/relay, WebRTC media,
device revocation между реальными hosts и persistent encrypted content cache.

Репликация contacts-only communities намеренно вне этой модели: production
route отклоняет её, пока не появится group-encryption protocol.
