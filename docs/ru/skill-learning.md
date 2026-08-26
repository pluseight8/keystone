# Learning loop Skills

Memory хранит факты и контекст. Skill хранит повторяемую процедуру. Вся история разговора и каждое успешное действие не превращаются автоматически в Skill.

`SkillLearningService` сохраняет только ограниченные metadata успешных AgentRun/TaskGraph/ToolFlow: procedure id, Tool ids, число шагов, outcome, timestamp, data class и dedup fingerprint. После configurable threshold повторных успехов появляется `SkillCandidate`.

Поток строго явный: `experience → reusable pattern → SkillCandidate → local evaluation → preview → user approval → install`. Candidate никогда не устанавливается автоматически.

Установленный Skill не изменяется сам. `SkillRevisionService` создаёт `SkillRevisionProposal` с diff, причиной, benefit, evaluation и before/after Tools/capabilities. Пользователь принимает или отклоняет proposal; расширение capabilities требует отдельного permission review; проверенные revisions доступны для rollback.

Prompt injection из сообщения, файла, веб-страницы, Skill или ToolResult не может создать privileged memory, grant, package install или решение пользователя.
