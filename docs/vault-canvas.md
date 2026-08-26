# Vault Canvas

Canvas is a structured first-class Vault entity stored as versioned JSON through `CanvasStorageAdapter`. It contains a stable ID, Vault ID, revision, timestamps, viewport, selection, metadata, typed nodes and typed edges. It is not a screenshot and does not copy note or file contents.

Supported cards are `NOTE_CARD`, `TEXT_CARD`, `FILE_CARD`, `IMAGE_CARD`, `WEB_CARD`, `GROUP` and `KEYSTONE_OBJECT_CARD`. Note/file/object cards contain references; rendering resolves the source through existing permission boundaries. `Convert to Note` is explicit for standalone Text Cards.

Typed mutations cover create, move, resize, update, duplicate, delete, copy/paste, connect/disconnect, group/ungroup, selection and viewport changes. Revisions use base-revision conflict checks. Undo/redo and bounded saved history are separate from the linked Markdown files. Malformed Canvas JSON is isolated and cannot damage notes or attachments.

Desktop is the primary authoring surface. Mobile exposes bounded viewing, pan/zoom and card navigation. Future shared Vault/CRDT work can map the deterministic mutation model without introducing another sync protocol. Plugins receive declaration-only extension points; no plugin code executes implicitly.
