# Безопасность Skills

Skill — untrusted instruction source относительно system policy. System policy, Identity, AIEgressFirewall, ToolPolicy и confirmation boundary всегда важнее инструкций пакета.

`SkillEvaluator` проверяет schema/size, доступность required Tools/capabilities (когда host их предоставляет), bounded-loop hints, запрещённые executable payloads, shell/eval/filesystem/network формулировки, попытки bypass policy, раскрыть секреты, установить Skill или расширить capability.

Это safety filter, а не доказательство доверия. Imported examples, webpages, FileObject и содержимое Skill остаются untrusted context и не могут менять system prompt, permissions или policy.

Одобренные capabilities/scopes хранятся отдельно от manifest. Skill не может одобрить себя. Каждый вызов снова проходит typed ToolIntent и текущие ToolRegistry/ToolPolicy; destructive/security-sensitive действия сохраняют double confirmation.

Неверная подпись, tampered package, mismatch manifest/content, cycle/missing dependency, unresolved Plugin, oversized package или malformed import отклоняются. Unsigned пакет явно показывается как unsigned/unverified.
# Containment packages

Полученные Skill packages разбираются как недоверенные declarative data и остаются в quarantine/review. Executable-like вложение — только risk evidence, не install authority. `received != installed`; Skill, plugin и Agent не могут release quarantine или включить executable payload.
