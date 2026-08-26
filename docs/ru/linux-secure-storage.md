# Linux secure storage

Production adapter использует Secret Service (`secret-tool`) при доступном
пользовательском backend. Handles остаются opaque и `exportable=false`;
revoke удаляет keyring item. При недоступном Secret Service нет слабого
локального fallback. Hardware-backed enclave не предполагается.
