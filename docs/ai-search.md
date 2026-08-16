# AI search and sources

The mobile AI context screen exposes one query field, a scope selector and expandable sources. Each source opens the original Keystone object; the UI does not render a copied media object. A privacy badge states that processing was local/trusted, or that external use was blocked.

Supported scopes are `ALL PRIVATE DATA`, `CURRENT SPACE`, `CURRENT CHAT`, `COMMUNITIES`, `FILES` and `PUBLIC ONLY`. Search is local and bounded. It can combine a DM with a referenced File and Shared Space task, connect a Track to Shorts, or connect a Profile to Live. Blocked identities, deleted objects, revoked membership and private spaces outside the current Identity are removed before the model sees anything.

Sources are provenance, not model-generated claims. A citation is accepted only when its object ID and metadata exactly match the resolver result. Source payloads are reduced to bounded summaries; raw Keystone payloads, chat history and private media are never sent to an external provider. Missing evidence is reported as not found.
