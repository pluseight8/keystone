# Mobile host (Expo)

Expo Router host с Keychain/Keystore storage, native BrowserEngine и deep-link
приглашениями узлов. Expo Router использует file-based routes и native tab
navigation; команда запускается через development build, потому что GeckoView
и WKWebView modules требуют native code.

UI-анимации используют `useNativeDriver` в `src/motion.ts`, не создают JS
frame loop и отключаются/упрощаются при `prefers-reduced-motion`.

```bash
pnpm --filter @keystone/mobile install
pnpm --filter @keystone/mobile start
npx expo prebuild
```

## Тихие OTA-патчи

`expo-updates` настроен на production-канал. Замените `YOUR_EXPO_PROJECT_ID` в
`app.json` на ID проекта Expo или выполните `pnpm exec eas update:configure`.
Release/preview-сборки проверяют EAS при старте, скачивают совместимый JS-патч
в фоне и применяют его при следующем запуске; нативный runtime не меняется.

Публикация срочного патча:

```bash
pnpm --dir apps/mobile update:production
```

Нативные изменения требуют новой EAS Build и увеличения `version`/runtime.
