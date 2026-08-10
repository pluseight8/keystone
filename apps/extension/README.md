# Keystone Companion

Manifest V3 companion. `pnpm build` produces the Chromium build. To package Firefox, replace `dist/manifest.json` with `manifest.firefox.json` after the build.

The loopback host accepts only WebSocket subprotocol `keystone-companion-v1`, must validate Origin/size (recommended 2 MiB), and maps `rag.upsert.document` directly to `RAGManager.upsert`. Bind to `127.0.0.1`, never `0.0.0.0`; production builds should pair a random extension token before accepting content.
