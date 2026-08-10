# @keystone/ui

Общие accessible React primitives: Button, Dialog (double confirmation), NodeCard, ChatComposer и фиксированные Signature Design Language tokens. Components use native semantics, touch targets >=44px, keyboard focus on web and instant utility motion.

## Life Map

`LifeMapCanvas` is the shared React Native/Web canvas for goals, projects, people, decisions and files. It supports dragging, multi-select, edge creation, long-press context actions and the `AIInsightsPanel`. Pass either `data`/`onChange` or the `lifeMap` Y.Map exposed by `createPersonalEcosystemDocument`:

```tsx
const ecosystem = createPersonalEcosystemDocument(doc);
<LifeMapCanvas crdt={ecosystem} onPack={setCapsule} />
```

The storage contract is `LIFE_MAP_SCHEMA` (`keystone.life-map.v1`):

- `lifeMap`: Y.Map containing nested `nodes: Y.Map<LifeMapNode>` and `edges: Y.Map<LifeMapEdge>` (legacy array values are read/written for migration);
- `notes`: Y.Map of note records, linked by `nodeId`;
- `contextCapsules`: Y.Map of `CapsuleManifest` records;
- `aiChat`: Y.Array of local-model interaction records.

`createCapsuleManifest` includes only selected public nodes, fully internal edges and public notes. It recursively removes private/credential-like keys and omits `metadata`; `CapsuleShareDialog` exposes the resulting `keystone://capsule?id=...` payload and a real QR visual (`react-native-qrcode-svg`); native hosts can use `onCopyLink` for their clipboard adapter.
