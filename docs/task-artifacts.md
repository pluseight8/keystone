# Task Artifacts

`TaskArtifact` is the only hand-off format between nodes in a Keystone
Multi-Agent Task Graph. It is a bounded, typed reference, not a second copy of
media or private application state.

Supported kinds are `text`, `structured`, `object_references`, `citations`,
`file_reference`, and `error`. Every artifact has a stable graph-local ID,
producer node, graph/node revision, data class, explicit scope, source
citations, provenance, size limit, timestamp, and integrity digest. Producers
cannot publish a data class outside their node scope. Consumers receive an
artifact only when the dependency edge and `inputRefs` select it and the
consumer scope allows it.

Artifacts are verified before use. A changed value, scope, producer, revision,
or timestamp fails integrity verification. Revision changes invalidate old
artifacts, preventing a late worker or stale retry from changing the new plan.
Artifact budgets bound count and bytes, and context budgets bound the serialized
least-context view supplied to a worker.

Private and secret artifacts stay inside local or trusted-personal execution.
The external AI firewall remains authoritative: a graph node assigned to
external execution is rejected if its context or declared scope includes
`PRIVATE`/`SECRET`. Tool results are not automatically copied into an artifact;
the node must explicitly return a typed value/reference and the existing
ToolPolicy still controls the tool.

Use object IDs and citations to connect a Track, Video, File, Message, Space,
or other Keystone object. Do not duplicate the underlying content for Chat,
Community, Library, or another UI surface. A file reference does not imply
availability; normal content-layer integrity, pinning, quota, and privacy
rules still apply.

The mobile Agents view shows artifact counts and node progress. It does not
display private artifact plaintext by default. Audit metadata contains IDs,
classes, producer, and decision state without adding telemetry or a central
artifact service.
