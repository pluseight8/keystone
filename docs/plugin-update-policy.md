# Plugin update policy

Owners may select `NOTIFY_ONLY`, `DOWNLOAD_ONLY` or `AUTO_APPLY_SAFE_COMPATIBLE`, plus channel and source allowlists. Automatic application is fail-closed: it never grants a newly requested capability, follows a source's ranking, ignores revocation, or changes publisher/dependency authority. Offline requests become durable acquisition intents and resume when a permitted transport is available, still stopping for review.
