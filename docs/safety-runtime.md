# Safety Runtime

`SafetyRuntime` runs the bounded cascade:

1. `DomainPolicy` and authorization;
2. current `SafetyCache` entry;
3. deterministic `SafetyRuleEngine`;
4. known cryptographic/perceptual fingerprint;
5. small classifier adapters;
6. targeted metadata/keyframe/audio sampling;
7. optional local `SAFETY_REVIEW` through the shared resource scheduler.

It never sends private context to an external provider and never grants capabilities. Classifiers have bounded input and no tools or network authority. Video analysis is sampled, not an unbounded frame-by-frame scan. Cache keys include content hash, mandatory policy version and classifier version.

`SafetySurfaceIndex` is the protected adapter for display/search/discovery indexes. `SafetyCache`, `SafetyAuditLog`, `BehaviorSafetyService` and `InteractionSafetyPolicy` are local and bounded. Metrics contain counts and durations only; no telemetry or plaintext content is required.

Lifecycle states are `UNSCANNED`, `SCANNING`, `SAFE`, `RESTRICTED`, `BLOCKED`, `QUARANTINED` and `CLASSIFICATION_FAILED`. A UI should render a placeholder until a surface-eligible token exists, preventing a flash of unsafe media.
