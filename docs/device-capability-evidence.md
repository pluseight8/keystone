# Device capability evidence

Capability reports preserve provenance:

| Layer | Meaning |
| --- | --- |
| `DECLARED` | The feature is part of the typed contract. |
| `IMPLEMENTED` | A production adapter exists. |
| `RUNTIME_DETECTED` | The host exposed a matching facility. |
| `PHYSICALLY_VERIFIED` | A bounded real operation passed. |
| `BLOCKED_BY_ENVIRONMENT` | The operation could not safely run here. |

The report is local diagnostics, not a public device fingerprint. It must not
contain stable hardware IDs, exact interface addresses, radio names, route
participants or Keystone social data.
