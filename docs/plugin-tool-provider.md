# Plugin ToolProvider

A ToolProvider declares a typed input/output schema, risk, capabilities and timeout. Invocation is `ToolRegistry → ToolPolicy → owner confirmation (when required) → PluginSandbox → provider`; the plugin cannot call a tool by itself. Inputs and outputs are schema-validated, size/time bounded and marked `UNTRUSTED` with provenance. Abort signals and deadlines cancel work; non-cooperative work is terminated at the sandbox boundary.
