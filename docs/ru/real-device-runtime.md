# Реальный runtime устройств

`@keystone/native-host` отделяет typed-контракт от фактической проверки
устройства. `PhysicalFeatureProbe` различает реализацию, обнаружение runtime и
физическую проверку; `PhysicalE2EHarness.simulated()` всегда помечен
`SIMULATED` и не может выдать `PHYSICALLY_VERIFIED`.

`DeviceRuntimeService` создаёт локальный снимок с сессией, lifecycle,
восстановлением и грубыми состояниями питания/сети. MAC, серийные номера,
IP-адреса и социальная Identity в снимок не попадают.
