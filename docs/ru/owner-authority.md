# Owner Authority

Модели предлагают изменение settings, а `OwnerAuthorityService` решает, можно ли применить последствие. `OwnerRequestedSettingsIntent` подписан владельцем и связан с Identity, device, session, исходным interaction, paths/values/actions, timestamp, nonce/request id и коротким expiry. Replay, stale request, неверная подпись и выход за scope отклоняются.

Классы: `USER_PREFERENCE`, `PRIVACY_SETTING`, `SECURITY_SETTING`, `IMMUTABLE_POLICY`. Preference требует fresh explicit request; изменение disclosure — preview/confirmation; security — strong/double confirmation; immutable policy всегда deny. Remote Agent не меняет owner settings, а Skill/plugin используют только scoped неистёкшую capability и обычный owner request.
