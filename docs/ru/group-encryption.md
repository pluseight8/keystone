# Приватные Communities и групповое шифрование

Реализация private Communities добавляет зашифрованный путь для видимости
`private` и `contacts`. Существующий публичный путь и Hyperswarm/Noise
transport не переписываются. Публичная репликация по-прежнему отклоняет
непубличные Communities, если явно не используется этот private protocol.

## Граница протокола

Payload приватного Community шифруется libsodium XChaCha20-Poly1305-IETF AEAD. Дополнительные аутентифицированные данные включают имя протокола, ID Community, epoch и key ID. Ключ epoch для каждого устройства доставляется через libsodium `crypto_box` с уже существующими encryption keys устройства Identity. Объекты Community, membership events и transport envelopes сохраняют подписи Ed25519 и canonical JSON validation.

Это явный Keystone group-key protocol. Он не является MLS, Double Ratchet и не заявляет forward secrecy. В одной epoch действует один симметричный ключ; владелец создаёт новый случайный ключ при каждом join, leave, kick, ban, unban и отзыве устройства. После установки новой epoch старый ключ удаляется из durable state. Скомпрометированный активный участник всё ещё может читать данные, отправленные в период его авторизации.

## Epoch и membership

- Epoch начинается с 1 и увеличивается ровно на один шаг при каждом изменении состава или устройства.
- Key update подписан владельцем, содержит предыдущую epoch, полный набор активных устройств и зашифрованный ключ для конкретного получателя.
- Получатель отклоняет пропуски, replay, старые epoch, неизвестных actors, замену device encryption key и неверные подписи.
- Новый участник получает только текущую epoch (`historyPolicy: current-only`); старая история не включается в bootstrap.
- Удалённое или отозванное устройство не получает новый ключ и не может читать следующие epoch. Уже расшифрованные ранее данные могут у него остаться.
- Leave, инициированный самим участником, — это подписанный leave event, доставленный напрямую владельцу; устройство локально отзывает своё private state, а владелец создаёт новую epoch.
- Устройства представлены существующими криптографическими `NodeId`; несколько устройств одного пользователя участвуют независимо и получают собственные wrapped keys.

Invite и join request зашифрованы непосредственно для указанного устройства и содержат только минимальный bootstrap (подписанные Community/invite/configuration objects). Они не попадают в public discovery. Private Communities исключаются существующими фильтрами discovery, search и RAG.

## Сообщения и вложения

Community events — подписанные Keystone objects внутри AEAD payload. Outer envelope дополнительно проверяется обычным transport security, а relay видит только ciphertext, epoch/key metadata и неизбежные сетевые метаданные. Повторный nonce сохраняется и отклоняется после restart.

Вложения шифруются до создания `ContentManifest`. Поэтому content-addressed ID и chunk hashes относятся к ciphertext, а не к plaintext. Ссылка `encryptedContent` хранит epoch/key ID и nonce для авторизованного устройства; изменение данных или несовпадение ciphertext hash приводит к отказу.

Private state хранится через host `EncryptedSocialStateStore` и дополнительно шифруется ключом, производным от локального device encryption key. При потере ключевого материала состояние намеренно становится нечитаемым; plaintext fallback и центральное восстановление отсутствуют.

## Ограничения и приватность

Протокол даёт аутентифицированные изменения membership и конфиденциальность текущей epoch, но не центральный registry, cloud backup или analytics service. Обычные routing metadata всё ещё видны сетевым peer. Metadata private Community не отправляется через public Community replication или public discovery. Contacts-only использует тот же encrypted path; публичные Communities сохраняют существующее поведение подписанных открытых объектов без лишних затрат на шифрование.
