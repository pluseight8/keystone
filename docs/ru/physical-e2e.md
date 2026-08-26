# Доказательства physical E2E

Физические проверки отделены от deterministic adapter-тестов. Каждый результат
содержит классификацию `REAL`, `SIMULATED`, `SAME_HOST`, `HARDWARE`, `BLOCKED`
или `UNSUPPORTED`, метод, время и ограничения.

В этом окружении реально проверены filesystem/process primitives и framed
loopback `LocalNetworkTransport`. Это **same-host тест**, а не утверждение о
двух физических Wi-Fi/Ethernet-устройствах.
