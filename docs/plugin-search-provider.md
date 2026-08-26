# Plugin SearchProvider

Search providers receive a bounded query/scope/page and return attributable results with stable object references. Provider relevance is only a hint; Core performs final privacy, permission, SafetySurfaceGate, external-link and ranking checks. A provider cannot force position or write a protected index.

Fan-out is parallel but bounded, cancellable and timeout-isolated. Disabled or failed providers return typed health and do not break native Keystone results.
