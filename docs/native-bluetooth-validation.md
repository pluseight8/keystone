# Native Bluetooth validation

The Linux probe checks for a real controller and records adapter capability
without exposing its address/name as Keystone identity. Scans and advertising
are bounded operations and require explicit NativeHost capability policy. A
controller detected while powered off is `RUNTIME_DETECTED`, not a verified
peer exchange. BLE Coded PHY is represented by the platform capability model
where exposed; unsupported PHY is never forced.
