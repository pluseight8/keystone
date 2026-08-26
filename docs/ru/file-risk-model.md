# Модель риска файлов

`FileTypeDetector` сопоставляет extension и sender MIME с magic bytes и structural evidence. Actual type имеет приоритет. PE/ELF/Mach-O под именем `cat.jpg` — mismatch и `CRITICAL` executable risk. Shebang, interpreter formats, installers, bundles и macro-capable documents по умолчанию high risk.

Классы: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, `UNKNOWN`; executable и container risks независимы. Clean scan не даёт execution permission. Отсутствующий или упавший scanner остаётся unknown/fail-closed. Content Safety fingerprint не является malware authority.

Метрики локальные: quarantine, mismatch, parser failure, archive/quota rejects, scanner results, releases и preview failures.
