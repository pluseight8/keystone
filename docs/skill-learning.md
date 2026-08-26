# Skill learning loop

Memory stores facts and context. A Skill stores a reusable procedure. Keystone never converts an entire conversation or every successful action into a Skill.

`SkillLearningService` records bounded metadata about successful AgentRun, TaskGraph, or ToolFlow procedures: procedure id, Tool ids, step count, outcome, timestamp, data class, and a deduplication fingerprint. A configurable threshold of repeated successes produces a `SkillCandidate`; one success is not enough. Evidence and candidate history are bounded and local.

The candidate flow is explicit:

`experience → repeated pattern → SkillCandidate → local evaluation → preview → user approval → SkillPackage installation`.

Candidates are never installed automatically. They remain proposals until the user reviews the generated instructions, Tools, capabilities, scopes, dependencies, source, and integrity. A candidate can be rejected without changing the Agent.

Installed Skills do not self-modify. `SkillRevisionService` creates a `SkillRevisionProposal` with a diff, reason, expected benefit, evaluation result, and before/after Tools/capabilities. The proposal is accepted or rejected by the user; capability expansion opens a separate permission review. Verified previous revisions remain available for rollback.

Learning is local/trusted only. Prompt injection in a message, file, webpage, Skill, or Tool result cannot create privileged memory, grant a capability, install a package, or turn a suggestion into a user decision.
