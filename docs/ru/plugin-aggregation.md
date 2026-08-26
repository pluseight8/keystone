# Агрегация Plugin-провайдеров

Keystone владеет fan-out, timeout, отменой, privacy, SafetySurfaceGate,
атрибуцией и финальным ranking. Оценка плагина — только bounded-подсказка.
Источник не может выдать себя за `KEYSTONE_NATIVE`.

Включение media-источника — отдельная настройка владельца
(`PluginMediaSourceRegistry`); установка не включает provider глобально. Search
и media ограничены 100 элементами, а сбой provider возвращает partial results и
не ломает native content.
