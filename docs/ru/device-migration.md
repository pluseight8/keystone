# Перенос на новое устройство

Перенос устройства — явный локальный сценарий:

`Старая установка → зашифрованный Keystone backup → новая установка → revoke старого устройства`

Новая установка запускается с пустым durable profile. Она импортирует backup через RecoverySecretBoundary, проверяет authenticated manifest/payload, staging-ит stores и делает commit. Восстановленный master seed передаётся существующему IdentityManager — новая пользовательская Identity не создаётся.

Переносятся profile/security identity, trusted-device records согласно policy host, settings, social graph, direct/group conversations, Communities, зашифрованные records private Community, media metadata, library/playlists, локальные notifications/read state и pinned/user-owned content references. Временный cache и partial chunks обычно не включаются: их можно получить заново от P2P providers.

После первого успешного подключения владелец подписывает revoke старой установки. Отозванное устройство не может отправлять privileged events; peers продолжают проверять signatures и device authorization существующего Devices service.

Recovery path не кладёт private keys в inspection manifest, не загружает backup на сервер и не публикует settings/read state. Recovery secret обрабатывается только host UI/keychain boundary и не сериализуется в backup.

Production network suite проверяет этот поток независимыми процессами Alice/Bob: старый Alice process останавливается, его durable directory убирается из рабочего места, новый Alice process восстанавливается из encrypted bytes, отправляет Bob новое signed message под той же Identity, восстанавливает private-Community epoch/settings и отклоняет privileged event от revoked device.
