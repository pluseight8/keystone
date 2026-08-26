# Plugin ContextProvider

A ContextProvider contributes bounded typed `ContextObject` values, each carrying source, privacy class, scope, expiry, trust and provenance. It receives only explicitly granted scopes; there is no `getAllContext()` or ambient Memory access.

Plugin context is untrusted content. Prompt-injection text cannot alter system policy/capabilities. Private/secret objects are filtered before provider access and external AI never receives raw Keystone context.
