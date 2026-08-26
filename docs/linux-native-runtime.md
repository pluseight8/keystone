# Linux native runtime

The Linux native runtime validates the Linux NativeHost path with real temporary filesystem
handles, scoped namespaces, a real plugin child process, lifecycle invalidation
and a framed local TCP transport. Symlink/traversal checks remain active for
all filesystem namespaces. Live file descriptors and native handles are never
serialized; restart reacquires resources after policy validation.

The plugin host sanitizes environment variables and uses a non-shell child
process. This is process separation, not an unconditional claim of seccomp,
namespaces, cgroups or complete OS sandboxing. Unsupported hard limits remain
reported rather than simulated.
