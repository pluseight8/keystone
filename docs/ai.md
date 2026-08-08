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
