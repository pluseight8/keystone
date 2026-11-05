# Linux secure storage

Production adapter использует Secret Service (`secret-tool`) при доступном
пользовательском backend. Handles остаются opaque и `exportable=false`;
revoke удаляет keyring item. При недоступном Secret Service нет слабого
локального fallback. Hardware-backed enclave не предполагается.

## Ключи Desktop

Tauri-хост Desktop хранит seed-ключи устройств в том же Secret Service через
`secret-tool` (`service=keystone-desktop-identity`, по одному элементу на
устройство). Seed передаётся только через stdin — не в аргументах и не в логах.

- Новая identity на Linux не создаётся, если Secret Service не прошёл проверку
  записи и чтения: тихого запасного варианта с файлом нет.
- Seed из старого файла `identity-keys.json` (права `0600`) переносится при
  первом обращении. Из файла он удаляется только после того, как Secret Service
  вернул идентичное значение, поэтому прерванный перенос продолжается при
  следующем обращении. Если копии различаются, обе сохраняются, а операция
  завершается ошибкой без выбора одной из них.
- Пока Secret Service недоступен, уже существующий seed из файла остаётся
  рабочим, чтобы владелец не потерял доступ к своей identity.
- macOS и Windows пока используют файл с правами `0600`, пока не подключены
  Keychain и Credential Manager; его может прочитать любой процесс того же
  пользователя.
