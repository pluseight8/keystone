# Обновления плагинов

Update discovery возвращает только candidates. Downloaded, verified и staged bytes отделены от apply. Сравниваются immutable revision hash, publisher, dependencies, compatibility и capability diff. Одинаковая версия с другими bytes — отдельная revision и не заменяет старую молча.

Capability expansion, смена publisher/dependency authority, incompatibility, плохой integrity или security revocation всегда останавливают обновление на `REVIEW_REQUIRED` либо reject. Active executable bytes не изменяются на месте; безопасная старая revision остаётся recovery target.
