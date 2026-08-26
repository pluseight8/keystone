# NativeHost verification

Use `PhysicalFeatureProbe` for production evidence and
`PhysicalE2EHarness.simulated()` only for contract tests. A test host cannot
masquerade as a production host. `DeviceRuntimeService` persists only a
coherent local snapshot using atomic write/replace and reports recovery after
restart.

The production Linux secure-storage adapter uses the user Secret Service via
`secret-tool` when the service is reachable. It stores no application secret
in files, environment variables, command arguments, logs or serialized
handles. If Secret Service is absent or inaccessible, operations fail closed
with `UNAVAILABLE`/`UNSUPPORTED`; there is no plaintext or in-memory fallback.

OS-backed Secret Service is not described as a hardware-backed enclave.
