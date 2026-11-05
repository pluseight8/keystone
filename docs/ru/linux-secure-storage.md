# Linux secure storage

Production adapter использует Secret Service (`secret-tool`) при доступном
пользовательском backend. Handles остаются opaque и `exportable=false`;
revoke удаляет keyring item. При недоступном Secret Service нет слабого
локального fallback. Hardware-backed enclave не предполагается.

## Известный пробел: ключи Desktop

Правило выше относится к адаптеру `native-host`. Tauri-хост Desktop его пока не
использует: команды `desktop_identity_*` хранят seed-ключи устройства в
`identity-keys.json` в каталоге данных приложения, защищённом только правами
файла `0600` (файл сразу создаётся с этими правами и сбрасывается на диск перед
атомарной заменой). Любой процесс того же пользователя может их прочитать.
Перенос в Secret Service — открытая задача безопасности, а не текущее поведение.
