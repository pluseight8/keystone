# Content Safety

Keystone treats safety as a protocol boundary, not a visual filter. A value moves through `RawIncomingObject → VerifiedObject → AuthorizedObject → SafetyEvaluatedObject → SurfaceEligibleObject`. Feed, search, discovery, recommendations, shared AI context and shared rendering accept only a `SurfaceEligibleObject` carrying a current `SafetyDecisionToken`.

Content domains are `PERSONAL_LOCAL`, `PRIVATE_SELF`, `DIRECT_SHARED`, `GROUP_SHARED`, `SHARED_SPACE`, `COMMUNITY`, `PUBLIC` and `DISCOVERY`. Personal data is preserved. A share attempt can be blocked without deleting the owner's note, file, media or memory.

The recipient evaluates content locally. A sender `SafetyAttestation` is an optimization hint and never authority. Changing bytes, object ID, policy version or classifier version invalidates a token. Unknown, malformed, over-budget or unavailable classifications fail closed into quarantine/review.

The runtime works without generative local AI: domain policy, bounded Unicode-aware rules, fingerprints, lightweight adapters, targeted media sampling, cache and behavior protection remain active. An arbitrary compatible local model may be connected only as a bounded `SAFETY_REVIEW` escalation; model output is still subject to Keystone policy.

Every shared surface must call the safety preflight before display, indexing, preview, prefetch or publication. Personal browsing and personal copies remain available locally; `Share to Chat/Space/Community/Public` invokes the same preflight.
