# Plugin sources

Sources are owner-managed registrations with an opaque id, type, endpoint/reference, health and provenance hint. A known or authenticated source does not make all packages safe. Reserved Core source ids can only be registered by Core-owned code; display names never authenticate a source.

Discovery is metadata-only, bounded and timeout-isolated. Search does not install, enable, grant capabilities or send Vault, Memory, chats, contacts, calendar, location, mesh topology or secrets to the source. Removing/disabling a source does not uninstall an already validated plugin.
