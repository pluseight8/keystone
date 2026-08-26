# Native process sandbox / Нативная изоляция процесса

`PluginSandboxHostImpl` now has a host-owned native process boundary. Linux launches only a scoped Node entrypoint with `shell:false`, sanitized environment, bounded runtime/output, one process and explicit termination. This is a real process boundary, but not a claim of full seccomp/namespace/container isolation. Plugins still cannot request arbitrary shell/process operations.

# Нативная изоляция процесса

`PluginSandboxHostImpl` now has a host-owned native process boundary. Linux launches only a scoped Node entrypoint with `shell:false`, sanitized environment, bounded runtime/output, one process and explicit termination. This is a real process boundary, but not a claim of full seccomp/namespace/container isolation. Plugins still cannot request arbitrary shell/process operations.
