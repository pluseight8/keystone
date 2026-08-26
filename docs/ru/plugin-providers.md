# Провайдеры плагинов

Регистрация provider типизирована, namespaced и привязана к sandbox session.
Поддерживаются Tool, Skill, Model, Context, Search, Video, Music, Live,
Calendar, File Handler, Object Renderer, Agent Capability, UI, Notifications и
Events. Исполняемые providers проходят sandbox-bound registry; functions не
сохраняются.

Результаты проходят Core privacy, permissions, attribution, ranking и
SafetySurfaceGate; provider не заменяет Keystone surface и не получает
authority. External models проходят AIEgressFirewall, credentials остаются
opaque SecretHandle. Crash/timeout и offline state одного provider изолированы
от native surfaces.
