# Safety Runtime

Каскад: DomainPolicy → актуальный кэш → детерминированные правила → fingerprint → lightweight classifier → выборка keyframe/metadata → необязательный локальный `SAFETY_REVIEW`. Private context не отправляется внешнему AI. Классификаторы не имеют tools/network authority.

Для Feed/Search/Discovery используется `SafetySurfaceIndex`; до токена UI показывает placeholder, поэтому unsafe preview не успевает мелькнуть. Кэш привязан к content hash, Mandatory policy version и classifier version. Ошибка, неоднозначность или превышение лимита дают quarantine/fail-closed.
