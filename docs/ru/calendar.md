# Календарь Keystone

Calendar — универсальный local-first слой объектов Keystone. Это не вторая система сообщений, файлов, Spaces, Workboards или планировщик. `Calendar` владеет подписанными `CalendarEvent`; события сохраняют стабильные ID и могут ссылаться на WorkItem, Shared Space, FileObject, Track, Video, Live и другие разрешённые объекты без копирования.

`CalendarService` сохраняет календари, события, ревизии, участников, напоминания, приглашения, исключения повторений и конфликты через durable store хоста. Идентичности — непрозрачные криптографические ID, без встроенных имён людей и центрального registry. Повторения daily/weekly/monthly/yearly ограничены по диапазону и учитывают IANA timezone и DST; бесконечная материализация запрещена.

Напоминания используют существующий Chronos через `ChronosCalendarReminderScheduler`, а уведомления — локальную boundary. Calendar не создаёт второй scheduler. RSVP подписывается и проверяется по actor/revision; replay и unauthorized responses отклоняются. WorkItem может ссылаться на канонический CalendarEvent через `calendarEventId`.

Shared calendars используют существующие Hyperswarm/Noise Transport и EnvelopeSecurity через `CalendarReplicationService`: подписи, revision, dedup, replay protection, offline queue, restart и явные `CalendarConflictState`. При конфликте данные не теряются молча.

Раскрытие строгое: `FULL_EVENT`, `TITLE_ONLY`, `FREE_BUSY`, `HIDDEN`. Free/busy возвращает только производные интервалы, без названий, мест, участников или вложений. Ссылки на файлы остаются locked до проверки существующей File/Content policy. Agent Bot выполняет записи только после owner confirmation.

Desktop показывает Day/Week/Month/Agenda, shared selection, timezone и common-time. Mobile имеет отдельный Calendar экран. Оба UI используют host adapter и не дублируют state. Keystone остаётся некоммерческим: платежей, рекламы, marketplace и monetization нет.
