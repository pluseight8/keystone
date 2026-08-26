# Политика безопасности

`MandatorySafetyPolicy` нельзя ослабить через Settings, AI, Skill, plugin, webpage или remote Agent. `UserSafetyPreferences` могут только ужесточать фильтр и применяются после свежего `OwnerRequestedSettingsIntent` с `source: OWNER`.

Контекст учитывается отдельно от темы: исторический/образовательный материал может получить warning, а targeted harm — блокировку. Safety decision не выдаёт permissions и не заменяет authorization, block, membership или encryption policy.
