# Skill security

Skills are untrusted instruction sources relative to Keystone system policy. System policy, Identity, AIEgressFirewall, ToolPolicy, and confirmation boundaries always win.

`SkillEvaluator` performs bounded static checks before install or revision acceptance:

- schema, size, required tool and capability availability when the host provides that information;
- malformed/infinite-loop hints and executable payload extensions;
- shell/eval/arbitrary filesystem/unrestricted network language;
- attempts to ignore or bypass ToolPolicy, reveal secrets, install Skills, or escalate capabilities;
- dependency and compatibility analysis.

This is a safety filter, not proof that instructions are trustworthy. Package content, imported examples, webpages, and FileObject text remain untrusted context and cannot modify system prompts, capabilities, or policy.

Approved capabilities and data scopes are stored separately from the package manifest. A package cannot self-approve, and a new version cannot inherit a newly requested capability silently. Runtime calls are still typed `ToolIntent`s and are rechecked by the current ToolRegistry/ToolPolicy. Destructive and security-sensitive calls retain double confirmation.

Author signatures are optional and explicit. A forged/invalid signature, manifest/content mismatch, tampered revision, dependency cycle, missing required dependency, unresolved plugin, oversized package, or malformed imported format fails closed. Unsigned packages are visibly unsigned rather than treated as trusted.

No Skill has unrestricted shell, JavaScript evaluation, filesystem, network, recovery-key, device-security, or private-context access. Private context is supplied only through the current Agent/Worker scope and approved Tools. External AI never receives Skill private context directly; any safe delegation remains behind AIEgressFirewall.
# Package containment

Received Skill packages are parsed as untrusted declarative data and remain subject to quarantine/review. An embedded executable-like file is evidence of risk, not an install authority. `received != installed`; a Skill, plugin or Agent cannot release a quarantine entry or enable an executable payload.
