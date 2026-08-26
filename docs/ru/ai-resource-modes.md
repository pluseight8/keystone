# Режимы AI-ресурсов

Resource mode — локальная политика планирования, а не новая privacy policy. Границы Local / Personal Trusted Compute / External AI остаются без изменений.

`PERFORMANCE` предназначен для питания от сети и свободных ресурсов. `BALANCED` — обычный режим с bounded background slot. `GAMING` оставляет foreground assistant, но останавливает обычные background jobs и Memory consolidation; дешёвые recommendations должны быть помечены `cheap`. `BATTERY` выгружает модель после idle и не делает дорогие proactive runs.

Высокое RAM/VRAM pressure, критический thermal state или насыщенные CPU/GPU автоматически уменьшают concurrency и останавливают background. Эти решения локальны и не отправляются в telemetry.

Политика keep-loaded: `never`, `5m`, `15m`, `always`. Она управляет только lifecycle runtime. Reload не меняет Identity, AgentSession или Memory.
