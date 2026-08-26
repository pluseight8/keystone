# Безопасность настроек

Settings — mutable user state, но authority их изменения не является mutable config. Immutable core проверяет settings-authority version и MandatoryPolicyRoot до privileged startup. Пользовательские preferences могут быть строже, но не слабее обязательных roots.

Audit хранит только metadata: actor, class, risk, request id, decision, confirmation и timestamp. Prompts, private values и keys по умолчанию не записываются. Remote Agent, stale/replayed request и попытка изменить immutable policy через plugin namespace fail closed.

Mobile и desktop Security surfaces показывают build status, startup stage, policy/rollback epoch и минимальную диагностику lockdown. Кнопки recovery вызывают только host verification/repair boundary; Ignore and continue отсутствует.
