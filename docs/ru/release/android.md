# Релиз Android

Конфигурация использует `org.keystone.app`, `minSdk 24`, `compileSdk 35` и
`targetSdk 34`. Preflight проверяет конфигурацию, но не выдаёт APK, device,
permission или WebRTC test за пройденный без реального запуска.

`KEYSTONE_EXPO_PROJECT_ID` необязателен: он включает только EAS OTA, а локальная
разработка не требует аккаунта Expo. Для store/APK/AAB владелец должен хранить
keystore, alias и пароли только вне репозитория/в CI secrets. После debug build
нужно физически проверить install/launch, `keystone://voice`, camera/mic,
notifications, background, WebRTC и отсутствие нежелательного cleartext.
