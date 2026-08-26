# Personal AI

Keystone fully works without generative Local AI. Local AI is optional, but
strongly recommended when the owner wants richer search, summaries, planning
or assistance. Deterministic product behavior, policy checks and ordinary
local search do not depend on a model.

The permanent rule is:

> Models propose. Policy decides. The user authorizes consequences.

A model is always **untrusted compute**. Compatibility is not a vendor
allowlist or a trust decision.

## Model providers

The owner may use a built-in local runtime, llama.cpp, Ollama, LM Studio, a
localhost OpenAI-compatible endpoint or another compatible local model/fine-
tune. The host owns model files, memory, acceleration, loading and unloading;
the core owns request identity, bounds, cancellation and policy. Remote or
external providers are optional adapters, never a silent replacement for
private Local AI.

Model output is schema-checked, bounded and treated as a proposal. Invalid
nodes, fields, actions or tool calls fail closed. A model cannot create an
authority by naming a tool, inventing an object ID or claiming that a user
approved something.

## Context and Memory

The context resolver starts from an explicit object, tab, workspace, task or
user selection. It checks source permission, deletion, visibility and data
class before returning bounded citations. “Not found” and “not available” are
valid results.

Personal Memory is an owner-managed source with provenance and retention
controls. Mail, Contacts, Documents, Capture, Tasks and feeds are not an
automatic dumping ground for Memory. Ingestion and consolidation follow the
source's explicit policy and can be reviewed locally.

RAG indexes local objects and derived text in a bounded local index. Retrieved
text is context, not authority. A note, filename, webpage, email, message,
OCR result, feed entry or task can contain prompt injection; it cannot expand
the model's tools, permissions or native capabilities.

## What Local AI may do

Local AI can answer, summarize, classify or propose edits within the selected
scope. It may suggest a Task, Calendar time, Vault note, Capture destination,
document annotation or browser action, but each write or external effect uses
the owning service's authorization and confirmation flow.

Local AI does not automatically:

- send Mail or Messages, place Calls, publish, share or invite;
- change Contact/Identity links, permissions, device trust or security policy;
- read all Vault, Memory, Contacts, Mail, Tasks, Documents, Capture, Location
  or private Files because one object was selected;
- execute remote content, run a command, open an unsafe URL or install a
  Plugin/Skill;
- infer a person's location, relationship, identity or consent.

## External AI and egress

External AI is an untrusted egress. It never silently substitutes for Local AI
when private context is involved. Vault, Memory, Contacts, Mail, Tasks,
Documents, Capture, Location, private Files, credentials and browser session
material are not sent implicitly.

An explicit external request passes through `AIEgressFirewall`, which applies
the data class, selected fields, destination, purpose and confirmation policy.
Only safe public or deliberately user-supplied material may leave the local
boundary. A provider's response is still untrusted content and cannot approve
its own action.

## Settings authority

AI can follow a clear owner request only within the current policy category:

| Setting class | AI behavior |
| --- | --- |
| `USER_PREFERENCE` | May follow a clear explicit owner request. |
| `PRIVACY_SETTING` | Must preview and confirm when the choice changes disclosure. |
| `SECURITY_SETTING` | Requires strong or double confirmation. |
| `IMMUTABLE_POLICY` | Is never writable by AI, plugins or remote content. |

Remote pages, mail, messages, documents, OCR text, feed entries and captured
content cannot mutate owner settings. A Settings or policy action is proposed
through a typed interface and rechecked immediately before execution.

## Agents, tools and automation

Agents have an identity, session, state, context and capabilities; they are not
an unrestricted model wrapper. Workers, visits, rooms and delegation receive
only explicit scopes. Tool requests pass through `ToolPolicy`, capability
checks, bounds and the applicable owner confirmation.

Chronos schedules a bounded approved effect and records its result. A reminder
is not permission to execute a task. Browser actions, file operations,
publication, Mail sending, sharing and device placement remain separate typed
actions.

## Product boundaries

- [Capture](capture.md) offers a destination proposal; captured text, URLs,
  files and references do not become AI context automatically.
- [Documents](documents.md), [Photos](photos.md), [Web Library](web-library.md),
  [Mail](mail.md), [Subscriptions](subscriptions.md) and [Contacts](contacts.md)
  expose only selected, bounded projections.
- [Plugins](plugins.md) and [Security](security.md) define the execution and
  egress boundaries; a provider or Skill cannot widen them.
- [Memory](memory.md), [Agents](agents.md) and [AI privacy](ai-privacy.md)
  describe durable context, sessions and external data classes.
