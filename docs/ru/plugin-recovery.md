# Восстановление плагинов

Recovery — это repair exact content, а не обход trust. Missing/corrupt bytes, interrupted update/migration, crash loop, missing dependency, incompatibility и security quarantine получают детерминированное состояние. Repair получает exact `sha256:` revision из разрешённого источника и повторяет quarantine, integrity, signature, compatibility и revocation checks. Revoked revision никогда не становится rollback target.
