# Совместимость протокола

Envelope и social object используют schema version `1`. Unknown/malformed input
отклоняется, подписи используют strict schemas, а canonical JSON сортирует keys,
поэтому порядок полей не меняет signature/action hash.

Совместимость со старой schema пока не обещана: новая версия потребует явной
migration/compatibility проверки, а не будет молча считаться version `1`.

Unit suite содержит фиксированные vectors для v1 canonical JSON и BLAKE2b-256
action hash. Их изменение требует намеренного решения о версии протокола.
