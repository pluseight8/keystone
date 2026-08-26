# Safety Policy

`MandatorySafetyPolicy` is immutable from ordinary settings, AI, Skills, plugins, web content and remote Agents. It applies the minimum shared/public rules and distinguishes topic from context (for example historical/educational material may receive a warning while current targeted harm is restricted).

`UserSafetyPreferences` can only make filtering stricter. `SafetyPolicyController.applyPreferences` requires a fresh `OwnerRequestedSettingsIntent` with `source: OWNER`; a remote or inferred request is rejected. There is no "disable mandatory safety" switch.

Decisions are `ALLOW`, `ALLOW_WITH_WARNING`, `HIDE_BY_DEFAULT`, `BLOCK_FROM_SHARED`, `BLOCK_FROM_PUBLIC`, `BLOCK_FROM_DISCOVERY`, `QUARANTINE`, `NEEDS_LOCAL_REVIEW` and `CLASSIFICATION_FAILED`. `SAFE` is not a permission and never bypasses authorization, block, membership or encryption policy.
