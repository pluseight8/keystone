# Plugin lifecycle

Install, enable, start, stop, disable, update, rollback, quarantine, recover
and uninstall are explicit validated transitions. A package is always installed
disabled. `START` before `ENABLE`, invalid updates and stale transitions are
denied. Update plans record added/removed capabilities and require a fresh review
for expansion. Uninstall stops runtime, clears registrations and removes the
Plugin namespace without deleting unrelated Keystone content.

## Distribution and recovery

The lifecycle is `DISCOVER → RECEIVE → VERIFY → REVIEW → INSTALL_DISABLED → ENABLE → APPLY/HEALTH_CHECK → ACTIVE`, with deterministic repair, quarantine, rollback and remove states. A source outage does not affect an already validated offline plugin. Recovery is exact-content repair, not a policy bypass.
