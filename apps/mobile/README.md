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
