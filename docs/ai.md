<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# AI providers and command processing

`AICommandProcessor` separates intent routing from execution. `AIModelAdapter`
supports three user-selected provider classes: `local` (OpenAI-compatible local
runtime), `oauth` (short-lived access-token callback) and `api` (user API key).
Secrets are supplied at call time and must live in the OS keychain, never in the
prompt or repository.

The model can call only `create_node_action`. Its output is schema-checked
against the trusted-node registry and each node's field allowlist. Invalid or
invented nodes fail closed. The resulting canonical action receives a BLAKE2b
hash and always has `requiresConfirmation: true`.

Example:

```ts
const model = new OpenAICompatibleAdapter({
  kind: 'local',
  endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'user-selected-model'
});
const processor = new AICommandProcessor(model, new SodiumCryptoProvider());
```

## Local RAG

`RAGManager` indexes Life Map nodes, notes, and Context Capsules from a
`PersonalEcosystemDocument` or `Y.Doc`. The default
`TransformersEmbeddingProvider` downloads its quantized model once and performs
later inference locally; `OllamaEmbeddingProvider` can instead use a local
Ollama process. Documents and vectors live in an in-memory Orama database and
are never uploaded by the RAG layer.

```ts
const rag = new RAGManager();
const detach = rag.attach(yDoc); // also indexes nested remote Yjs updates
const context = await rag.search('documents related to the garden project');
// Call detach() when the document is no longer active.
```

If model initialization fails, the manager uses a deterministic local hash
embedding so offline startup remains functional. Security-sensitive hosts can
set `fallbackToHash: false` and surface the model error instead. Private
credential-like fields are excluded from indexed text and result metadata.
