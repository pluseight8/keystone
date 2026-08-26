# Безопасность контента

Safety — это протокольная граница, а не фильтр интерфейса. Объект проходит `RawIncomingObject → VerifiedObject → AuthorizedObject → SafetyEvaluatedObject → SurfaceEligibleObject`. Feed, Search, Discovery, рекомендации, общий AI-контекст и shared rendering принимают только объект с актуальным `SafetyDecisionToken`.

Личные данные не удаляются. Если публикация запрещена, личная заметка, файл, медиа или Memory остаются у владельца. Получатель проверяет объект локально; подпись/attestation отправителя — лишь подсказка.

Safety работает без generative Local AI: используются domain policy, bounded Unicode-aware rules, fingerprints, лёгкие классификаторы, targeted media sampling, кэш и behavior protection. Любая совместимая локальная модель может быть подключена только как ограниченная `SAFETY_REVIEW` эскалация.
