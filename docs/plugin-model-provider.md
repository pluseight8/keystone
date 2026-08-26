# Plugin ModelProvider

Model providers may expose any compatible local, external or hybrid model. They declare metadata, capabilities, health, context window and resource estimates. Requests are scheduled through the central AI resource scheduler. Local AI remains untrusted compute and never becomes authority.

External or hybrid requests must pass `AIEgressFirewall`; private/secret context is denied unless an explicit policy allows it. Credentials are opaque SecretHandles and never enter prompts, context, logs or plugin storage. Streaming is cancellable and bounded.
