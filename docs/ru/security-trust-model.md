# Модель доверия

Keystone разделяет authenticity, authorization и content safety. Валидная release signature подтверждает локальную установку, но не делает peer доверенным. Даже signed operation проходит локальные identity, membership, capability, replay, privacy и Safety проверки. Model — untrusted compute независимо от provider, локальности или custom реализации.

MandatoryPolicyRoot фиксирует минимальные Safety, ToolPolicy, AI egress, protocol, crypto, sandbox и settings-authority references. Mutable preferences могут быть строже, но не могут отключить или ослабить их. Shared/public content получает eligibility только после Safety gate; personal/private local content остаётся доступен владельцу.

Владелец управляет данными и preferences. Models, agents, Skills, plugins и remote peers только предлагают действия; последствия применяют typed policy/confirmation boundaries. Official status — локальная диагностика, а не сетевой privilege.
