# Plugin backup and restore

Backup integration should preserve plugin id/revision references, owner preferences, bounded plugin data and source/content addresses. It must not serialize live sandbox capability tokens, raw Identity keys, provider secrets or legacy secret material. A new device rechecks platform/runtime compatibility, package integrity, sandbox requirements and device-scoped grants; executable authority is never blindly cloned.
