# Релиз iOS (experimental/deferred)

Есть Expo/native prebuild route, но iOS ещё не release-ready. Linux не может
собрать iOS simulator; macOS CI может только собрать unsigned simulator и это
не заменяет device/signing test.

Нужны Apple Developer account, Team ID, certificates, provisioning, App Store
Connect, macOS/Xcode и физические проверки keychain, permissions, background,
WebRTC, deep links и lifecycle. Не придумывайте эти значения и не называйте
iOS supported до прохождения проверок.
