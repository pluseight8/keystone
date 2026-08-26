# Проверка NativeHost

Production evidence собирается через `PhysicalFeatureProbe`, а
`PhysicalE2EHarness.simulated()` предназначен только для контрактных тестов.
TestHost не может притвориться production host.

Linux secure storage использует пользовательский Secret Service через
`secret-tool`, если backend доступен. При отсутствии backend операция
завершается fail-closed: нет plaintext-, env-, JSON- или in-memory fallback.
Secret Service не называется hardware enclave без отдельного доказательства.
